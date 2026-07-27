/**
 * Payment provider — Midtrans Snap integration.
 * Environment secrets required:
 *   MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY, MIDTRANS_IS_PRODUCTION
 */

const midtransClient = require('midtrans-client');

// Auto-detect production from key prefix (SB- = sandbox, Mid- = production)
const isProduction = (serverKey) => {
  if (!serverKey) return false;
  if (serverKey.startsWith('SB-Mid-server-') || serverKey.startsWith('SB-Mid-client-')) return false;
  if (serverKey.startsWith('Mid-server-') || serverKey.startsWith('Mid-client-')) return true;
  // Fallback to env var if key format is unrecognized
  return process.env.MIDTRANS_IS_PRODUCTION === 'true';
};
const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
const clientKey = process.env.MIDTRANS_CLIENT_KEY || '';

function getSnapClient() {
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY not configured');
  return new midtransClient.Snap({
    isProduction: isProduction(serverKey),
    serverKey,
    clientKey,
  });
}

function getCoreClient() {
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY not configured');
  return new midtransClient.CoreApi({
    isProduction: isProduction(serverKey),
    serverKey,
    clientKey,
  });
}

/**
 * Create a Midtrans Snap transaction token.
 * Returns { token, redirect_url, order_id }
 */
async function createSnapToken({ orderId, amount, customerEmail, customerName, planName, items = [] }) {
  const snap = getSnapClient();

  // Build the finish redirect URL so Midtrans can redirect after async payment (QRIS etc.)
  const baseUrl = process.env.APP_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');
  const finishUrl = baseUrl
    ? `${baseUrl}/membership/checkout/success?order_id=${encodeURIComponent(orderId)}&pending=1&email=${encodeURIComponent(customerEmail)}`
    : undefined;

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    credit_card: {
      secure: true,
    },
    enabled_payments: [
      'credit_card',
      'gopay',
      'shopeepay',
      'bca_va',
      'bni_va',
      'bri_va',
      'permata_va',
      'other_va',
      'echannel',
      'danamon_online',
      'qris',
    ],
    customer_details: {
      first_name: customerName || customerEmail.split('@')[0],
      email: customerEmail,
    },
    item_details: items.length ? items : [{
      id: 'plan',
      price: amount,
      quantity: 1,
      name: planName || 'Subscription',
    }],
    ...(finishUrl ? { callbacks: { finish: finishUrl } } : {}),
  };

  const transaction = await snap.createTransaction(parameter);
  return {
    token: transaction.token,
    redirect_url: transaction.redirect_url,
    order_id: orderId,
  };
}

/**
 * Verify a transaction status by order_id.
 * Returns { status, transaction_status, fraud_status, gross_amount, ... }
 */
async function checkTransaction(orderId) {
  const core = getCoreClient();
  return await core.transaction.status(orderId);
}

/**
 * Midtrans webhook signature verification.
 * Server Key + order_id + status_code + gross_amount SHA512
 */
function verifySignature(orderId, statusCode, grossAmount, signatureKey) {
  const payload = orderId + statusCode + grossAmount + serverKey;
  const expected = require('crypto').createHash('sha512').update(payload).digest('hex');
  return expected === signatureKey;
}

function getClientKey() {
  return clientKey;
}

module.exports = {
  createSnapToken,
  checkTransaction,
  verifySignature,
  getClientKey,
  isProduction: isProduction(serverKey),
};
