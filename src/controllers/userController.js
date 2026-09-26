const { Op } = require('sequelize');
const { sequelize, User, UserProfileVersion, QrBatch } = require('../models');
const { publicUser } = require('./authController');
const { uploadFileToS3 } = require('../services/s3Service');
const { profileChanges, recordProfileVersion, historySummaries } = require('../utils/profileHistory');

const USER_TYPES = ['farmer', 'retailer', 'distributor', 'supplier', 'consumer'];

// Users as the admin list shows them: public fields plus a summary of past profile changes.
const withHistory = async (users) => {
  const summaries = await historySummaries(users.map((u) => u.id));
  return users.map((u) => ({ ...publicUser(u), profileHistory: summaries.get(u.id) }));
};
const withHistoryOne = async (user) => (await withHistory([user]))[0];

// GET /api/users/me
const getMe = async (req, res) => {
  return res.status(200).json({ user: publicUser(req.user) });
};

// PUT /api/users/me  (normal user edits their own profile)
const updateMe = async (req, res) => {
  try {
    const { name, email, userType, address } = req.body;
    const user = req.user;

    if (userType && !USER_TYPES.includes(userType)) {
      return res.status(400).json({ message: 'Invalid user category.' });
    }

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (userType !== undefined) user.userType = userType;
    if (address !== undefined) user.address = address;

    if (req.file) {
      const uploadedUrl = await uploadFileToS3(req.file, 'profile-photos');
      user.photoUrl = uploadedUrl;
    }

    user.profileCompleted = true;
    await sequelize.transaction(async (transaction) => {
      await user.save({ transaction });
      await recordProfileVersion(user, { source: 'self', changedBy: user.id, transaction });
    });

    return res.status(200).json({ message: 'Profile updated.', user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'Could not update profile.' });
  }
};

// POST /api/users/me/skip  (mark onboarding as seen without filling the form)
const skipOnboarding = async (req, res) => {
  try {
    const user = req.user;
    user.profileCompleted = true;
    await user.save();
    return res.status(200).json({ message: 'Skipped.', user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update profile.' });
  }
};

// GET /api/users  (admin only) ?search=&status=all|active|blocked
const listUsers = async (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;

    const where = { isAdmin: false };

    if (search) {
      const pattern = `%${search}%`;
      where[Op.or] = [
        { name: { [Op.like]: pattern } },
        { mobile: { [Op.like]: pattern } },
        // Also match names and numbers the user had before, so searching "Harish" still finds
        // the account now called Kumar.
        {
          id: {
            [Op.in]: sequelize.literal(
              `(SELECT user_id FROM user_profile_versions WHERE name LIKE ${sequelize.escape(pattern)} OR mobile LIKE ${sequelize.escape(pattern)})`
            ),
          },
        },
      ];
    }

    if (status === 'active') where.isBlocked = false;
    if (status === 'blocked') where.isBlocked = true;

    const users = await User.findAll({ where, order: [['created_at', 'DESC']] });

    const total = users.length;
    const blocked = users.filter((u) => u.isBlocked).length;

    return res.status(200).json({
      total,
      active: total - blocked,
      blocked,
      users: await withHistory(users),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load users.' });
  }
};

// POST /api/users  (admin adds a new user manually)
const createUser = async (req, res) => {
  try {
    const { mobile, name, email, userType, address } = req.body;

    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }

    const existing = await User.findOne({ where: { mobile } });
    if (existing) {
      return res.status(409).json({ message: 'A user with this mobile number already exists.' });
    }

    if (userType && !USER_TYPES.includes(userType)) {
      return res.status(400).json({ message: 'Invalid user category.' });
    }

    const user = await sequelize.transaction(async (transaction) => {
      const created = await User.create(
        {
          mobile,
          countryCode: '+91',
          name,
          email,
          userType,
          address,
          isAdmin: false,
          isBlocked: false,
          profileCompleted: Boolean(name),
        },
        { transaction }
      );
      await recordProfileVersion(created, { source: 'admin', changedBy: req.user.id, transaction });
      return created;
    });

    return res.status(201).json({ message: 'User added.', user: await withHistoryOne(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not add user.' });
  }
};

// PUT /api/users/:id  (admin edits any user's details)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, userType, address, mobile } = req.body;

    const user = await User.findByPk(id);
    if (!user || user.isAdmin) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (userType && !USER_TYPES.includes(userType)) {
      return res.status(400).json({ message: 'Invalid user category.' });
    }

    if (mobile && mobile !== user.mobile) {
      const clash = await User.findOne({ where: { mobile } });
      if (clash) {
        return res.status(409).json({ message: 'Another user already has this mobile number.' });
      }
      user.mobile = mobile;
    }

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (userType !== undefined) user.userType = userType;
    if (address !== undefined) user.address = address;

    await sequelize.transaction(async (transaction) => {
      await user.save({ transaction });
      await recordProfileVersion(user, { source: 'admin', changedBy: req.user.id, transaction });
    });

    return res.status(200).json({ message: 'User updated.', user: await withHistoryOne(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update user.' });
  }
};

// PATCH /api/users/:id/block
const blockUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user || user.isAdmin) {
      return res.status(404).json({ message: 'User not found.' });
    }
    user.isBlocked = true;
    await user.save();
    return res.status(200).json({ message: 'User blocked.', user: await withHistoryOne(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not block user.' });
  }
};

// PATCH /api/users/:id/unblock
const unblockUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user || user.isAdmin) {
      return res.status(404).json({ message: 'User not found.' });
    }
    user.isBlocked = false;
    await user.save();
    return res.status(200).json({ message: 'User unblocked.', user: await withHistoryOne(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not unblock user.' });
  }
};

// GET /api/users/:id/history  (admin only) — every version of the user's details, oldest
// first, with what changed in each, and the QR batches they generated under each version.
const getUserHistory = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const [versions, batches] = await Promise.all([
      UserProfileVersion.findAll({
        where: { userId: user.id },
        include: [{ model: User, as: 'editor', attributes: ['id', 'name', 'username'] }],
        order: [['versionNo', 'ASC']],
      }),
      QrBatch.findAll({ where: { createdBy: user.id }, order: [['createdAt', 'DESC']] }),
    ]);

    return res.status(200).json({
      user: publicUser(user),
      versions: versions.map((v, i) => ({
        id: v.id,
        versionNo: v.versionNo,
        name: v.name,
        email: v.email,
        address: v.address,
        userType: v.userType,
        mobile: v.mobile,
        source: v.source,
        changedBy: v.editor ? { id: v.editor.id, name: v.editor.name || v.editor.username } : null,
        changes: i === 0 ? [] : profileChanges(versions[i - 1], v),
        createdAt: v.createdAt,
      })),
      batches: batches.map((b) => ({
        id: b.id,
        producer: b.producer,
        productName: b.productName,
        variantSize: b.variantSize,
        batchNo: b.batchNo,
        numberOfQrs: b.numberOfQrs,
        profileVersionId: b.creatorProfileVersionId,
        createdAt: b.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load profile history.' });
  }
};

module.exports = {
  getMe,
  updateMe,
  skipOnboarding,
  listUsers,
  createUser,
  updateUser,
  blockUser,
  unblockUser,
  getUserHistory,
};
