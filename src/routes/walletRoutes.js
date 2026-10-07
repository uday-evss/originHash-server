const express = require('express');
const { protect } = require('../middleware/auth');
const { getWallet, createTopup, verifyTopup, listTransactions, resetWallet } = require('../controllers/walletController');

const router = express.Router();

// Every signed-in user has their own wallet; nobody can read or top up anyone else's.
router.use(protect);

router.get('/', getWallet);
router.get('/transactions', listTransactions);
router.post('/topups', createTopup);
router.post('/topups/verify', verifyTopup);
router.post('/reset', resetWallet); // test keys only

module.exports = router;
