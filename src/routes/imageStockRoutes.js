const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  listFolders,
  createFolder,
  createSampleFolder,
  deleteFolder,
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

// Admin+ test data: a randomly named folder of 10 photos (dog, cat, human, peacock, lion, …).
// These sample folders are the one exception to "no deleting"; QR batches made from one keep
// their stickers and photos after it's deleted.
router.post('/folders/sample', adminOnly, createSampleFolder);
router.delete('/folders/:id', adminOnly, deleteFolder);

module.exports = router;
