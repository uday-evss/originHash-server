const express = require('express');
const { protect } = require('../middleware/auth');
const { getCatalog, subscribe, cancel, resume, cancelScheduled } = require('../controllers/planController');

const router = express.Router();

// Each signed-in user manages only their own plan, paid from their own wallet.
router.use(protect);

router.get('/', getCatalog);
router.post('/subscribe', subscribe);
router.post('/cancel', cancel);
router.post('/resume', resume);
router.post('/scheduled/cancel', cancelScheduled);

module.exports = router;
