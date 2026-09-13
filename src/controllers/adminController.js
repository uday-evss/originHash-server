const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const { publicUser } = require('./authController');

// GET /api/admins  (super-admin only) ?search=
const listAdmins = async (req, res) => {
  try {
    const { search = '' } = req.query;

    const where = { isAdmin: true };
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { username: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const admins = await User.findAll({ where, order: [['created_at', 'DESC']] });
    return res.status(200).json({ admins: admins.map(publicUser) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not load admins.' });
  }
};

// POST /api/admins  (super-admin only)
const createAdmin = async (req, res) => {
  try {
    const { username, password, name, email, isSuperAdmin } = req.body;

    if (!username?.trim() || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ where: { username: username.trim() } });
    if (existing) {
      return res.status(409).json({ message: 'An account with this username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await User.create({
      username: username.trim(),
      passwordHash,
      name,
      email,
      isAdmin: true,
      isSuperAdmin: Boolean(isSuperAdmin),
      isBlocked: false,
      profileCompleted: true,
    });

    return res.status(201).json({ message: 'Admin created.', admin: publicUser(admin) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not create admin.' });
  }
};

// PUT /api/admins/:id  (super-admin only)
const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, name, email, isSuperAdmin, isBlocked } = req.body;

    const admin = await User.findByPk(id);
    if (!admin || !admin.isAdmin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    const isSelf = req.user.id === admin.id;
    if (isSelf && isSuperAdmin === false) {
      return res.status(400).json({ message: 'You cannot remove your own super-admin access.' });
    }
    if (isSelf && isBlocked === true) {
      return res.status(400).json({ message: 'You cannot block your own account.' });
    }

    if (username && username.trim() !== admin.username) {
      const clash = await User.findOne({ where: { username: username.trim() } });
      if (clash) {
        return res.status(409).json({ message: 'Another account already has this username.' });
      }
      admin.username = username.trim();
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters.' });
      }
      admin.passwordHash = await bcrypt.hash(password, 10);
    }

    if (name !== undefined) admin.name = name;
    if (email !== undefined) admin.email = email;
    if (isSuperAdmin !== undefined) admin.isSuperAdmin = Boolean(isSuperAdmin);
    if (isBlocked !== undefined) admin.isBlocked = Boolean(isBlocked);

    await admin.save();

    return res.status(200).json({ message: 'Admin updated.', admin: publicUser(admin) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not update admin.' });
  }
};

const MOBILE_REGEX = /^[6-9]\d{9}$/;

// PATCH /api/admins/:id/promote  (super-admin only) — turns a normal user into an admin
const promoteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, isSuperAdmin } = req.body;

    const user = await User.findByPk(id);
    if (!user || user.isAdmin) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (!username?.trim() || !password) {
      return res.status(400).json({ message: 'Username and password are required to promote a user to admin.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const clash = await User.findOne({ where: { username: username.trim() } });
    if (clash) {
      return res.status(409).json({ message: 'An account with this username already exists.' });
    }

    user.username = username.trim();
    user.passwordHash = await bcrypt.hash(password, 10);
    user.isAdmin = true;
    user.isSuperAdmin = Boolean(isSuperAdmin);
    await user.save();

    return res.status(200).json({ message: 'User promoted to admin.', admin: publicUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not promote user.' });
  }
};

// PATCH /api/admins/:id/demote  (super-admin only) — turns an admin back into a normal user
const demoteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { mobile } = req.body;

    const admin = await User.findByPk(id);
    if (!admin || !admin.isAdmin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    if (req.user.id === admin.id) {
      return res.status(400).json({ message: 'You cannot demote your own account.' });
    }

    if (!admin.mobile) {
      if (!mobile || !MOBILE_REGEX.test(mobile)) {
        return res.status(400).json({
          message: 'This admin has no mobile number on file — enter a valid 10-digit number so they can log in as a normal user.',
        });
      }
      const clash = await User.findOne({ where: { mobile } });
      if (clash) {
        return res.status(409).json({ message: 'Another account already has this mobile number.' });
      }
      admin.mobile = mobile;
    }

    admin.isAdmin = false;
    admin.isSuperAdmin = false;
    admin.username = null;
    admin.passwordHash = null;
    await admin.save();

    return res.status(200).json({ message: 'Admin demoted to normal user.', user: publicUser(admin) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not demote admin.' });
  }
};

module.exports = { listAdmins, createAdmin, updateAdmin, promoteUser, demoteAdmin };
