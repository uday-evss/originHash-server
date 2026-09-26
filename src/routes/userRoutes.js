const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  getMe,
  updateMe,
  skipOnboarding,
  listUsers,
  createUser,
  updateUser,
  blockUser,
  unblockUser,
  getUserHistory,
} = require('../controllers/userController');

const router = express.Router();

// Self-service (normal user or admin, on their own account)
router.get('/me', protect, getMe);
router.put('/me', protect, upload.single('photo'), updateMe);
router.post('/me/skip', protect, skipOnboarding);

// Admin-only user management
router.get('/', protect, adminOnly, listUsers);
router.post('/', protect, adminOnly, createUser);
router.put('/:id', protect, adminOnly, updateUser);
router.patch('/:id/block', protect, adminOnly, blockUser);
router.patch('/:id/unblock', protect, adminOnly, unblockUser);
router.get('/:id/history', protect, adminOnly, getUserHistory);

module.exports = router;
