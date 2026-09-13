const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { getStats } = require('../controllers/dashboardController');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/stats', getStats);

module.exports = router;
