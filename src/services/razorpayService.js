const crypto = require('crypto');
const axios = require('axios');

// Razorpay's REST API, called directly with the account's API key (Dashboard → Account &
// Settings → API Keys). Test keys start with rzp_test_, live keys with rzp_live_.
// The key secret and webhook secret never leave this server.
const API_BASE = 'https://api.razorpay.com/v1';

const config = () => ({
  keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
  keySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
  webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
});

const isConfigured = () => {
  const { keyId, keySecret } = config();
  return Boolean(keyId && keySecret);
};

const client = () => {
  const { keyId, keySecret } = config();
  return axios.create({
    baseURL: API_BASE,
    auth: { username: keyId, password: keySecret },
    timeout: 15000,
  });
};

// Razorpay's own error text when it has one ("The amount must be at least INR 1.00"), else ours.
const razorpayError = (err, fallback) => {
  const description = err.response?.data?.error?.description;
  const error = new Error(description ? `Razorpay: ${description}` : fallback);
  error.status = 502;
  return error;
};

// An order fixes the amount on Razorpay's side before the user pays, so the browser can't change it.
const createOrder = async ({ amountPaise, receipt, notes }) => {
  try {
    const { data } = await client().post('/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
    return data;
  } catch (err) {
    throw razorpayError(err, 'Could not start the payment with Razorpay. Please try again.');
  }
};

const fetchPayment = async (paymentId) => {
  try {
    const { data } = await client().get(`/payments/${encodeURIComponent(paymentId)}`);
    return data;
  } catch (err) {
    throw razorpayError(err, 'Could not confirm the payment with Razorpay. Please try again.');
  }
};

// Accounts with manual capture leave payments "authorized"; capture them so the money is settled.
const capturePayment = async (paymentId, amountPaise) => {
  try {
    const { data } = await client().post(`/payments/${encodeURIComponent(paymentId)}/capture`, {
      amount: amountPaise,
      currency: 'INR',
    });
    return data;
  } catch (err) {
    throw razorpayError(err, 'Could not complete the payment with Razorpay. Please try again.');
  }
};

const hmacMatches = (payload, secret, signature) => {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
};

// The signature Checkout hands back: HMAC-SHA256 of "<order_id>|<payment_id>" with the key secret.
// Proves the payment belongs to this order and came through Razorpay, not a forged request.
const verifyPaymentSignature = (orderId, paymentId, signature) =>
  hmacMatches(`${orderId}|${paymentId}`, config().keySecret, signature);

// Webhooks are signed over the exact raw request body with the webhook secret.
const verifyWebhookSignature = (rawBody, signature) =>
  Boolean(rawBody) && hmacMatches(rawBody, config().webhookSecret, signature);

module.exports = {
  config,
  isConfigured,
  createOrder,
  fetchPayment,
  capturePayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
