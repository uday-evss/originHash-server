const { Op } = require('sequelize');
const { sequelize, QrBatch, QrCode, Scan } = require('../models');

const ACTIONS = ['record', 'verify'];
const RECENT_LIMIT = 5;
const SUCCEEDED = ['MATCHED', 'AUTHENTIC'];
const FAILED = ['UNMATCHED', 'NOT_FOUND', 'INVALID', 'ALREADY_VIEWED'];

const toCoordinate = (value, limit) => {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

// The sticker's image is the secret the user compares against, so it's only included
// by the reveal endpoint — never when recording or starting a verification.
const productJson = (codeRow, { withImage = false } = {}) => ({
  code: codeRow.code,
  producer: codeRow.batch.producer,
  productName: codeRow.batch.productName,
  variantSize: codeRow.batch.variantSize,
  batchNo: codeRow.batch.batchNo,
  packedAt: codeRow.batch.createdAt,
  ...(withImage && { imageUrl: codeRow.imageUrl }),
});

const scanJson = (scan) => ({
  id: scan.id,
  action: scan.action,
  result: scan.result,
  code: scan.code,
  hasLocation: scan.latitude !== null && scan.longitude !== null,
  imageRevealedAt: scan.imageRevealedAt,
  createdAt: scan.createdAt,
});

// The earliest scan that revealed this sticker's image, if any (other than `exceptId`).
const firstReveal = (qrCodeId, exceptId, transaction) =>
  Scan.findOne({
    where: {
      qrCodeId,
      imageRevealedAt: { [Op.ne]: null },
      ...(exceptId && { id: { [Op.ne]: exceptId } }),
    },
    order: [['imageRevealedAt', 'ASC']],
    transaction,
  });

const findOwnScan = (req) =>
  Scan.findOne({
    where: { id: req.params.id, userId: req.user.id },
    include: [{ model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] }],
  });

// POST /api/scans  { code, action: 'record' | 'verify', latitude?, longitude? }
// `code` is null when the scanned QR wasn't an OriginHash sticker at all.
// record → SCANNED. verify → PENDING (reveal + answer next), or a final NOT_FOUND / INVALID / ALREADY_VIEWED.
const createScan = async (req, res) => {
  try {
    const { action } = req.body;
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() || null : null;

    if (!ACTIONS.includes(action)) {
      return res.status(400).json({ message: 'Action must be "record" or "verify".' });
    }

    const codeRow = code
      ? await QrCode.findOne({ where: { code }, include: [{ model: QrBatch, as: 'batch' }] })
      : null;

    // Only real products can be recorded as moving through the supply chain.
    if (action === 'record' && !codeRow) {
      return res.status(404).json({
        message: code
          ? "This code isn't in OriginHash records, so it can't be recorded."
          : "This QR isn't an OriginHash sticker, so it can't be recorded.",
      });
    }

    let result = 'SCANNED';
    let earlierReveal = null;
    if (action === 'verify') {
      if (!codeRow) result = code ? 'NOT_FOUND' : 'INVALID';
      else {
        earlierReveal = await firstReveal(codeRow.id);
        result = earlierReveal ? 'ALREADY_VIEWED' : 'PENDING';
      }
    }

    const scan = await Scan.create({
      userId: req.user.id,
      qrCodeId: codeRow?.id ?? null,
      code,
      action,
      result,
      latitude: toCoordinate(req.body.latitude, 90),
      longitude: toCoordinate(req.body.longitude, 180),
    });
    await req.user.increment('scansCount');

    return res.status(201).json({
      scan: scanJson(scan),
      product: codeRow ? productJson(codeRow) : null,
      ...(earlierReveal && { firstViewedAt: earlierReveal.imageRevealedAt }),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not save this scan.' });
  }
};

// POST /api/scans/:id/reveal — shows the sticker's image for an open verification.
// Each sticker's image is revealed only once, ever; a second attempt closes the scan as ALREADY_VIEWED.
const revealImage = async (req, res) => {
  try {
    const scan = await findOwnScan(req);
    if (!scan) {
      return res.status(404).json({ message: 'Scan not found.' });
    }
    if (scan.action !== 'verify' || scan.result !== 'PENDING' || !scan.qrCode) {
      return res.status(409).json({ message: 'This verification is no longer open.', scan: scanJson(scan) });
    }

    // Lock the sticker row so two people revealing the same code at once can't both see it.
    const earlier = await sequelize.transaction(async (transaction) => {
      await QrCode.findByPk(scan.qrCodeId, { transaction, lock: transaction.LOCK.UPDATE });
      const found = await firstReveal(scan.qrCodeId, scan.id, transaction);
      if (found) await scan.update({ result: 'ALREADY_VIEWED' }, { transaction });
      else if (!scan.imageRevealedAt) await scan.update({ imageRevealedAt: new Date() }, { transaction });
      return found;
    });

    if (earlier) {
      return res.status(409).json({
        message: "This sticker's image has already been viewed.",
        scan: scanJson(scan),
        product: productJson(scan.qrCode),
        firstViewedAt: earlier.imageRevealedAt,
      });
    }

    return res.status(200).json({ scan: scanJson(scan), product: productJson(scan.qrCode, { withImage: true }) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not show the image.' });
  }
};

// PATCH /api/scans/:id  { result: 'MATCHED' | 'UNMATCHED' | 'ROLLED_BACK' } — closes an open verification.
const settleScan = async (req, res) => {
  try {
    const { result } = req.body;
    if (!['MATCHED', 'UNMATCHED', 'ROLLED_BACK'].includes(result)) {
      return res.status(400).json({ message: 'Result must be MATCHED, UNMATCHED or ROLLED_BACK.' });
    }

    const scan = await findOwnScan(req);
    if (!scan) {
      return res.status(404).json({ message: 'Scan not found.' });
    }
    if (scan.action !== 'verify' || scan.result !== 'PENDING') {
      return res.status(409).json({ message: 'This verification is already closed.', scan: scanJson(scan) });
    }
    if (result !== 'ROLLED_BACK' && !scan.imageRevealedAt) {
      return res.status(409).json({ message: 'Reveal the image before confirming a match.', scan: scanJson(scan) });
    }

    await scan.update({ result });
    return res.status(200).json({ scan: scanJson(scan), product: scan.qrCode ? productJson(scan.qrCode) : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update this scan.' });
  }
};

// GET /api/scans/summary — the signed-in user's totals and latest scans, for the Home screen.
// Rolled-back or unanswered verifications count as scans, not as verifications.
const getSummary = async (req, res) => {
  try {
    const [counts, recent] = await Promise.all([
      Scan.findAll({
        where: { userId: req.user.id },
        attributes: ['action', 'result', [Scan.sequelize.fn('COUNT', Scan.sequelize.col('id')), 'count']],
        group: ['action', 'result'],
        raw: true,
      }),
      Scan.findAll({
        where: { userId: req.user.id },
        include: [{ model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] }],
        order: [['id', 'DESC']],
        limit: RECENT_LIMIT,
      }),
    ]);

    const totals = { scanned: 0, verifications: 0, succeeded: 0, failed: 0 };
    for (const row of counts) {
      const n = Number(row.count);
      totals.scanned += n;
      if (row.action !== 'verify') continue;
      if (SUCCEEDED.includes(row.result)) {
        totals.verifications += n;
        totals.succeeded += n;
      } else if (FAILED.includes(row.result)) {
        totals.verifications += n;
        totals.failed += n;
      }
    }

    return res.status(200).json({
      totals,
      recent: recent.map((scan) => ({
        ...scanJson(scan),
        productName: scan.qrCode?.batch?.productName ?? null,
        variantSize: scan.qrCode?.batch?.variantSize ?? null,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load your scans.' });
  }
};

module.exports = { createScan, revealImage, settleScan, getSummary };
