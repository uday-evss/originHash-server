const express = require('express');
const { protect } = require('../middleware/auth');
const { createScan, getSummary } = require('../controllers/scanController');

const router = express.Router();

// Any logged-in user (normal user or admin) — each sees only their own scans.
router.use(protect);

router.post('/', createScan);
router.get('/summary', getSummary);

module.exports = router;
