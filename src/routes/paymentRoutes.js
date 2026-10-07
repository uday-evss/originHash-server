const express = require('express');
const { razorpayWebhook } = require('../controllers/walletController');

const router = express.Router();

// Public: Razorpay's servers call this. Authenticated by the webhook signature instead of a login.
router.post('/razorpay/webhook', razorpayWebhook);

module.exports = router;
