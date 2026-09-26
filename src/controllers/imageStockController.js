const crypto = require('crypto');
const { Op } = require('sequelize');
const sizeOf = require('image-size');
const { sequelize, ImageFolder, ImageAsset, QrBatch, QrCode } = require('../models');
const { uploadFileToS3, deleteFilesFromS3 } = require('../services/s3Service');
const { sampleCandidates, downloadPhoto } = require('../services/sampleImages');
const { checkImageQuality } = require('../utils/imageQuality');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const SAMPLE_IMAGE_COUNT = 10;

// Mirrors the app's folders 1:1 inside the S3 bucket, e.g. image-stock/Folder A/photo.jpg
const s3FolderPath = (folderName) => {
  const cleaned = folderName.trim().replace(/[\\/]+/g, '-');
  return `image-stock/${cleaned || 'folder'}`;
};

const folderJson = (folder) => ({
  id: folder.id,
  name: folder.name,
  isSample: Boolean(folder.isSample),
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

    const existing = await ImageFolder.findOne({ where: { name }, paranoid: false });
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

// Checks one image and, if it passes, stores it in the folder (S3 + database). Resolves to
// { image } or { reason } for a rejection; S3/database failures throw.
// `file` is shaped like a multer upload: { buffer, originalname, mimetype, size }.
const saveImage = async (folder, file) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return { reason: 'Only JPG or PNG images are allowed.' };
  }

  let dimensions;
  try {
    dimensions = sizeOf(file.buffer);
  } catch {
    return { reason: 'Could not read image dimensions.' };
  }

  let problem;
  try {
    problem = await checkImageQuality(file.buffer, dimensions);
  } catch {
    problem = 'Could not read this image.';
  }
  if (problem) return { reason: problem };

  const fileHash = crypto.createHash('md5').update(file.buffer).digest('hex');
  const duplicate = await ImageAsset.findOne({ where: { folderId: folder.id, fileHash } });
  if (duplicate) return { reason: 'Duplicate image — already in this folder.' };

  const url = await uploadFileToS3(file, s3FolderPath(folder.name));

  const fields = {
    folderId: folder.id,
    fileName: file.originalname,
    url,
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: file.size,
    mimeType: file.mimetype,
    fileHash,
  };

  // Sample folders can be deleted, so their images stay out of the gap-free numbering.
  if (folder.isSample) return { image: await ImageAsset.create({ ...fields, serialNo: null }) };

  // Next number in the sequence; the row lock makes simultaneous uploads take turns.
  const image = await sequelize.transaction(async (transaction) => {
    const [last] = await ImageAsset.findAll({
      attributes: ['id', 'serialNo'],
      order: [['serialNo', 'DESC']],
      limit: 1,
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    return ImageAsset.create({ ...fields, serialNo: (last?.serialNo || 0) + 1 }, { transaction });
  });
  return { image };
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
      const { image, reason } = await saveImage(folder, file);
      if (image) {
        created.push(imageJson(image));
      } else {
        rejected.push({ fileName: file.originalname, reason });
      }
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

// Removes a deleted folder's unused files from S3. Best effort: its database rows are already
// gone, so a failure here only leaves unreferenced files in the bucket.
const deleteFolderFiles = async (folder, urls) => {
  try {
    await deleteFilesFromS3(urls, `${s3FolderPath(folder.name)}/`);
  } catch (err) {
    console.error(`Could not delete the S3 files of ${folder.name}:`, err.message);
  }
};

// A random, unused name like "Sample-3FA91C".
const sampleFolderName = async () => {
  for (;;) {
    const name = `Sample-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!(await ImageFolder.findOne({ where: { name }, paranoid: false }))) return name;
  }
};

// POST /api/image-stock/folders/sample  (admin) — a new, randomly named folder with one photo
// from each of SAMPLE_IMAGE_COUNT random categories (dog, cat, human, peacock, lion, …). The
// photos go through the same checks and storage as uploads.
const createSampleFolder = async (req, res) => {
  let candidates;
  try {
    candidates = await sampleCandidates();
  } catch (err) {
    console.error('Could not load sample photos:', err.message);
    return res.status(502).json({ message: 'Could not reach iNaturalist for sample photos. Try again in a minute.' });
  }

  let folder;
  try {
    folder = await ImageFolder.create({ name: await sampleFolderName(), isSample: true });

    // Start the first photo of each chosen category downloading at once; more are only fetched
    // when one fails or is rejected.
    const firstDownloads = candidates
      .slice(0, SAMPLE_IMAGE_COUNT)
      .map(({ category, photos }) => downloadPhoto(photos[0], `${category}.jpg`).catch(() => null));

    const created = [];
    const skipped = [];
    for (const [index, { category, photos }] of candidates.entries()) {
      if (created.length === SAMPLE_IMAGE_COUNT) break;

      let reason = 'No usable photo.';
      for (const [attempt, photo] of photos.slice(0, 3).entries()) {
        const file =
          attempt === 0 && index < firstDownloads.length
            ? await firstDownloads[index]
            : await downloadPhoto(photo, `${category}.jpg`).catch(() => null);
        if (!file) {
          reason = 'Could not download the photo.';
          continue;
        }
        const result = await saveImage(folder, file);
        if (result.image) {
          created.push(imageJson({ ...result.image.get(), folder }));
          reason = null;
          break;
        }
        reason = result.reason;
      }
      if (reason) skipped.push({ category, reason });
    }

    if (!created.length) {
      await folder.destroy({ force: true });
      return res.status(502).json({ message: 'Could not fetch any sample photos. Try again in a minute.', skipped });
    }

    return res.status(201).json({
      message: `${folder.name} created with ${created.length} images.`,
      folder: { ...folderJson(folder), imagesCount: created.length, availableImagesCount: created.length },
      images: created,
      skipped,
    });
  } catch (err) {
    console.error(err);
    // Don't leave a half-filled sample folder behind (e.g. when S3 isn't configured).
    if (folder) {
      const images = await ImageAsset.findAll({ where: { folderId: folder.id }, attributes: ['url'] }).catch(() => []);
      await ImageAsset.destroy({ where: { folderId: folder.id } }).catch(() => {});
      await folder.destroy({ force: true }).catch(() => {});
      await deleteFolderFiles(folder, images.map((image) => image.url));
    }
    return res.status(500).json({ message: err.message || 'Could not generate a sample folder.' });
  }
};

// DELETE /api/image-stock/folders/:id  (admin) — generated sample folders only; any other image
// may be printed on stickers, so block those instead. QR batches made from the folder are left
// exactly as they were:
//  - the folder row is only hidden (deleted_at), so batches still point at it and show its name;
//  - each sticker keeps its own copy of its photo's URL, and photos that any sticker uses stay in
//    S3 — only the folder's unused photos are deleted from the bucket.
const deleteFolder = async (req, res) => {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      // Waits for any batch being generated from this folder (createBatch holds a shared lock),
      // so its stickers are counted below.
      const folder = await ImageFolder.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!folder) return { status: 404, message: 'Folder not found.' };
      if (!folder.isSample) {
        return {
          status: 403,
          message: 'Only generated sample folders can be deleted. Block images you no longer want instead.',
        };
      }

      const images = await ImageAsset.findAll({ where: { folderId: folder.id }, attributes: ['url'], transaction });
      const urls = images.map((image) => image.url);
      const usedRows = urls.length
        ? await QrCode.findAll({ where: { imageUrl: urls }, attributes: ['imageUrl'], raw: true, transaction })
        : [];
      const used = new Set(usedRows.map((row) => row.imageUrl));
      const batches = await QrBatch.count({ where: { folderId: folder.id }, transaction });

      await ImageAsset.destroy({ where: { folderId: folder.id }, transaction });
      await folder.destroy({ transaction }); // hides it (sets deleted_at)
      return { status: 200, folder, batches, unusedUrls: urls.filter((url) => !used.has(url)) };
    });

    if (result.status !== 200) {
      return res.status(result.status).json({ message: result.message });
    }

    await deleteFolderFiles(result.folder, result.unusedUrls);
    const { folder, batches } = result;
    const kept =
      batches === 1
        ? ' The QR batch made from it keeps its stickers and photos.'
        : batches > 1
          ? ` The ${batches} QR batches made from it keep their stickers and photos.`
          : '';
    return res.status(200).json({ message: `${folder.name} deleted.${kept}`, folderId: folder.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not delete folder.' });
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
  createSampleFolder,
  deleteFolder,
  listImages,
  uploadImages,
  blockImage,
  unblockImage,
};
