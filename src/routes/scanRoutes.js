const express = require('express');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createScan,
  revealImage,
  settleScan,
  reportScan,
  getSummary,
  listScans,
  getScan,
} = require('../controllers/scanController');

const router = express.Router();

// Turn upload errors (too large, not an image) into a 400 the app can show, instead of a 500.
const reportPhoto = (req, res, next) =>
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (max 5 MB).' : err.message;
    return res.status(400).json({ message });
  });

// Any logged-in user (normal user or admin) — each sees only their own scans.
router.use(protect);

router.get('/', listScans);
router.post('/', createScan);
router.get('/summary', getSummary);
router.get('/:id', getScan);
router.post('/:id/reveal', revealImage);
router.post('/:id/report', reportPhoto, reportScan);
router.patch('/:id', settleScan);

module.exports = router;
