// Every sticker price in one place. Each can be overridden with an environment variable, so prices
// change without a code change. All money is in paise (₹1 = 100 paise).
const PLAN_TYPES = ['SUBSCRIPTION', 'FIXED_VARIABLE'];
const BILLING_CYCLES = ['MONTHLY', 'YEARLY'];

const positiveInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const planConfig = () => {
  const discount = Number(process.env.PLAN_YEARLY_DISCOUNT_PCT);
  return {
    // Pay As You Go — also the price of stickers beyond a Subscription's monthly allowance.
    paygPricePerQrPaise: positiveInt('QR_PRICE_PAISE', 2000), // ₹20
    subscription: {
      pricePerQrPaise: positiveInt('PLAN_SUB_PRICE_PER_QR_PAISE', 1000), // ₹10 per QR per month
      minQr: positiveInt('PLAN_SUB_MIN_QR', 100),
      maxQr: positiveInt('PLAN_SUB_MAX_QR', 10000),
      stepQr: positiveInt('PLAN_SUB_STEP_QR', 1), // any whole number by default
    },
    fixed: {
      feePaise: positiveInt('PLAN_FIXED_FEE_PAISE', 1000000), // ₹10,000 per month
      includedQr: positiveInt('PLAN_FIXED_INCLUDED_QR', 10000),
      extraPricePaise: positiveInt('PLAN_FIXED_EXTRA_PAISE', 1500), // ₹15 per QR beyond the included
    },
    // Yearly = 12 months paid upfront at this discount — Subscription only (Fixed + Variable is monthly).
    yearlyDiscountPct: Number.isInteger(discount) && discount >= 0 && discount < 100 ? discount : 20,
  };
};

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// Checks a plan choice from a request; returns { planType, billingCycle, monthlyQuota } or throws 400.
const parsePlanChoice = ({ planType, billingCycle, monthlyQuota }) => {
  const config = planConfig();
  if (!PLAN_TYPES.includes(planType)) throw httpError(400, 'Choose a valid plan.');
  if (!BILLING_CYCLES.includes(billingCycle)) throw httpError(400, 'Choose monthly or yearly billing.');
  if (planType === 'FIXED_VARIABLE') {
    if (billingCycle !== 'MONTHLY') throw httpError(400, 'Fixed + Variable is billed monthly only.');
    return { planType, billingCycle, monthlyQuota: config.fixed.includedQr };
  }

  const { minQr, maxQr, stepQr } = config.subscription;
  const quota = Number(monthlyQuota);
  if (!Number.isInteger(quota) || quota < minQr || quota > maxQr || quota % stepQr !== 0) {
    throw httpError(
      400,
      `Choose between ${minQr.toLocaleString('en-IN')} and ${maxQr.toLocaleString('en-IN')} QR codes a month${stepQr > 1 ? `, in steps of ${stepQr}` : ''}.`
    );
  }
  return { planType, billingCycle, monthlyQuota: quota };
};

// What a plan costs right now: per billing period (a month, or a year upfront) and per extra QR.
const planTerms = ({ planType, billingCycle, monthlyQuota }) => {
  const config = planConfig();
  const fixed = planType === 'FIXED_VARIABLE';
  const quota = fixed ? config.fixed.includedQr : monthlyQuota;
  const monthlyPricePaise = fixed ? config.fixed.feePaise : quota * config.subscription.pricePerQrPaise;
  const yearly = billingCycle === 'YEARLY';
  return {
    planType,
    billingCycle,
    monthlyQuota: quota,
    months: yearly ? 12 : 1,
    monthlyPricePaise,
    pricePaise: yearly ? Math.round((monthlyPricePaise * 12 * (100 - config.yearlyDiscountPct)) / 100) : monthlyPricePaise,
    // Stickers beyond the allowance: ₹15 on Fixed + Variable, the Pay As You Go price on Subscription.
    overagePricePaise: fixed ? config.fixed.extraPricePaise : config.paygPricePerQrPaise,
  };
};

const PLAN_NAMES = { SUBSCRIPTION: 'Subscription', FIXED_VARIABLE: 'Fixed + Variable' };

const describePlan = ({ planType, billingCycle, monthlyQuota }) =>
  `${PLAN_NAMES[planType]} · ${monthlyQuota.toLocaleString('en-IN')} QR/month · ${billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'}`;

module.exports = { PLAN_TYPES, BILLING_CYCLES, planConfig, parsePlanChoice, planTerms, describePlan };
