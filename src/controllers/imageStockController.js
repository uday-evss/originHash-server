const crypto = require('crypto');
const { Op } = require('sequelize');
const sizeOf = require('image-size');
const { sequelize, ImageFolder, ImageAsset } = require('../models');
const { uploadFileToS3 } = require('../services/s3Service');
const { checkImageQuality } = require('../utils/imageQuality');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

// Mirrors the app's folders 1:1 inside the S3 bucket, e.g. image-stock/Folder A/photo.jpg
const s3FolderPath = (folderName) => {
  const cleaned = folderName.trim().replace(/[\\/]+/g, '-');
  return `image-stock/${cleaned || 'folder'}`;
};

const folderJson = (folder) => ({
  id: folder.id,
  name: folder.name,
  imagesCount: folder.get('imagesCount') != null ? Number(folder.get('imagesCount')) : undefined,
  availableImagesCount:
    folder.get('availableImagesCount') != null ? Number(folder.get('availableImagesCount')) : undefined,
  createdAt: folder.createdAt,
});

const imageJson = (image) => ({
  id: image.id,
  serialNo: image.serialNo,
  folderId: image.folderId,
  folderName: image.folder ? image.folder.name : undefined,
  fileName: image.fileName,
  url: image.url,
  width: image.width,
  height: image.height,
  sizeBytes: image.sizeBytes,
  mimeType: image.mimeType,
  isBlocked: image.isBlocked,
  createdAt: image.createdAt,
});

// GET /api/image-folders
const listFolders = async (req, res) => {
  try {
    const folders = await ImageFolder.findAll({
      attributes: {
        include: [
          [ImageFolder.sequelize.fn('COUNT', ImageFolder.sequelize.col('images.id')), 'imagesCount'],
          [
            ImageFolder.sequelize.fn(
              'SUM',
              ImageFolder.sequelize.literal('CASE WHEN `images`.`is_blocked` = 0 THEN 1 ELSE 0 END')
            ),
            'availableImagesCount',
          ],
        ],
      },
      include: [{ model: ImageAsset, as: 'images', attributes: [] }],
      group: ['ImageFolder.id'],
      order: [['created_at', 'DESC']],
    });

    return res.status(200).json({ folders: folders.map(folderJson) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load folders.' });
  }
};

// POST /api/image-folders  { name }
const createFolder = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Folder name is required.' });
    }

    const existing = await ImageFolder.findOne({ where: { name } });
    if (existing) {
      return res.status(409).json({ message: 'A folder with this name already exists.' });
    }

    const folder = await ImageFolder.create({ name });
    return res
      .status(201)
      .json({ message: 'Folder created.', folder: { ...folderJson(folder), imagesCount: 0, availableImagesCount: 0 } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not create folder.' });
  }
};

// GET /api/images ?folderId=&search=
const listImages = async (req, res) => {
  try {
    const { folderId, search = '' } = req.query;
    const where = {};
    if (folderId) where.folderId = folderId;
    if (search) where.fileName = { [Op.like]: `%${search}%` };

    const images = await ImageAsset.findAll({
      where,
      include: [{ model: ImageFolder, as: 'folder', attributes: ['name'] }],
      order: [['created_at', 'DESC']],
    });

    return res.status(200).json({ images: images.map(imageJson) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load images.' });
  }
};

// POST /api/image-folders/:id/images  (multipart, field "images", up to 20 files)
const uploadImages = async (req, res) => {
  try {
    const folder = await ImageFolder.findByPk(req.params.id);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found.' });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ message: 'No images were provided.' });
    }

    const created = [];
    const rejected = [];

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        rejected.push({ fileName: file.originalname, reason: 'Only JPG or PNG images are allowed.' });
        continue;
      }

      let dimensions;
      try {
        dimensions = sizeOf(file.buffer);
      } catch {
        rejected.push({ fileName: file.originalname, reason: 'Could not read image dimensions.' });
        continue;
      }

      let problem;
      try {
        problem = await checkImageQuality(file.buffer, dimensions);
      } catch {
        problem = 'Could not read this image.';
      }
      if (problem) {
        rejected.push({ fileName: file.originalname, reason: problem });
        continue;
      }

      const fileHash = crypto.createHash('md5').update(file.buffer).digest('hex');
      const duplicate = await ImageAsset.findOne({ where: { folderId: folder.id, fileHash } });
      if (duplicate) {
        rejected.push({ fileName: file.originalname, reason: 'Duplicate image — already in this folder.' });
        continue;
      }

      const url = await uploadFileToS3(file, s3FolderPath(folder.name));

      // Next number in the sequence; the row lock makes simultaneous uploads take turns.
      const image = await sequelize.transaction(async (transaction) => {
        const [last] = await ImageAsset.findAll({
          attributes: ['id', 'serialNo'],
          order: [['serialNo', 'DESC']],
          limit: 1,
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        return ImageAsset.create(
          {
            serialNo: (last?.serialNo || 0) + 1,
            folderId: folder.id,
            fileName: file.originalname,
            url,
            width: dimensions.width,
            height: dimensions.height,
            sizeBytes: file.size,
            mimeType: file.mimetype,
            fileHash,
          },
          { transaction }
        );
      });

      created.push(imageJson(image));
    }

    return res.status(201).json({
      message: `${created.length} image(s) uploaded.`,
      images: created,
      rejected,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not upload images.' });
  }
};

// PATCH /api/images/:id/block
const blockImage = async (req, res) => {
  try {
    const image = await ImageAsset.findByPk(req.params.id);
    if (!image) {
      return res.status(404).json({ message: 'Image not found.' });
    }
    image.isBlocked = true;
    await image.save();
    return res.status(200).json({ message: 'Image blocked.', image: imageJson(image) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not block image.' });
  }
};

// PATCH /api/images/:id/unblock
const unblockImage = async (req, res) => {
  try {
    const image = await ImageAsset.findByPk(req.params.id);
    if (!image) {
      return res.status(404).json({ message: 'Image not found.' });
    }
    image.isBlocked = false;
    await image.save();
    return res.status(200).json({ message: 'Image unblocked.', image: imageJson(image) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not unblock image.' });
  }
};

module.exports = {
  listFolders,
  createFolder,
  listImages,
  uploadImages,
  blockImage,
  unblockImage,
};
