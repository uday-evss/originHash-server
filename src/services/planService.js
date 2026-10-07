const { Op } = require('sequelize');
const { sequelize, PlanSubscription } = require('../models');
const { planConfig, planTerms, describePlan } = require('../config/plans');
const { applyToWallet, formatRupees, httpError, lockWallet } = require('./walletService');

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 15 * 60 * 1000;

// Calendar months in UTC; a day that doesn't exist clamps to the month's end (31 Jan + 1 → 28/29 Feb).
const addMonths = (date, months) => {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

const choiceOf = (sub) => ({ planType: sub.planType, billingCycle: sub.billingCycle, monthlyQuota: sub.monthlyQuota });
const nextChoiceOf = (sub) =>
  sub.nextPlanType
    ? { planType: sub.nextPlanType, billingCycle: sub.nextBillingCycle, monthlyQuota: sub.nextMonthlyQuota }
    : null;
// What the plan renews into: the scheduled change if there is one, else the same plan again.
// Fixed + Variable only bills monthly, so it always renews monthly.
const renewalChoiceOf = (sub) => {
  const choice = nextChoiceOf(sub) || choiceOf(sub);
  return choice.planType === 'FIXED_VARIABLE' ? { ...choice, billingCycle: 'MONTHLY' } : choice;
};
const sameChoice = (a, b) =>
  a.planType === b.planType && a.billingCycle === b.billingCycle && a.monthlyQuota === b.monthlyQuota;
const NO_NEXT = { nextPlanType: null, nextBillingCycle: null, nextMonthlyQuota: null };

// Charges the wallet for a plan and starts a new period at `start`. The wallet must be locked.
const startPlan = async (wallet, choice, transaction, { start = new Date(), renewal = false } = {}) => {
  const terms = planTerms(choice);
  await applyToWallet(
    wallet,
    {
      amountPaise: -terms.pricePaise,
      type: renewal ? 'PLAN_RENEWAL' : 'PLAN_PURCHASE',
      description: `${renewal ? 'Renewed' : 'Bought'}: ${describePlan(terms)}`,
    },
    transaction
  );
  return PlanSubscription.create(
    {
      userId: wallet.userId,
      planType: terms.planType,
      billingCycle: terms.billingCycle,
      monthlyQuota: terms.monthlyQuota,
      pricePaise: terms.pricePaise,
      overagePricePaise: terms.overagePricePaise,
      status: 'ACTIVE',
      autoRenew: true,
      periodStart: start,
      periodEnd: addMonths(start, terms.months),
      cycleStart: start,
      cycleEnd: addMonths(start, 1),
      cycleUsed: 0,
    },
    { transaction }
  );
};

// The period is over: renew from the wallet, end it (auto-renew off), or pause it (balance short).
const renew = async (sub, wallet, transaction, now) => {
  if (!sub.autoRenew) {
    await sub.update({ status: 'ENDED', endedReason: 'CANCELLED', endedAt: now }, { transaction });
    return null;
  }
  const choice = renewalChoiceOf(sub);
  if (wallet.balancePaise < planTerms(choice).pricePaise) {
    await sub.update({ status: 'PAUSED' }, { transaction });
    return null;
  }
  await sub.update({ status: 'ENDED', endedReason: 'RENEWED', endedAt: now }, { transaction });
  // Renewed on time: the new period follows on without a gap. Renewed late (the server was asleep,
  // or the user was away): it starts now, so nobody pays for weeks they couldn't use.
  const start = now - sub.periodEnd < DAY_MS ? sub.periodEnd : now;
  return startPlan(wallet, choice, transaction, { start, renewal: true });
};

// Brings the user's plan up to date and returns the ACTIVE one (or null). Call with the wallet
// locked: renews ended periods, and resets the allowance when a new month of the period starts.
const refreshPlan = async (wallet, transaction, now = new Date()) => {
  const sub = await PlanSubscription.findOne({
    where: { userId: wallet.userId, status: 'ACTIVE' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!sub) return null;
  if (now >= sub.periodEnd) return renew(sub, wallet, transaction, now);

  if (now >= sub.cycleEnd) {
    // Which month of the period are we in? (Unused codes from earlier months expire.)
    let k = 1;
    while (addMonths(sub.periodStart, k + 1) <= now) k += 1;
    const cycleEnd = addMonths(sub.periodStart, k + 1);
    await sub.update(
      {
        cycleStart: addMonths(sub.periodStart, k),
        cycleEnd: cycleEnd > sub.periodEnd ? sub.periodEnd : cycleEnd,
        cycleUsed: 0,
      },
      { transaction }
    );
  }
  return sub;
};

const findPaused = (userId, transaction) =>
  PlanSubscription.findOne({ where: { userId, status: 'PAUSED' }, order: [['id', 'DESC']], transaction, lock: transaction.LOCK.UPDATE });

// ---------- Stickers ----------

// How a batch of `count` stickers is paid: first from the plan's remaining monthly allowance, the
// rest at the overage price (₹15 on Fixed + Variable; Pay As You Go on Subscription or no plan).
const quoteBatch = (count, sub) => {
  const config = planConfig();
  const remaining = sub ? Math.max(0, sub.monthlyQuota - sub.cycleUsed) : 0;
  const coveredCount = Math.min(count, remaining);
  const extraCount = count - coveredCount;
  const extraPricePaise = sub ? sub.overagePricePaise : config.paygPricePerQrPaise;
  return { coveredCount, extraCount, extraPricePaise, totalPaise: extraCount * extraPricePaise };
};

// Charges a just-created batch inside the caller's transaction (wallet locked, plan refreshed).
const chargeForBatch = async (wallet, sub, { batch, count }, transaction) => {
  const quote = quoteBatch(count, sub);
  const parts = [];
  if (quote.coveredCount) parts.push(`${quote.coveredCount.toLocaleString('en-IN')} from plan`);
  if (quote.extraCount) parts.push(`${quote.extraCount.toLocaleString('en-IN')} × ${formatRupees(quote.extraPricePaise)}`);
  await applyToWallet(
    wallet,
    {
      amountPaise: -quote.totalPaise,
      type: 'STICKER_CHARGE',
      batchId: batch.id,
      description: `${count.toLocaleString('en-IN')} sticker${count === 1 ? '' : 's'} (${parts.join(' + ')}) · Batch ${batch.batchNo}`,
    },
    transaction
  );
  // Safe as a read-then-write: the wallet lock serialises every change to this user's plan.
  if (quote.coveredCount) await sub.update({ cycleUsed: sub.cycleUsed + quote.coveredCount }, { transaction });
  await batch.update(
    {
      pricePerQrPaise: quote.extraCount ? quote.extraPricePaise : null,
      amountChargedPaise: quote.totalPaise,
      planCoveredCount: quote.coveredCount,
    },
    { transaction }
  );
  return quote;
};

// ---------- What the user sees ----------

const termsJson = (choice) => {
  const t = planTerms(choice);
  return { planType: t.planType, billingCycle: t.billingCycle, monthlyQuota: t.monthlyQuota, pricePaise: t.pricePaise, monthlyPricePaise: t.monthlyPricePaise };
};

const planJson = (sub) => {
  if (!sub) return null;
  const used = sub.status === 'ACTIVE' ? sub.cycleUsed : 0;
  return {
    id: sub.id,
    status: sub.status,
    planType: sub.planType,
    billingCycle: sub.billingCycle,
    monthlyQuota: sub.monthlyQuota,
    cycleUsed: used,
    remaining: sub.status === 'ACTIVE' ? Math.max(0, sub.monthlyQuota - used) : 0,
    overagePricePaise: sub.overagePricePaise,
    pricePaise: sub.pricePaise,
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
    cycleStart: sub.cycleStart,
    cycleEnd: sub.cycleEnd,
    autoRenew: sub.autoRenew,
    // What happens at the end of the period (or on resume, when paused), at today's prices.
    renewal: termsJson(renewalChoiceOf(sub)),
    scheduledChange: nextChoiceOf(sub) ? termsJson(nextChoiceOf(sub)) : null,
  };
};

// Read-only look at the user's plan for display: one plain query, no locks. `stale` means a period
// or month has ended and the plan must be brought up to date (with the wallet locked) first.
const peekPlan = async (userId) => {
  const rows = await PlanSubscription.findAll({
    where: { userId, status: ['ACTIVE', 'PAUSED'] },
    order: [['id', 'DESC']],
  });
  const active = rows.find((row) => row.status === 'ACTIVE');
  return active ? { plan: active, stale: new Date() >= active.cycleEnd } : { plan: rows[0] || null, stale: false };
};

// The user's plan as shown in the app: the ACTIVE one, else a PAUSED one waiting to be resumed.
const currentPlan = async (wallet, transaction) =>
  (await refreshPlan(wallet, transaction)) || (await findPaused(wallet.userId, transaction));

// ---------- Changes the user makes (all run with the wallet locked) ----------

// Buy a plan now (none active), or schedule a change for the next renewal (one active).
const choosePlan = async (wallet, choice, transaction) => {
  const active = await refreshPlan(wallet, transaction);
  if (active) {
    if (sameChoice(choice, choiceOf(active))) {
      if (!nextChoiceOf(active) && active.autoRenew) throw httpError(409, "You're already on this plan.");
      await active.update({ ...NO_NEXT, autoRenew: true }, { transaction });
      return { plan: active, scheduled: false, message: 'Your current plan will continue at renewal.' };
    }
    await active.update(
      { nextPlanType: choice.planType, nextBillingCycle: choice.billingCycle, nextMonthlyQuota: choice.monthlyQuota, autoRenew: true },
      { transaction }
    );
    return {
      plan: active,
      scheduled: true,
      message: `${describePlan(choice)} starts when your current plan renews. Nothing is charged now.`,
    };
  }

  const { pricePaise } = planTerms(choice);
  if (wallet.balancePaise < pricePaise) {
    throw httpError(402, `This plan costs ${formatRupees(pricePaise)} and your wallet has ${formatRupees(wallet.balancePaise)}.`, {
      code: 'INSUFFICIENT_BALANCE',
      balancePaise: wallet.balancePaise,
      requiredPaise: pricePaise,
      shortfallPaise: pricePaise - wallet.balancePaise,
    });
  }
  const paused = await findPaused(wallet.userId, transaction);
  if (paused) await paused.update({ status: 'ENDED', endedReason: 'REPLACED', endedAt: new Date() }, { transaction });
  const plan = await startPlan(wallet, choice, transaction);
  return { plan, scheduled: false, message: `${describePlan(choice)} is active. ${formatRupees(pricePaise)} was deducted from your wallet.` };
};

// Stop auto-renewal (the plan runs to the end of its period) — or end a paused plan.
const cancelPlan = async (wallet, transaction) => {
  const active = await refreshPlan(wallet, transaction);
  if (active) {
    await active.update({ ...NO_NEXT, autoRenew: false }, { transaction });
    return { plan: active, message: "Auto-renewal is off. Your plan stays active until the end of this period, then you'll pay as you go." };
  }
  const paused = await findPaused(wallet.userId, transaction);
  if (!paused) throw httpError(404, "You don't have a plan to cancel.");
  await paused.update({ status: 'ENDED', endedReason: 'CANCELLED', endedAt: new Date() }, { transaction });
  return { plan: null, message: 'Plan cancelled. Stickers are now Pay As You Go.' };
};

// Turn auto-renewal back on — or restart a paused plan now (charged from the wallet).
const resumePlan = async (wallet, transaction) => {
  const active = await refreshPlan(wallet, transaction);
  if (active) {
    await active.update({ autoRenew: true }, { transaction });
    return { plan: active, message: 'Auto-renewal is back on.' };
  }
  const paused = await findPaused(wallet.userId, transaction);
  if (!paused) throw httpError(404, "You don't have a plan to resume.");
  const choice = renewalChoiceOf(paused);
  const { pricePaise } = planTerms(choice);
  if (wallet.balancePaise < pricePaise) {
    throw httpError(402, `Resuming costs ${formatRupees(pricePaise)} and your wallet has ${formatRupees(wallet.balancePaise)}.`, {
      code: 'INSUFFICIENT_BALANCE',
      balancePaise: wallet.balancePaise,
      requiredPaise: pricePaise,
      shortfallPaise: pricePaise - wallet.balancePaise,
    });
  }
  await paused.update({ status: 'ENDED', endedReason: 'RENEWED', endedAt: new Date() }, { transaction });
  const plan = await startPlan(wallet, choice, transaction, { renewal: true });
  return { plan, message: `Plan resumed. ${formatRupees(pricePaise)} was deducted from your wallet.` };
};

// Drop a scheduled change; the current plan renews as it is.
const discardScheduledChange = async (wallet, transaction) => {
  const active = await refreshPlan(wallet, transaction);
  if (!active || !nextChoiceOf(active)) throw httpError(404, 'There is no scheduled change.');
  await active.update(NO_NEXT, { transaction });
  return { plan: active, message: 'Scheduled change removed. Your current plan will renew as it is.' };
};

// ---------- Background renewals ----------

// Renews and resets plans on time even for users who aren't using the app (refreshPlan also runs
// on every wallet / plan / sticker request, so nothing depends on this timer alone).
const sweepDuePlans = async () => {
  const due = await PlanSubscription.findAll({
    where: { status: 'ACTIVE', cycleEnd: { [Op.lte]: new Date() } },
    attributes: ['userId'],
    group: ['userId'],
    raw: true,
  });
  for (const { userId } of due) {
    try {
      await sequelize.transaction(async (transaction) => refreshPlan(await lockWallet(userId, transaction), transaction));
    } catch (err) {
      console.error(`Plan renewal for user ${userId} failed:`, err.message);
    }
  }
};

const startPlanSweeps = () => {
  const run = () => sweepDuePlans().catch((err) => console.error('Plan sweep failed:', err.message));
  run();
  return setInterval(run, SWEEP_EVERY_MS).unref();
};

module.exports = {
  addMonths,
  refreshPlan,
  peekPlan,
  currentPlan,
  quoteBatch,
  chargeForBatch,
  planJson,
  choosePlan,
  cancelPlan,
  resumePlan,
  discardScheduledChange,
  sweepDuePlans,
  startPlanSweeps,
};
