const axios = require('axios');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const { QrBatch, QrCode, ImageFolder, ImageAsset, User, UserProfileVersion } = require('../models');
const { canSeeFullJourney, isAdminUser } = require('../utils/roles');
const { TRACKED_FIELDS, profileChanges, recordProfileVersion } = require('../utils/profileHistory');

// Stickers only ever show this photo at business-card size, so re-encode it small
// before embedding — otherwise a batch's PDF balloons to tens of MB per full-res photo.
const STICKER_IMAGE_PX = 500;

const MIN_QRS = 1;
const MAX_QRS = 500;
const SPLIT_TYPES = ['vertical-50-50', 'horizontal-50-50'];

// A sticker's QR opens the public verify page for its code, so a phone's own camera app
// lands somewhere useful and the in-app scanner can tell exactly which unit it is.
// Falls back to the bare code (which the in-app scanner also accepts) if PUBLIC_APP_URL is unset.
const stickerQrPayload = (code) => {
  const appUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return appUrl ? `${appUrl}/verify/${encodeURIComponent(code)}` : code;
};

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
  pageSize: batch.pageSize || 'A4',
  numberOfQrs: batch.numberOfQrs,
  folderId: batch.folderId,
  folderName: batch.folder ? batch.folder.name : undefined,
  createdAt: batch.createdAt,
});

// For admins: who generated a batch, the details they had at the time, and what has changed
// since — so batches made as "Harish" and as "Kumar" read as the same person. Needs the batch's
// `creator` and `creatorProfile` loaded.
const batchCreatorJson = (batch) => {
  if (!batch?.createdBy) return null;
  const { creator, creatorProfile } = batch;
  return {
    userId: batch.createdBy,
    name: creator?.name || null,
    username: creator?.username || null,
    mobile: creator?.mobile || null,
    generatedAs: creatorProfile
      ? Object.fromEntries([...TRACKED_FIELDS, 'versionNo'].map((field) => [field, creatorProfile[field]]))
      : null,
    changedSince: creatorProfile && creator ? profileChanges(creatorProfile, creator) : [],
  };
};

const codeJson = (code) => ({
  id: code.id,
  uuid: code.uuid,
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
  pageSize: code.batch?.pageSize || 'A4',
  folderName: code.batch?.folder?.name,
});

// POST /api/qr-stickers/batches
const createBatch = async (req, res) => {
  try {
    const { producer, productName, variantSize, batchNo, splitType, numberOfQrs, folderId } = req.body;
    const pageSize = req.body.pageSize || 'A4';

    if (!producer?.trim() || !productName?.trim() || !batchNo?.trim()) {
      return res.status(400).json({ message: 'Producer, product name and batch no are required.' });
    }

    if (!SPLIT_TYPES.includes(splitType)) {
      return res.status(400).json({ message: 'Invalid split type.' });
    }

    if (!PAGE_SIZE_NAMES.includes(pageSize)) {
      return res.status(400).json({ message: 'Paper size must be A4 or A3.' });
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

    // Pin the creator's details as they are right now, so a later rename can't blur who made this.
    const creatorProfile = await recordProfileVersion(req.user, { source: 'system' });

    const batch = await QrBatch.create({
      producer: producer.trim(),
      productName: productName.trim(),
      variantSize: variantSize?.trim() || null,
      batchNo: batchNo.trim(),
      splitType,
      pageSize,
      numberOfQrs: count,
      folderId,
      createdBy: req.user.id,
      creatorProfileVersionId: creatorProfile.id,
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

    // Only admins see who generated each batch.
    const isAdmin = isAdminUser(req.user);
    const batchIncludes = [{ model: ImageFolder, as: 'folder', attributes: ['name'] }];
    if (isAdmin) {
      batchIncludes.push(
        { model: User, as: 'creator', attributes: ['id', 'username', ...TRACKED_FIELDS] },
        { model: UserProfileVersion, as: 'creatorProfile' }
      );
    }

    const codes = await QrCode.findAll({
      where,
      include: [{ model: QrBatch, as: 'batch', required: true, include: batchIncludes }],
      order: [['created_at', 'DESC']],
      subQuery: false,
    });

    return res.status(200).json({
      codes: codes.map((code) => ({
        ...codeJson(code),
        canViewJourney: canSeeFullJourney(req.user, code),
        ...(isAdmin && { creator: batchCreatorJson(code.batch) }),
      })),
    });
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

// ---------- PDF layout ----------
// All sizes in PDF points (1 pt = 1/72 in ≈ 0.353 mm).
const PAGE_SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55] };
const PAGE_SIZE_NAMES = Object.keys(PAGE_SIZES);

// Vertical 50:50 is a business card (89 × 51 mm) with the image and QR side by side.
// Horizontal 50:50 is a tall card (45 × 65 mm) with the image above the QR — 16 fit on an A4 page.
const STICKER_SIZES = {
  'vertical-50-50': { w: 3.5 * 72, h: 2 * 72 },
  'horizontal-50-50': { w: 128, h: 184 },
};

const PAGE_MARGIN = 22; // ≈ 8 mm, inside most printers' unprintable edge
const GAP = 10;
const HEADER_H = 24;

// The sticker grid for a paper size: tries the page upright and sideways and keeps whichever
// fits more stickers (A3 horizontal stickers fit best sideways: 8 × 4 = 32).
const pageLayout = (pageSize, splitType) => {
  const [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
  const { w, h } = STICKER_SIZES[splitType] || STICKER_SIZES['vertical-50-50'];
  const fit = (width, height) => {
    const cols = Math.floor((width - PAGE_MARGIN * 2 + GAP) / (w + GAP));
    const rows = Math.floor((height - PAGE_MARGIN * 2 - HEADER_H + GAP) / (h + GAP));
    return { width, height, cols, rows, perPage: cols * rows };
  };
  const upright = fit(pw, ph);
  const sideways = fit(ph, pw);
  const best = sideways.perPage > upright.perPage ? sideways : upright;
  const gridWidth = best.cols * w + (best.cols - 1) * GAP;
  return { ...best, w, h, left: (best.width - gridWidth) / 2, top: PAGE_MARGIN + HEADER_H };
};

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

// Single line of text that never wraps: shrinks down to `minSize`, then cuts with an ellipsis.
const fitLine = (doc, text, x, y, width, { size, minSize = size, font = 'Helvetica', color, align = 'left' }) => {
  let s = size;
  doc.font(font);
  while (s > minSize && doc.fontSize(s).widthOfString(text) > width) s -= 0.25;
  doc.fillColor(color).fontSize(s).text(text, x, y, { width, align, lineBreak: false, ellipsis: true, height: s + 2 });
};

const drawStickerHeader = (doc, x, y, w, { producer, batchNo, packedDate, productName, variantSize }, compact) => {
  const pad = compact ? 7 : 10;
  const bandH = compact ? 28 : 30;
  doc.rect(x, y, w, bandH).fill('#163832');
  fitLine(doc, producer.toUpperCase(), x + pad, y + (compact ? 5 : 6), w - pad * 2, {
    size: compact ? 8 : 9,
    minSize: 6.5,
    font: 'Helvetica-Bold',
    color: '#ffffff',
  });
  fitLine(doc, `Batch ${batchNo} · Packed ${packedDate}`, x + pad, y + (compact ? 17 : 18), w - pad * 2, {
    size: compact ? 5.5 : 6.5,
    minSize: 4.5,
    color: '#c9a464',
  });
  fitLine(doc, productName, x + pad, y + (compact ? 33 : 36), w - pad * 2, {
    size: compact ? 8 : 9,
    minSize: 6.5,
    font: 'Helvetica-Bold',
    color: '#163832',
    align: 'center',
  });
  if (variantSize) {
    fitLine(doc, variantSize, x + pad, y + (compact ? 43 : 48), w - pad * 2, {
      size: compact ? 5.5 : 6.5,
      minSize: 4.5,
      color: '#6b7280',
      align: 'center',
    });
  }
};

// "ORIGINHASH" on the left and the code on the right; on a narrow card with a long code, the
// code (which people type in when a QR won't scan) takes the whole line instead.
const drawStickerFooter = (doc, x, y, w, code, pad) => {
  const inner = w - pad * 2;
  doc.font('Helvetica-Bold');
  const brandW = doc.fontSize(5).widthOfString('ORIGINHASH');
  let size = 6;
  while (size > 4.5 && doc.fontSize(size).widthOfString(code) > inner - brandW - 6) size -= 0.25;
  if (doc.fontSize(size).widthOfString(code) <= inner - brandW - 6) {
    doc.fillColor('#163832').fontSize(5).text('ORIGINHASH', x + pad, y + 1, { lineBreak: false });
    doc.fillColor('#163832').fontSize(size).text(code, x + pad, y, { width: inner, align: 'right', lineBreak: false });
  } else {
    fitLine(doc, code, x + pad, y, inner, { size: 6, minSize: 4, font: 'Helvetica-Bold', color: '#163832', align: 'center' });
  }
};

const drawSticker = async (doc, x, y, layout, sticker) => {
  const { w, h } = layout;
  const { splitType, code, imageBuffer, qrBuffer } = sticker;
  const tall = splitType === 'horizontal-50-50';

  doc.roundedRect(x, y, w, h, 6).lineWidth(1).stroke('#e7ddcc');
  drawStickerHeader(doc, x, y, w, sticker, tall);

  if (tall) {
    // Image across the top, QR centred below it. No background behind the image, so photos
    // narrower than the box sit on the white card instead of between beige bars.
    const pad = 8;
    const imageTop = y + 52;
    const imageH = 48;
    if (imageBuffer) {
      doc.image(imageBuffer, x + pad, imageTop, { fit: [w - pad * 2, imageH], align: 'center', valign: 'center' });
    }
    const qrSize = 62;
    doc.image(qrBuffer, x + (w - qrSize) / 2, imageTop + imageH + 5, { width: qrSize, height: qrSize });
    drawStickerFooter(doc, x, y + h - 13, w, code, 7);
    return;
  }

  // Image on the left, QR on the right.
  const bodyTop = y + 58;
  const bodyHeight = h - 58 - 16;
  const bodyPad = 10;
  const halfW = (w - bodyPad * 2 - 6) / 2;
  doc.rect(x + bodyPad, bodyTop, halfW, bodyHeight).fill('#fbf3e7');
  if (imageBuffer) {
    doc.image(imageBuffer, x + bodyPad, bodyTop, { fit: [halfW, bodyHeight], align: 'center', valign: 'center' });
  }
  const qrX = x + bodyPad + halfW + 6;
  const qrSize = Math.min(bodyHeight, halfW);
  doc.image(qrBuffer, qrX + (halfW - qrSize) / 2, bodyTop + (bodyHeight - qrSize) / 2, { width: qrSize, height: qrSize });
  drawStickerFooter(doc, x, y + h - 14, w, code, 10);
};

// GET /api/qr-stickers/batches/:id/pdf — laid out on the batch's paper size (A4 unless chosen otherwise).
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

    const pageSize = batch.pageSize || 'A4';
    const layout = pageLayout(pageSize, batch.splitType);
    const pages = Math.max(1, Math.ceil(batch.codes.length / layout.perPage));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${batch.batchNo.replace(/[^a-zA-Z0-9-]+/g, '_')}-stickers-${pageSize}.pdf"`
    );

    const doc = new PDFDocument({ size: [layout.width, layout.height], margin: 0, autoFirstPage: false });
    doc.pipe(res);

    const imageCache = new Map();
    const startPage = (page) => {
      doc.addPage({ size: [layout.width, layout.height], margin: 0 });
      doc
        .fillColor('#163832')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('QR stickers', PAGE_MARGIN, PAGE_MARGIN - 8, { lineBreak: false, continued: true })
        .fillColor('#6b7280')
        .font('Helvetica')
        .text(
          `  ·  ${batch.producer} · ${batch.productName} · Batch ${batch.batchNo} · ${pageSize} · Page ${page} of ${pages}`,
          { lineBreak: false }
        );
    };

    for (const [i, codeRow] of batch.codes.entries()) {
      const slot = i % layout.perPage;
      if (slot === 0) startPage(i / layout.perPage + 1);

      const x = layout.left + (slot % layout.cols) * (layout.w + GAP);
      const y = layout.top + Math.floor(slot / layout.cols) * (layout.h + GAP);

      const imageBuffer = await fetchImageBuffer(codeRow.imageUrl, imageCache).catch(() => null);
      const qrBuffer = await QRCode.toBuffer(stickerQrPayload(codeRow.code), { margin: 0, width: 300 });

      await drawSticker(doc, x, y, layout, {
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
    }
    if (!batch.codes.length) startPage(1);

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
