const { QrBatch, QrCode, Scan } = require('../models');

const ACTIONS = ['record', 'verify'];
const RECENT_LIMIT = 5;

const toCoordinate = (value, limit) => {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

const productJson = (codeRow) => ({
  code: codeRow.code,
  imageUrl: codeRow.imageUrl,
  producer: codeRow.batch.producer,
  productName: codeRow.batch.productName,
  variantSize: codeRow.batch.variantSize,
  batchNo: codeRow.batch.batchNo,
  packedAt: codeRow.batch.createdAt,
});

const scanJson = (scan) => ({
  id: scan.id,
  action: scan.action,
  result: scan.result,
  code: scan.code,
  hasLocation: scan.latitude !== null && scan.longitude !== null,
  createdAt: scan.createdAt,
});

// POST /api/scans  { code, action: 'record' | 'verify', latitude?, longitude? }
// `code` is null when the scanned QR wasn't an OriginHash sticker at all.
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

    let result = 'recorded';
    if (action === 'verify') {
      if (codeRow) result = 'authentic';
      else result = code ? 'not_found' : 'invalid';
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
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not save this scan.' });
  }
};

// GET /api/scans/summary — the signed-in user's totals and latest scans, for the Home screen.
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
      if (row.action === 'verify') {
        totals.verifications += n;
        if (row.result === 'authentic') totals.succeeded += n;
        else totals.failed += n;
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

module.exports = { createScan, getSummary };
