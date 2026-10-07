// `npm run check:razorpay` — checks the Razorpay settings in .env before going live:
// key format, that Razorpay accepts the keys (a read-only request; nothing is created),
// the webhook secret and the sticker price. Never prints the secrets.
require('dotenv').config();
const axios = require('axios');
const razorpay = require('../services/razorpayService');

const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => console.log(`  ✘ ${msg}`);
const note = (msg) => console.log(`  • ${msg}`);

const run = async () => {
  const { keyId, keySecret, webhookSecret } = razorpay.config();
  let failed = false;
  console.log('Razorpay settings check\n');

  if (!keyId || !keySecret) {
    bad(`${!keyId ? 'RAZORPAY_KEY_ID' : 'RAZORPAY_KEY_SECRET'} is empty in backend/.env — billing stays OFF (stickers free).`);
    failed = true;
  } else {
    const mode = keyId.startsWith('rzp_test_') ? 'TEST' : keyId.startsWith('rzp_live_') ? 'LIVE' : null;
    if (mode) ok(`Key ID looks right (${mode} mode).`);
    else {
      bad('RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_ (the acc_… Account ID is not an API key).');
      failed = true;
    }

    try {
      await axios.get('https://api.razorpay.com/v1/payments', {
        params: { count: 1 },
        auth: { username: keyId, password: keySecret },
        timeout: 15000,
      });
      ok('Razorpay accepted the key ID and secret.');
    } catch (err) {
      failed = true;
      if (err.response?.status === 401) bad('Razorpay rejected the keys (401). Re-copy the Key ID and Key Secret — they must be a pair.');
      else bad(`Could not reach Razorpay: ${err.response?.data?.error?.description || err.message}`);
    }
  }

  if (webhookSecret) ok('Webhook secret is set — use the same value in Razorpay Dashboard → Webhooks.');
  else note('RAZORPAY_WEBHOOK_SECRET is empty: payments are still credited while the payer keeps the page open, but not if they close it early.');

  const price = Number(process.env.QR_PRICE_PAISE || 2000);
  if (Number.isInteger(price) && price > 0) ok(`Sticker price: ₹${(price / 100).toFixed(2)} (QR_PRICE_PAISE=${price}).`);
  else {
    bad('QR_PRICE_PAISE must be a whole number of paise, e.g. 2000 for ₹20.');
    failed = true;
  }

  const base = (process.env.BASE_URL || '').replace(/\/+$/, '');
  note(`Webhook URL for this server: ${base || 'https://<your-backend>'}/api/payments/razorpay/webhook`);
  note('Webhook events: payment.captured, order.paid, payment.failed');

  console.log(failed ? '\nNot ready yet — fix the ✘ items above.' : '\nReady. Restart the backend to turn sticker billing on.');
  process.exit(failed ? 1 : 0);
};

run();
