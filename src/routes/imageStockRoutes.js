const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  listFolders,
  createFolder,
  listImages,
  uploadImages,
  blockImage,
  unblockImage,
  deleteImage,
} = require('../controllers/imageStockController');

const router = express.Router();

// Any logged-in user (normal user, admin, or super-admin) — not admin-only.
router.use(protect);

router.get('/folders', listFolders);
router.post('/folders', createFolder);
router.post('/folders/:id/images', upload.array('images', 20), uploadImages);

router.get('/images', listImages);

// Blocking/deleting images stays admin+ only — normal users can browse and upload, not moderate.
router.patch('/images/:id/block', adminOnly, blockImage);
router.patch('/images/:id/unblock', adminOnly, unblockImage);
router.delete('/images/:id', adminOnly, deleteImage);

module.exports = router;
