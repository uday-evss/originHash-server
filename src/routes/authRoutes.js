const express = require('express');
const { sendOtp, verifyOtp, adminLogin } = require('../controllers/authController');

const router = express.Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/admin-login', adminLogin);

module.exports = router;
