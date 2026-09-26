const { Op } = require('sequelize');
const { sequelize, QrBatch, QrCode, Scan, ScanReport, User } = require('../models');
const { uploadFileToS3 } = require('../services/s3Service');
const { nameScanLocation } = require('../utils/locationNames');
const { isAdminUser, canSeeFullJourney } = require('../utils/roles');

const ACTIONS = ['record', 'verify'];
const RECENT_LIMIT = 5;
const REPORT_NOTE_MAX = 1000;
const SUCCEEDED = ['MATCHED', 'AUTHENTIC'];
const FAILED = ['UNMATCHED', 'NOT_FOUND', 'INVALID', 'ALREADY_VIEWED'];
const HISTORY_FILTERS = { all: null, verified: SUCCEEDED, failed: FAILED, scanned: ['SCANNED'] };
const HISTORY_PAGE = 20;
const JOURNEY_LIMIT = 50;

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
  uuid: scan.uuid,
  action: scan.action,
  result: scan.result,
  code: scan.code,
  hasLocation: scan.latitude !== null && scan.longitude !== null,
  imageRevealedAt: scan.imageRevealedAt,
  createdAt: scan.createdAt,
});

// MySQL returns DECIMAL columns as strings.
const locationJson = (scan) =>
  scan.latitude !== null && scan.longitude !== null
    ? { latitude: Number(scan.latitude), longitude: Number(scan.longitude), name: scan.locationName ?? null }
    : null;

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

const reportJson = (report) => ({
  note: report.note,
  photoUrl: report.photoUrl,
  createdAt: report.createdAt,
});

const findOwnScan = (req, include = []) =>
  Scan.findOne({
    where: { id: req.params.id, userId: req.user.id },
    include: [{ model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] }, ...include],
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

    res.status(201).json({
      scan: scanJson(scan),
      product: codeRow ? productJson(codeRow) : null,
      ...(earlierReveal && { firstViewedAt: earlierReveal.imageRevealedAt }),
    });
    nameScanLocation(scan);
    return undefined;
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

// POST /api/scans/:id/report  multipart: note?, photo? (both optional)
// On an open verification whose image was revealed, reporting is the user's "Unmatched" answer
// and closes the scan as UNMATCHED. An ALREADY_VIEWED (or UNMATCHED) scan can be reported as it is.
const reportScan = async (req, res) => {
  try {
    const scan = await findOwnScan(req, [{ model: ScanReport, as: 'report' }]);
    if (!scan) {
      return res.status(404).json({ message: 'Scan not found.' });
    }

    const openAndRevealed = scan.result === 'PENDING' && scan.imageRevealedAt;
    if (!openAndRevealed && !['ALREADY_VIEWED', 'UNMATCHED'].includes(scan.result)) {
      return res.status(409).json({ message: 'This scan can no longer be reported.', scan: scanJson(scan) });
    }
    if (scan.report) {
      return res.status(409).json({ message: 'This scan has already been reported.', scan: scanJson(scan) });
    }

    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, REPORT_NOTE_MAX) || null : null;

    let photoUrl = null;
    if (req.file) {
      try {
        photoUrl = await uploadFileToS3(req.file, 'scan-reports');
      } catch (err) {
        console.error(err);
        return res.status(502).json({ message: "Couldn't upload the photo. Try again, or send the report without it." });
      }
    }

    const report = await sequelize.transaction(async (transaction) => {
      if (openAndRevealed) await scan.update({ result: 'UNMATCHED' }, { transaction });
      return ScanReport.create({ scanId: scan.id, note, photoUrl }, { transaction });
    });

    return res.status(201).json({
      scan: scanJson(scan),
      product: scan.qrCode ? productJson(scan.qrCode) : null,
      report: reportJson(report),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not send your report.' });
  }
};

// Admins see every user's scans; everyone else sees only their own.
const historyScope = (user) => (isAdminUser(user) ? {} : { userId: user.id });

const SCANNER_ATTRIBUTES = ['id', 'name', 'userType'];

const scannedByJson = (scan, viewer) =>
  scan.user ? { name: scan.user.name ?? null, userType: scan.user.userType ?? null, isYou: scan.userId === viewer.id } : null;

// Every "Scan to record" of a sticker, oldest first, plus when (if ever) a buyer verified it.
// Admins and the batch's creator see everyone's scans; anyone else sees just their own.
const buildJourney = async (codeRow, viewer) => {
  const full = canSeeFullJourney(viewer, codeRow);
  const [records, verified] = await Promise.all([
    Scan.findAll({
      where: { qrCodeId: codeRow.id, result: 'SCANNED', ...(!full && { userId: viewer.id }) },
      include: [{ model: User, as: 'user', attributes: SCANNER_ATTRIBUTES }],
      order: [['id', 'ASC']],
      limit: JOURNEY_LIMIT,
    }),
    Scan.findOne({ where: { qrCodeId: codeRow.id, result: SUCCEEDED }, order: [['id', 'ASC']] }),
  ]);
  // Anything still unnamed gets looked up in the background for next time.
  records.forEach(nameScanLocation);
  return {
    journeyScope: full ? 'all' : 'own',
    buyerVerifiedAt: verified?.createdAt ?? null,
    journey: records.map((record) => ({
      id: record.id,
      userName: record.user?.name ?? null,
      userType: record.user?.userType ?? null,
      isYou: record.userId === viewer.id,
      location: locationJson(record),
      createdAt: record.createdAt,
    })),
  };
};

// GET /api/scans?filter=all|verified|failed|scanned&before=<id> — scan history, newest first.
// Admins get every user's scans (with who scanned); everyone else gets their own.
const listScans = async (req, res) => {
  try {
    const filter = Object.hasOwn(HISTORY_FILTERS, req.query.filter) ? req.query.filter : 'all';
    const before = Number(req.query.before);

    const where = historyScope(req.user);
    if (HISTORY_FILTERS[filter]) where.result = HISTORY_FILTERS[filter];
    if (Number.isInteger(before) && before > 0) where.id = { [Op.lt]: before };

    const rows = await Scan.findAll({
      where,
      include: [
        { model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] },
        { model: User, as: 'user', attributes: SCANNER_ATTRIBUTES },
      ],
      order: [['id', 'DESC']],
      limit: HISTORY_PAGE + 1,
    });

    return res.status(200).json({
      scope: isAdminUser(req.user) ? 'all' : 'own',
      scans: rows.slice(0, HISTORY_PAGE).map((scan) => ({
        ...scanJson(scan),
        location: locationJson(scan),
        productName: scan.qrCode?.batch?.productName ?? null,
        variantSize: scan.qrCode?.batch?.variantSize ?? null,
        producer: scan.qrCode?.batch?.producer ?? null,
        scannedBy: scannedByJson(scan, req.user),
      })),
      hasMore: rows.length > HISTORY_PAGE,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load the scan history.' });
  }
};

// GET /api/scans/:id — one scan (the user's own; any scan for admins) with the product, any
// report, and the sticker's journey as this viewer is allowed to see it.
const getScan = async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(404).json({ message: 'Scan not found.' });
    }
    const scan = await Scan.findOne({
      where: { id: req.params.id, ...historyScope(req.user) },
      include: [
        { model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] },
        { model: ScanReport, as: 'report' },
        { model: User, as: 'user', attributes: SCANNER_ATTRIBUTES },
      ],
    });
    if (!scan) {
      return res.status(404).json({ message: 'Scan not found.' });
    }

    let firstViewedAt = null;
    let journeyInfo = { journeyScope: 'own', buyerVerifiedAt: null, journey: [] };
    if (scan.qrCode) {
      const [earlier, info] = await Promise.all([
        scan.result === 'ALREADY_VIEWED' ? firstReveal(scan.qrCodeId, scan.id) : null,
        buildJourney(scan.qrCode, req.user),
      ]);
      firstViewedAt = earlier?.imageRevealedAt ?? null;
      journeyInfo = info;
    }

    nameScanLocation(scan);
    return res.status(200).json({
      scan: { ...scanJson(scan), location: locationJson(scan), qrCodeId: scan.qrCodeId, qrCodeUuid: scan.qrCode?.uuid ?? null },
      scannedBy: scannedByJson(scan, req.user),
      product: scan.qrCode ? productJson(scan.qrCode) : null,
      report: scan.report ? reportJson(scan.report) : null,
      firstViewedAt,
      ...journeyInfo,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load this scan.' });
  }
};

// GET /api/scans/journey/:uuid — a sticker's full journey, by its QR ID. Only for admins and
// the user who generated the sticker's batch (the "journey" link on their QR stickers).
const getJourney = async (req, res) => {
  try {
    const codeRow = await QrCode.findOne({
      where: { uuid: req.params.uuid },
      include: [{ model: QrBatch, as: 'batch' }],
    });
    if (!codeRow) {
      return res.status(404).json({ message: 'Sticker not found.' });
    }
    if (!canSeeFullJourney(req.user, codeRow)) {
      return res.status(403).json({ message: "Only the sticker's creator and admins can see its full journey." });
    }

    return res.status(200).json({
      qrCodeUuid: codeRow.uuid,
      product: productJson(codeRow),
      ...(await buildJourney(codeRow, req.user)),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load this journey.' });
  }
};

// GET /api/scans/summary — totals and latest scans for the Home / Scan dashboard: the user's
// own, or everyone's for admins. Rolled-back or unanswered verifications count as scans only.
const getSummary = async (req, res) => {
  try {
    const where = historyScope(req.user);
    const [counts, recent] = await Promise.all([
      Scan.findAll({
        where,
        attributes: ['action', 'result', [Scan.sequelize.fn('COUNT', Scan.sequelize.col('id')), 'count']],
        group: ['action', 'result'],
        raw: true,
      }),
      Scan.findAll({
        where,
        include: [
          { model: QrCode, as: 'qrCode', include: [{ model: QrBatch, as: 'batch' }] },
          { model: User, as: 'user', attributes: SCANNER_ATTRIBUTES },
        ],
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
      scope: isAdminUser(req.user) ? 'all' : 'own',
      totals,
      recent: recent.map((scan) => ({
        ...scanJson(scan),
        productName: scan.qrCode?.batch?.productName ?? null,
        variantSize: scan.qrCode?.batch?.variantSize ?? null,
        scannedBy: scannedByJson(scan, req.user),
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load the scans.' });
  }
};

module.exports = { createScan, revealImage, settleScan, reportScan, getSummary, listScans, getScan, getJourney };
