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
} = require('../controllers/imageStockController');

const router = express.Router();

// Any logged-in user (normal user, admin, or super-admin) — not admin-only.
router.use(protect);

router.get('/folders', listFolders);
router.post('/folders', createFolder);
router.post('/folders/:id/images', upload.array('images', 20), uploadImages);

router.get('/images', listImages);

// Blocking images stays admin+ only — normal users can browse and upload, not moderate.
// Images can't be deleted by anyone: printed stickers keep pointing at them (it's the photo
// buyers compare against). Block an image instead to keep it out of new stickers.
router.patch('/images/:id/block', adminOnly, blockImage);
router.patch('/images/:id/unblock', adminOnly, unblockImage);

module.exports = router;
