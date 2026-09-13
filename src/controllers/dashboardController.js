const { ImageFolder, ImageAsset, QrBatch, QrCode, User } = require('../models');

// GET /api/dashboard/stats  (admin + super-admin)
const getStats = async (req, res) => {
  try {
    const [
      totalUsers,
      blockedUsers,
      usersByType,
      totalFolders,
      totalImages,
      blockedImages,
      totalBatches,
      totalCodes,
    ] = await Promise.all([
      User.count({ where: { isAdmin: false } }),
      User.count({ where: { isAdmin: false, isBlocked: true } }),
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
    ]);

    const stats = {
      users: {
        total: totalUsers,
        active: totalUsers - blockedUsers,
        blocked: blockedUsers,
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
      },
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
