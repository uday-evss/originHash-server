const { sequelize, Wallet, WalletTopup, WalletTransaction } = require('../models');
const razorpay = require('./razorpayService');
const { planConfig } = require('../config/plans');

const MIN_TOPUP_PAISE = 100 * 100; // ₹100
const MAX_TOPUP_PAISE = 200000 * 100; // ₹2,00,000 per payment
const MAX_BALANCE_PAISE = 1000000 * 100; // ₹10,00,000 held in one wallet

// Sticker billing is on once Razorpay keys are configured, so the code can ship before the keys
// do: until then stickers stay free, exactly as before. QR_PRICE_PAISE overrides the price.
const billingConfig = () => ({
  enabled: razorpay.isConfigured(),
  currency: 'INR',
  pricePerQrPaise: planConfig().paygPricePerQrPaise, // Pay As You Go
  minTopupPaise: MIN_TOPUP_PAISE,
  maxTopupPaise: MAX_TOPUP_PAISE,
  maxBalancePaise: MAX_BALANCE_PAISE,
});

// One line for the server log: is billing on, with which kind of keys, and is anything missing.
const billingStatus = () => {
  const { keyId, webhookSecret } = razorpay.config();
  const config = billingConfig();
  if (!config.enabled) {
    return keyId
      ? 'Sticker billing: OFF — RAZORPAY_KEY_SECRET is missing.'
      : 'Sticker billing: OFF (stickers are free) — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to turn it on.';
  }
  const mode = keyId.startsWith('rzp_live_') ? 'LIVE' : keyId.startsWith('rzp_test_') ? 'TEST' : 'UNKNOWN';
  const notes = [];
  if (mode === 'UNKNOWN') notes.push('RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_');
  if (!webhookSecret) notes.push('RAZORPAY_WEBHOOK_SECRET is not set, so payments are only confirmed while the payer keeps the page open');
  return `Sticker billing: ON (${mode} keys, ${formatRupees(config.pricePerQrPaise)} per sticker)${notes.length ? ` — warning: ${notes.join('; ')}.` : ''}`;
};

const formatRupees = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// The user's wallet, created empty on first use. One query when it exists (findOrCreate would
// open its own transaction: several round trips). Safe under concurrent first calls: user_id is
// unique, so a racing create fails and the winner's row is read instead.
const ensureWallet = async (userId) => {
  const existing = await Wallet.findOne({ where: { userId } });
  if (existing) return existing;
  try {
    return await Wallet.create({ userId, balancePaise: 0 });
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    return Wallet.findOne({ where: { userId } });
  }
};

// The wallet row locked for update until `transaction` ends: no other request can read-then-write
// this balance in between, so two purchases can't both spend the same money.
const lockWallet = async (userId, transaction) => {
  const wallet = await Wallet.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!wallet) throw httpError(500, 'Wallet not found.');
  return wallet;
};

// Applies a signed amount to a locked wallet and records it in the ledger.
const applyToWallet = async (wallet, { amountPaise, type, description, topupId = null, batchId = null }, transaction) => {
  const balanceAfterPaise = wallet.balancePaise + amountPaise;
  if (balanceAfterPaise < 0) throw httpError(402, 'Insufficient wallet balance.');
  await wallet.update({ balancePaise: balanceAfterPaise }, { transaction });
  return WalletTransaction.create(
    { userId: wallet.userId, type, amountPaise, balanceAfterPaise, description, topupId, batchId },
    { transaction }
  );
};

const PAYMENT_METHODS = { upi: 'UPI', card: 'card', netbanking: 'net banking', wallet: 'wallet', emi: 'EMI', paylater: 'pay later' };

// Credits a top-up from a Razorpay payment — exactly once. Called by both the browser's verify
// step and the webhook (whichever arrives first wins; the other finds it already PAID).
// `payment` must come from Razorpay itself (API fetch or a signature-checked webhook), never
// from the browser.
const settleTopup = async ({ orderId, payment, userId = null }) => {
  const pending = await WalletTopup.findOne({ where: { razorpayOrderId: orderId } });
  // Someone else's order looks exactly like a missing one.
  if (!pending || (userId !== null && pending.userId !== userId)) throw httpError(404, 'Payment not found.');
  await ensureWallet(pending.userId);

  return sequelize.transaction(async (transaction) => {
    const topup = await WalletTopup.findOne({
      where: { id: pending.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (topup.status === 'PAID') {
      const wallet = await Wallet.findOne({ where: { userId: topup.userId }, transaction });
      return { topup, balancePaise: wallet.balancePaise, alreadyPaid: true };
    }

    if (payment.order_id !== orderId) throw httpError(400, 'This payment belongs to a different order.');
    if (payment.currency !== topup.currency || Number(payment.amount) !== topup.amountPaise) {
      throw httpError(400, 'The paid amount does not match this top-up. Contact support.');
    }
    if (payment.status !== 'captured') throw httpError(409, 'The payment has not been completed yet.');

    const wallet = await lockWallet(topup.userId, transaction);
    if (wallet.balancePaise + topup.amountPaise > MAX_BALANCE_PAISE) {
      // Checked when the order was made; only a concurrent top-up could get here. Leave it for support.
      throw httpError(409, 'This top-up would take the wallet over its limit. Contact support.');
    }

    const method = PAYMENT_METHODS[payment.method] || payment.method || null;
    await topup.update(
      { status: 'PAID', razorpayPaymentId: payment.id, method: payment.method || null, lastError: null, paidAt: new Date() },
      { transaction }
    );
    await applyToWallet(
      wallet,
      {
        amountPaise: topup.amountPaise,
        type: 'TOPUP',
        topupId: topup.id,
        description: `Added via Razorpay${method ? ` (${method})` : ''}`,
      },
      transaction
    );
    return { topup, balancePaise: wallet.balancePaise, alreadyPaid: false };
  });
};

module.exports = {
  billingConfig,
  billingStatus,
  formatRupees,
  httpError,
  ensureWallet,
  lockWallet,
  applyToWallet,
  settleTopup,
};
