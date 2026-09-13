const axios = require('axios');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const { QrBatch, QrCode, ImageFolder, ImageAsset } = require('../models');

// Stickers only ever show this photo at business-card size, so re-encode it small
// before embedding — otherwise a batch's PDF balloons to tens of MB per full-res photo.
const STICKER_IMAGE_PX = 500;

const MIN_QRS = 1;
const MAX_QRS = 500;
const SPLIT_TYPES = ['vertical-50-50', 'horizontal-50-50'];

const slugifyForCode = (name) =>
  (name || 'PRODUCT')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'PRODUCT';

const batchJson = (batch) => ({
  id: batch.id,
  producer: batch.producer,
  productName: batch.productName,
  variantSize: batch.variantSize,
  batchNo: batch.batchNo,
  splitType: batch.splitType,
  numberOfQrs: batch.numberOfQrs,
  folderId: batch.folderId,
  folderName: batch.folder ? batch.folder.name : undefined,
  createdAt: batch.createdAt,
});

const codeJson = (code) => ({
  id: code.id,
  batchId: code.batchId,
  sequenceNo: code.sequenceNo,
  code: code.code,
  imageUrl: code.imageUrl,
  createdAt: code.createdAt,
  producer: code.batch?.producer,
  productName: code.batch?.productName,
  variantSize: code.batch?.variantSize,
  batchNo: code.batch?.batchNo,
  splitType: code.batch?.splitType,
  folderName: code.batch?.folder?.name,
});

// POST /api/qr-stickers/batches
const createBatch = async (req, res) => {
  try {
    const { producer, productName, variantSize, batchNo, splitType, numberOfQrs, folderId } = req.body;

    if (!producer?.trim() || !productName?.trim() || !batchNo?.trim()) {
      return res.status(400).json({ message: 'Producer, product name and batch no are required.' });
    }

    if (!SPLIT_TYPES.includes(splitType)) {
      return res.status(400).json({ message: 'Invalid split type.' });
    }

    const count = Number(numberOfQrs);
    if (!Number.isInteger(count) || count < MIN_QRS || count > MAX_QRS) {
      return res.status(400).json({ message: `Number of QRs must be between ${MIN_QRS} and ${MAX_QRS}.` });
    }

    const folder = await ImageFolder.findByPk(folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Selected folder was not found.' });
    }

    const availableImages = await ImageAsset.findAll({ where: { folderId, isBlocked: false } });
    if (!availableImages.length) {
      return res.status(400).json({ message: 'Selected folder has no available (unblocked) images.' });
    }

    const batch = await QrBatch.create({
      producer: producer.trim(),
      productName: productName.trim(),
      variantSize: variantSize?.trim() || null,
      batchNo: batchNo.trim(),
      splitType,
      numberOfQrs: count,
      folderId,
    });

    const codes = [];
    for (let i = 1; i <= count; i++) {
      const image = availableImages[Math.floor(Math.random() * availableImages.length)];
      const code = await QrCode.create({
        batchId: batch.id,
        sequenceNo: i,
        imageUrl: image.url,
      });
      code.code = `${slugifyForCode(productName)}-${String(code.id).padStart(5, '0')}`;
      await code.save();
      codes.push(code);
    }

    return res.status(201).json({
      message: `${count} QR sticker(s) generated.`,
      batch: batchJson({ ...batch.toJSON(), folder }),
      codes: codes.map((c) => codeJson(c)),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not generate QR stickers.' });
  }
};

// GET /api/qr-stickers/codes ?search=&producer=&batchNo=
const listCodes = async (req, res) => {
  try {
    const { search = '', producer = '', batchNo = '' } = req.query;

    const where = {};
    if (search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${search}%` } },
        { '$batch.producer$': { [Op.like]: `%${search}%` } },
        { '$batch.product_name$': { [Op.like]: `%${search}%` } },
        { '$batch.batch_no$': { [Op.like]: `%${search}%` } },
      ];
    }
    if (producer) where['$batch.producer$'] = producer;
    if (batchNo) where['$batch.batch_no$'] = batchNo;

    const codes = await QrCode.findAll({
      where,
      include: [
        {
          model: QrBatch,
          as: 'batch',
          required: true,
          include: [{ model: ImageFolder, as: 'folder', attributes: ['name'] }],
        },
      ],
      order: [['created_at', 'DESC']],
      subQuery: false,
    });

    return res.status(200).json({ codes: codes.map(codeJson) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load generated QR codes.' });
  }
};

// GET /api/qr-stickers/verify/:code — public; this is what the printed QR links to
const verifyCode = async (req, res) => {
  try {
    const codeRow = await QrCode.findOne({
      where: { code: req.params.code },
      include: [{ model: QrBatch, as: 'batch' }],
    });

    if (!codeRow) {
      return res.status(404).json({ message: 'This code was not found.' });
    }

    return res.status(200).json({
      code: codeRow.code,
      imageUrl: codeRow.imageUrl,
      producer: codeRow.batch.producer,
      productName: codeRow.batch.productName,
      variantSize: codeRow.batch.variantSize,
      batchNo: codeRow.batch.batchNo,
      createdAt: codeRow.createdAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load this code.' });
  }
};

// GET /api/qr-stickers/filters — distinct producer / batch no values for the History filters
const listFilters = async (req, res) => {
  try {
    const batches = await QrBatch.findAll({ attributes: ['producer', 'batchNo'], raw: true });
    const producers = [...new Set(batches.map((b) => b.producer))].sort();
    const batchNos = [...new Set(batches.map((b) => b.batchNo))].sort();
    return res.status(200).json({ producers, batchNos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load filters.' });
  }
};

const CARD_W = 3.5 * 72;
const CARD_H = 2 * 72;
const PAGE_MARGIN = 36;
const COLUMNS = 2;
const ROWS = 4;
const GAP_X = (612 - PAGE_MARGIN * 2 - CARD_W * COLUMNS) / (COLUMNS + 1);
const GAP_Y = (792 - PAGE_MARGIN * 2 - CARD_H * ROWS) / (ROWS + 1);

const fetchImageBuffer = async (url, cache) => {
  if (cache.has(url)) return cache.get(url);
  const { data } = await axios.get(url, { responseType: 'arraybuffer' });
  const resized = await sharp(Buffer.from(data))
    .resize(STICKER_IMAGE_PX, STICKER_IMAGE_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  cache.set(url, resized);
  return resized;
};

const drawSticker = async (doc, x, y, sticker) => {
  const { producer, productName, variantSize, batchNo, packedDate, splitType, code, imageBuffer, qrBuffer } = sticker;

  doc.roundedRect(x, y, CARD_W, CARD_H, 6).lineWidth(1).stroke('#e7ddcc');

  doc.rect(x, y, CARD_W, 30).fill('#163832');
  doc
    .fillColor('#ffffff')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(producer.toUpperCase(), x + 10, y + 6, { width: CARD_W - 20 });
  doc
    .fillColor('#c9a464')
    .fontSize(6.5)
    .font('Helvetica')
    .text(`Batch ${batchNo} · Packed ${packedDate}`, x + 10, y + 18, { width: CARD_W - 20 });

  doc
    .fillColor('#163832')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(productName, x + 10, y + 36, { width: CARD_W - 20, align: 'center' });
  if (variantSize) {
    doc
      .fillColor('#6b7280')
      .fontSize(6.5)
      .font('Helvetica')
      .text(variantSize, x + 10, y + 48, { width: CARD_W - 20, align: 'center' });
  }

  const bodyTop = y + 58;
  const bodyHeight = CARD_H - 58 - 16;
  const bodyPad = 10;

  if (splitType === 'horizontal-50-50') {
    const halfH = (bodyHeight - 6) / 2;
    const fullW = CARD_W - bodyPad * 2;
    doc.rect(x + bodyPad, bodyTop, fullW, halfH).fill('#fbf3e7');
    if (imageBuffer) {
      doc.image(imageBuffer, x + bodyPad, bodyTop, { fit: [fullW, halfH], align: 'center', valign: 'center' });
    }
    const qrY = bodyTop + halfH + 6;
    const qrSize = Math.min(halfH, fullW);
    doc.image(qrBuffer, x + (CARD_W - qrSize) / 2, qrY, { width: qrSize, height: qrSize });
  } else {
    const halfW = (CARD_W - bodyPad * 2 - 6) / 2;
    doc.rect(x + bodyPad, bodyTop, halfW, bodyHeight).fill('#fbf3e7');
    if (imageBuffer) {
      doc.image(imageBuffer, x + bodyPad, bodyTop, { fit: [halfW, bodyHeight], align: 'center', valign: 'center' });
    }
    const qrX = x + bodyPad + halfW + 6;
    const qrSize = Math.min(bodyHeight, halfW);
    doc.image(qrBuffer, qrX + (halfW - qrSize) / 2, bodyTop + (bodyHeight - qrSize) / 2, { width: qrSize, height: qrSize });
  }

  const footerY = y + CARD_H - 14;
  doc.fillColor('#163832').fontSize(6).font('Helvetica-Bold').text('ORIGINHASH', x + 10, footerY);
  doc.fillColor('#163832').fontSize(6).font('Helvetica-Bold').text(code, x + 10, footerY, { width: CARD_W - 20, align: 'right' });
};

// GET /api/qr-stickers/batches/:id/pdf
const downloadBatchPdf = async (req, res) => {
  try {
    const batch = await QrBatch.findByPk(req.params.id, {
      include: [
        { model: QrCode, as: 'codes' },
        { model: ImageFolder, as: 'folder' },
      ],
    });

    if (!batch) {
      return res.status(404).json({ message: 'Batch not found.' });
    }

    batch.codes.sort((a, b) => a.sequenceNo - b.sequenceNo);

    const packedDate = new Date(batch.createdAt);
    const packedLabel = `${String(packedDate.getDate()).padStart(2, '0')}/${String(packedDate.getMonth() + 1).padStart(2, '0')}/${String(packedDate.getFullYear()).slice(-2)}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${batch.batchNo.replace(/[^a-zA-Z0-9-]+/g, '_')}-stickers.pdf"`
    );

    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    doc.pipe(res);

    const imageCache = new Map();

    doc.fillColor('#163832').fontSize(14).font('Helvetica-Bold').text('QR stickers', PAGE_MARGIN, 14);
    doc
      .fillColor('#6b7280')
      .fontSize(8)
      .font('Helvetica')
      .text(`${batch.producer} · ${batch.productName} · Batch ${batch.batchNo}`, PAGE_MARGIN, 30);

    let col = 0;
    let row = 0;

    for (const codeRow of batch.codes) {
      if (row === ROWS) {
        doc.addPage();
        col = 0;
        row = 0;
      }

      const x = PAGE_MARGIN + GAP_X + col * (CARD_W + GAP_X);
      const y = PAGE_MARGIN + GAP_Y + row * (CARD_H + GAP_Y);

      const imageBuffer = await fetchImageBuffer(codeRow.imageUrl, imageCache).catch(() => null);
      const qrBuffer = await QRCode.toBuffer(codeRow.imageUrl, { margin: 0, width: 300 });

      await drawSticker(doc, x, y, {
        producer: batch.producer,
        productName: batch.productName,
        variantSize: batch.variantSize,
        batchNo: batch.batchNo,
        packedDate: packedLabel,
        splitType: batch.splitType,
        code: codeRow.code,
        imageBuffer,
        qrBuffer,
      });

      col += 1;
      if (col === COLUMNS) {
        col = 0;
        row += 1;
      }
    }

    doc.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Could not generate the PDF.' });
    } else {
      res.end();
    }
  }
};

module.exports = {
  createBatch,
  listCodes,
  listFilters,
  verifyCode,
  downloadBatchPdf,
};
