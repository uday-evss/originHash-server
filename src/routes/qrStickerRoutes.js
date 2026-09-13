const express = require('express');
const { protect } = require('../middleware/auth');
const {
  createBatch,
  listCodes,
  listFilters,
  verifyCode,
  downloadBatchPdf,
} = require('../controllers/qrStickerController');

const router = express.Router();

// Public — this is what a printed sticker's QR code links to.
router.get('/verify/:code', verifyCode);

// Any logged-in user (normal user, admin, or super-admin) — not admin-only.
router.use(protect);

router.post('/batches', createBatch);
router.get('/batches/:id/pdf', downloadBatchPdf);

router.get('/codes', listCodes);
router.get('/filters', listFilters);

module.exports = router;
