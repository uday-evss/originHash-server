const { Op } = require('sequelize');
const { User } = require('../models');
const { publicUser } = require('./authController');

const USER_TYPES = ['farmer', 'retailer', 'distributor', 'supplier', 'consumer'];

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
      user.photoUrl = `${process.env.BASE_URL}/uploads/${req.file.filename}`;
    }

    user.profileCompleted = true;
    await user.save();

    return res.status(200).json({ message: 'Profile updated.', user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update profile.' });
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
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { mobile: { [Op.like]: `%${search}%` } },
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
      users: users.map(publicUser),
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

    const user = await User.create({
      mobile,
      countryCode: '+91',
      name,
      email,
      userType,
      address,
      isAdmin: false,
      isBlocked: false,
      profileCompleted: Boolean(name),
    });

    return res.status(201).json({ message: 'User added.', user: publicUser(user) });
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

    await user.save();

    return res.status(200).json({ message: 'User updated.', user: publicUser(user) });
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
    return res.status(200).json({ message: 'User blocked.', user: publicUser(user) });
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
    return res.status(200).json({ message: 'User unblocked.', user: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not unblock user.' });
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
};
