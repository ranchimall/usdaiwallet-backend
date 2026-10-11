const { floBlockchainAPI } = require('./flo-node');

const PLATFORM_FLO_ADDRESS = process.env.PLATFORM_FLO_ADDRESS;
const PLATFORM_FLO_PRIVATE_KEY = process.env.PLATFORM_FLO_PRIVATE_KEY;
const FLO_SEND_AMT = 0.0003;

if (!PLATFORM_FLO_ADDRESS || !PLATFORM_FLO_PRIVATE_KEY) {
  throw new Error('PLATFORM_FLO_ADDRESS and PLATFORM_FLO_PRIVATE_KEY must be set');
}

/**
 * Send USDAI to a FLO address.
 * @param {string} destinationFloId - recipient FLO address (F...)
 * @param {number} amount - USDAI amount
 * @returns {Promise<string>} FLO txid
 */
async function sendUsdaiPayment(destinationFloId, amount) {
  const tokenAmount = Number(amount).toFixed(10);
  const floData = `send ${tokenAmount} usdai#`;

  const txid = await floBlockchainAPI.sendTx(
    PLATFORM_FLO_ADDRESS,
    destinationFloId,
    FLO_SEND_AMT,
    PLATFORM_FLO_PRIVATE_KEY,
    floData
  );

  return txid;
}

/**
 * Verify a FLO transaction that should have sent USDAI to the platform.
 * Returns { amount, sender } or throws.
 */
async function verifyUsdaiPayment(floTxid, minAmount) {
  const tx = await floBlockchainAPI.getTx(floTxid);
  if (!tx) throw new Error('FLO transaction not found');
  if (!tx.confirmations || tx.confirmations < 1) {
    throw new Error('Transaction not confirmed yet');
  }

  const floData = tx.floData || '';
  const match = floData.match(/^send\s+([\d.]+)\s+usdai#$/i);
  if (!match) throw new Error('Not a USDAI transfer');

  const amount = Number(match[1]);
  if (!amount || amount < minAmount) {
    throw new Error(`Amount below minimum (${minAmount})`);
  }

  const recipient = (tx.vout || []).find((v) =>
    v.scriptPubKey?.addresses?.includes(PLATFORM_FLO_ADDRESS)
  );
  if (!recipient) {
    throw new Error('USDAI was not sent to the platform wallet');
  }

  const sender = tx.vin?.[0]?.addresses?.[0] || null;
  return { amount, sender };
}

module.exports = {
  sendUsdaiPayment,
  verifyUsdaiPayment,
  PLATFORM_FLO_ADDRESS,
};
