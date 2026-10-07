const { Op } = require('sequelize');
const { sequelize, Wallet, WalletTopup, WalletTransaction, PlanSubscription } = require('../models');
const { planConfig } = require('../config/plans');
const razorpay = require('../services/razorpayService');
const { billingConfig, formatRupees, ensureWallet, lockWallet, applyToWallet, settleTopup } = require('../services/walletService');
const { currentPlan, peekPlan, planJson } = require('../services/planService');

const TOPUPS_PER_WINDOW = 10;
const TOPUP_WINDOW_MS = 10 * 60 * 1000;
const ACTIVITY_PAGE_SIZE = 10;

const ORDER_ID = /^order_[A-Za-z0-9]{6,30}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,30}$/;

const sendError = (res, err, fallback) => {
  if (!err.status || err.status >= 500) console.error(err);
  return res.status(err.status || 500).json({ message: err.status ? err.message : fallback });
};

// GET /api/wallet — balance, current plan, the price list, and top-up limits for the signed-in user:
// everything the stickers page needs, in one request. The page opens on this, so the usual case is
// two plain reads in parallel; only when a plan's period or month has ended is it brought up to
// date (renewal / reset) under the wallet lock first.
const getWallet = async (req, res) => {
  try {
    const config = billingConfig();
    const [wallet, peek] = await Promise.all([
      Wallet.findOne({ where: { userId: req.user.id } }),
      config.enabled ? peekPlan(req.user.id) : { plan: null, stale: false },
    ]);
    let balancePaise = wallet ? wallet.balancePaise : 0; // no row yet = an empty wallet
    let { plan } = peek;
    if (peek.stale) {
      await ensureWallet(req.user.id);
      ({ balancePaise, plan } = await sequelize.transaction(async (transaction) => {
        const locked = await lockWallet(req.user.id, transaction);
        const refreshed = await currentPlan(locked, transaction);
        return { balancePaise: locked.balancePaise, plan: refreshed };
      }));
    }
    return res.status(200).json({
      ...config,
      balancePaise,
      plan: planJson(plan),
      catalog: config.enabled ? planConfig() : null,
      // Public by design: Checkout needs it in the browser. The key secret never leaves the server.
      razorpayKeyId: config.enabled ? razorpay.config().keyId : null,
    });
  } catch (err) {
    return sendError(res, err, 'Could not load your wallet.');
  }
};

// POST /api/wallet/topups  { amountPaise } — starts an "Add balance" payment. The amount is fixed
// here, on a Razorpay order, before the user sees the payment screen.
const createTopup = async (req, res) => {
  try {
    const config = billingConfig();
    if (!config.enabled) {
      return res.status(503).json({ message: 'Online payments are not set up yet. Please try again later.' });
    }

    const amountPaise = Number(req.body.amountPaise);
    if (!Number.isInteger(amountPaise) || amountPaise % 100 !== 0) {
      return res.status(400).json({ message: 'Enter the amount in whole rupees.' });
    }
    if (amountPaise < config.minTopupPaise || amountPaise > config.maxTopupPaise) {
      return res.status(400).json({
        message: `Add between ${formatRupees(config.minTopupPaise)} and ${formatRupees(config.maxTopupPaise)} at a time.`,
      });
    }

    const wallet = await ensureWallet(req.user.id);
    if (wallet.balancePaise + amountPaise > config.maxBalancePaise) {
      return res.status(400).json({
        message: `A wallet can hold up to ${formatRupees(config.maxBalancePaise)}. You can add up to ${formatRupees(
          Math.max(0, config.maxBalancePaise - wallet.balancePaise)
        )} right now.`,
      });
    }

    const recent = await WalletTopup.count({
      where: { userId: req.user.id, createdAt: { [Op.gte]: new Date(Date.now() - TOPUP_WINDOW_MS) } },
    });
    if (recent >= TOPUPS_PER_WINDOW) {
      return res.status(429).json({ message: 'Too many payment attempts. Please wait a few minutes and try again.' });
    }

    const order = await razorpay.createOrder({
      amountPaise,
      receipt: `wt_${req.user.id}_${Date.now()}`,
      notes: { purpose: 'wallet_topup', user_id: String(req.user.id) },
    });
    if (order.amount !== amountPaise || order.currency !== 'INR') {
      return res.status(502).json({ message: 'Razorpay returned an unexpected order. Please try again.' });
    }

    await WalletTopup.create({ userId: req.user.id, amountPaise, razorpayOrderId: order.id });

    const { name, email, mobile, countryCode } = req.user;
    return res.status(201).json({
      orderId: order.id,
      amountPaise,
      currency: 'INR',
      keyId: razorpay.config().keyId,
      prefill: {
        name: name || undefined,
        email: email || undefined,
        contact: mobile ? `${countryCode || '+91'}${mobile}` : undefined,
      },
    });
  } catch (err) {
    return sendError(res, err, 'Could not start the payment. Please try again.');
  }
};

// POST /api/wallet/topups/verify  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
// Called by the browser after Checkout succeeds. Trusts nothing it sends beyond the IDs: the
// signature must match, and the payment's amount and status are re-read from Razorpay.
const verifyTopup = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    if (!ORDER_ID.test(razorpayOrderId || '') || !PAYMENT_ID.test(razorpayPaymentId || '')) {
      return res.status(400).json({ message: 'Invalid payment details.' });
    }

    const topup = await WalletTopup.findOne({ where: { razorpayOrderId, userId: req.user.id } });
    if (!topup) return res.status(404).json({ message: 'Payment not found.' });

    if (!razorpay.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return res.status(400).json({ message: 'The payment could not be verified. If money was deducted, contact support.' });
    }

    let payment = await razorpay.fetchPayment(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId) {
      return res.status(400).json({ message: 'This payment belongs to a different order.' });
    }
    if (payment.status === 'failed') {
      await topup.update({ lastError: (payment.error_description || 'Payment failed').slice(0, 255) });
      return res.status(402).json({ message: payment.error_description || 'The payment failed. Please try again.' });
    }
    if (payment.status === 'authorized') {
      payment = await razorpay.capturePayment(payment.id, topup.amountPaise);
    }

    const result = await settleTopup({ orderId: razorpayOrderId, payment, userId: req.user.id });
    return res.status(200).json({
      message: `${formatRupees(result.topup.amountPaise)} added to your wallet.`,
      amountPaise: result.topup.amountPaise,
      balancePaise: result.balancePaise,
      alreadyCredited: result.alreadyPaid,
    });
  } catch (err) {
    return sendError(res, err, 'Could not confirm the payment. If money was deducted, it will be added shortly.');
  }
};

// POST /api/wallet/reset — TEST MODE ONLY: empties the wallet and ends any plan, so payments and
// plans can be tried again from scratch. Refused whenever live Razorpay keys are configured, so it
// can never touch real money. Recorded as an ADJUSTMENT, so the activity still adds up.
const resetWallet = async (req, res) => {
  try {
    if (!razorpay.config().keyId.startsWith('rzp_test_')) {
      return res.status(403).json({ message: 'Resetting the wallet is only available with Razorpay test keys.' });
    }
    await ensureWallet(req.user.id);
    const balancePaise = await sequelize.transaction(async (transaction) => {
      const wallet = await lockWallet(req.user.id, transaction);
      await PlanSubscription.update(
        { status: 'ENDED', endedReason: 'RESET', endedAt: new Date() },
        { where: { userId: req.user.id, status: ['ACTIVE', 'PAUSED'] }, transaction }
      );
      if (wallet.balancePaise > 0) {
        await applyToWallet(
          wallet,
          { amountPaise: -wallet.balancePaise, type: 'ADJUSTMENT', description: 'Test-mode reset to ₹0' },
          transaction
        );
      }
      return wallet.balancePaise;
    });
    return res.status(200).json({ message: 'Wallet reset to ₹0 and plan cleared (test mode).', balancePaise, plan: null });
  } catch (err) {
    return sendError(res, err, 'Could not reset the wallet.');
  }
};

// GET /api/wallet/transactions?page= — the wallet's ledger, newest first.
const listTransactions = async (req, res) => {
  try {
    const requested = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
    const total = await WalletTransaction.count({ where: { userId: req.user.id } });
    const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
    const page = Math.min(requested, totalPages);
    const rows = await WalletTransaction.findAll({
      where: { userId: req.user.id },
      order: [['id', 'DESC']],
      limit: ACTIVITY_PAGE_SIZE,
      offset: (page - 1) * ACTIVITY_PAGE_SIZE,
    });
    return res.status(200).json({
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        amountPaise: row.amountPaise,
        balanceAfterPaise: row.balanceAfterPaise,
        description: row.description,
        batchId: row.batchId,
        createdAt: row.createdAt,
      })),
      total,
      page,
      totalPages,
    });
  } catch (err) {
    return sendError(res, err, 'Could not load your wallet activity.');
  }
};

// POST /api/payments/razorpay/webhook — Razorpay calls this for every payment event, so a top-up
// is credited even if the user closed the tab before the browser could verify it.
// Configure in Dashboard → Webhooks with events payment.captured, order.paid and payment.failed.
const razorpayWebhook = async (req, res) => {
  if (!razorpay.config().webhookSecret) {
    return res.status(503).json({ message: 'Webhook not configured.' });
  }
  if (!razorpay.verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature'))) {
    return res.status(400).json({ message: 'Invalid signature.' });
  }

  const { event, payload } = req.body || {};
  const payment = payload?.payment?.entity;
  if (!payment?.order_id) return res.status(200).json({ received: true });

  try {
    if (event === 'payment.captured' || event === 'order.paid') {
      await settleTopup({ orderId: payment.order_id, payment });
    } else if (event === 'payment.failed') {
      await WalletTopup.update(
        { lastError: (payment.error_description || 'Payment failed').slice(0, 255) },
        { where: { razorpayOrderId: payment.order_id, status: 'CREATED' } }
      );
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    // Not one of our orders, or a mismatch a retry can't fix: acknowledge so Razorpay stops retrying.
    if (err.status && err.status < 500) {
      if (err.status !== 404) console.error(`Razorpay webhook ${event} for ${payment.order_id}: ${err.message}`);
      return res.status(200).json({ received: true });
    }
    console.error(err);
    return res.status(500).json({ message: 'Could not process the event.' }); // Razorpay retries
  }
};

module.exports = { getWallet, createTopup, verifyTopup, listTransactions, resetWallet, razorpayWebhook };
