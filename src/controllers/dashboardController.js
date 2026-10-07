const { Op } = require('sequelize');
const { ImageFolder, ImageAsset, QrBatch, QrCode, Scan, User } = require('../models');

const ACTIVITY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar day (YYYY-MM-DD) of `ms` for a viewer `offset` minutes east of UTC.
const dayKey = (ms, offset) => new Date(ms + offset * 60 * 1000).toISOString().slice(0, 10);

// GET /api/dashboard/stats?utcOffset=330  (admin + super-admin)
// utcOffset is the viewer's minutes east of UTC, so "today" and the daily scan buckets match their calendar.
const getStats = async (req, res) => {
  try {
    const offset = Math.max(-840, Math.min(840, Math.trunc(Number(req.query.utcOffset)) || 0));
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY_MS);
    const activityStart = new Date(now - (ACTIVITY_DAYS + 1) * DAY_MS);
    // A formatted string, not DATE(): mysql2 would turn a DATE into a Date at the server's local midnight.
    const localDay = Scan.sequelize.literal(
      `DATE_FORMAT(DATE_ADD(\`Scan\`.\`created_at\`, INTERVAL ${offset} MINUTE), '%Y-%m-%d')`
    );

    const [
      totalUsers,
      blockedUsers,
      newUsers,
      usersByType,
      totalFolders,
      totalImages,
      blockedImages,
      totalBatches,
      totalCodes,
      newCodes,
      scansByOutcome,
      scansByDay,
      recentBatches,
    ] = await Promise.all([
      User.count({ where: { isAdmin: false } }),
      User.count({ where: { isAdmin: false, isBlocked: true } }),
      User.count({ where: { isAdmin: false, createdAt: { [Op.gte]: weekAgo } } }),
      User.findAll({
        where: { isAdmin: false },
        attributes: ['userType', [User.sequelize.fn('COUNT', User.sequelize.col('id')), 'count']],
        group: ['userType'],
        raw: true,
      }),
      ImageFolder.count(),
      ImageAsset.count(),
      ImageAsset.count({ where: { isBlocked: true } }),
      QrBatch.count(),
      QrCode.count(),
      QrCode.count({ where: { createdAt: { [Op.gte]: weekAgo } } }),
      Scan.findAll({
        attributes: ['action', 'result', [Scan.sequelize.fn('COUNT', Scan.sequelize.col('id')), 'count']],
        group: ['action', 'result'],
        raw: true,
      }),
      Scan.findAll({
        where: { createdAt: { [Op.gte]: activityStart } },
        attributes: [[localDay, 'day'], [Scan.sequelize.fn('COUNT', Scan.sequelize.col('id')), 'count']],
        group: [localDay],
        raw: true,
      }),
      QrBatch.findAll({
        attributes: ['id', 'producer', 'productName', 'variantSize', 'batchNo', 'numberOfQrs', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 5,
      }),
    ]);

    // Verification outcomes: matched / mismatch / flagged (unknown or already-revealed sticker) / abandoned.
    const OUTCOME_OF = {
      MATCHED: 'matched',
      AUTHENTIC: 'matched',
      UNMATCHED: 'unmatched',
      NOT_FOUND: 'flagged',
      INVALID: 'flagged',
      ALREADY_VIEWED: 'flagged',
    };
    const scans = {
      total: 0,
      records: 0,
      verifications: 0,
      outcomes: { matched: 0, unmatched: 0, flagged: 0, abandoned: 0 },
    };
    for (const row of scansByOutcome) {
      const count = Number(row.count);
      scans.total += count;
      if (row.action === 'record') {
        scans.records += count;
        continue;
      }
      scans.verifications += count;
      scans.outcomes[OUTCOME_OF[row.result] || 'abandoned'] += count;
    }

    const perDay = new Map(scansByDay.map((row) => [row.day, Number(row.count)]));
    scans.daily = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const date = dayKey(now - (ACTIVITY_DAYS - 1 - i) * DAY_MS, offset);
      return { date, count: perDay.get(date) || 0 };
    });

    const stats = {
      users: {
        total: totalUsers,
        active: totalUsers - blockedUsers,
        blocked: blockedUsers,
        newLast7Days: newUsers,
        byType: usersByType.reduce((acc, row) => {
          acc[row.userType || 'unspecified'] = Number(row.count);
          return acc;
        }, {}),
      },
      imageStock: {
        folders: totalFolders,
        images: totalImages,
        availableImages: totalImages - blockedImages,
        blockedImages,
      },
      qrStickers: {
        batches: totalBatches,
        codes: totalCodes,
        codesLast7Days: newCodes,
        recentBatches: recentBatches.map((b) => ({
          id: b.id,
          producer: b.producer,
          productName: b.productName,
          variantSize: b.variantSize,
          batchNo: b.batchNo,
          numberOfQrs: b.numberOfQrs,
          createdAt: b.createdAt,
        })),
      },
      scans,
    };

    if (req.user.isSuperAdmin) {
      const [totalAdmins, totalSuperAdmins] = await Promise.all([
        User.count({ where: { isAdmin: true } }),
        User.count({ where: { isAdmin: true, isSuperAdmin: true } }),
      ]);
      stats.admins = {
        total: totalAdmins,
        superAdmins: totalSuperAdmins,
        regular: totalAdmins - totalSuperAdmins,
      };
    }

    return res.status(200).json(stats);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load dashboard stats.' });
  }
};

module.exports = { getStats };
