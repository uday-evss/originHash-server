const { sequelize } = require('../models');
const { planConfig, parsePlanChoice } = require('../config/plans');
const { billingConfig, ensureWallet, lockWallet } = require('../services/walletService');
const { choosePlan, cancelPlan, resumePlan, discardScheduledChange, currentPlan, planJson } = require('../services/planService');

const sendError = (res, err, fallback) => {
  if (!err.status || err.status >= 500) console.error(err);
  const { status, message, code, balancePaise, requiredPaise, shortfallPaise } = err;
  return res
    .status(status || 500)
    .json(status ? { message, code, balancePaise, requiredPaise, shortfallPaise } : { message: fallback });
};

// GET /api/plans — the price list (Pay As You Go, Subscription, Fixed + Variable).
const getCatalog = (req, res) => res.status(200).json(planConfig());

// Runs one plan change for the signed-in user with their wallet locked, and replies with the
// resulting plan and balance.
const withWallet = (action, fallback) => async (req, res) => {
  try {
    if (!billingConfig().enabled) {
      return res.status(503).json({ message: 'Plans are not available yet. Please try again later.' });
    }
    await ensureWallet(req.user.id);
    const result = await sequelize.transaction(async (transaction) => {
      const wallet = await lockWallet(req.user.id, transaction);
      const outcome = await action(req, wallet, transaction);
      // Re-read so a cancelled or paused plan is reported as it now stands.
      const plan = await currentPlan(wallet, transaction);
      return { ...outcome, plan: planJson(plan), balancePaise: wallet.balancePaise };
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err, fallback);
  }
};

// POST /api/plans/subscribe  { planType, billingCycle, monthlyQuota }
const subscribe = withWallet(async (req, wallet, transaction) => {
  const { scheduled, message } = await choosePlan(wallet, parsePlanChoice(req.body || {}), transaction);
  return { scheduled, message };
}, 'Could not change your plan.');

// POST /api/plans/cancel — auto-renewal off (or end a paused plan).
const cancel = withWallet(async (req, wallet, transaction) => {
  const { message } = await cancelPlan(wallet, transaction);
  return { message };
}, 'Could not cancel your plan.');

// POST /api/plans/resume — auto-renewal on (or restart a paused plan now).
const resume = withWallet(async (req, wallet, transaction) => {
  const { message } = await resumePlan(wallet, transaction);
  return { message };
}, 'Could not resume your plan.');

// POST /api/plans/scheduled/cancel — keep the current plan at renewal.
const cancelScheduled = withWallet(async (req, wallet, transaction) => {
  const { message } = await discardScheduledChange(wallet, transaction);
  return { message };
}, 'Could not update your plan.');

module.exports = { getCatalog, subscribe, cancel, resume, cancelScheduled };
