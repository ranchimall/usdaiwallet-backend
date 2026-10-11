/**
 * Confirmation waiter for free-tier RPCs (PublicNode etc.).
 *
 * `tx.wait()` / getTransactionReceipt fail hard on these endpoints
 * (403 "archive request" even for fresh transactions), so this verifies
 * EFFECTS instead of receipts:
 *
 *   Stage 1 — inclusion: poll getTransactionByHash until the tx has a
 *   blockNumber (served fine on free tiers). Timeout = tx never mined.
 *   Stage 2 — fast path: one getTransactionReceipt attempt for instant
 *   revert detection, skipped silently if the endpoint gates receipts.
 *   Stage 3 — effects: poll the caller's `isDone` ground truth
 *   (e.g. balance reached the expected value) until observed.
 *
 * Throws on timeout. On a timeout AFTER inclusion, check the explorer
 * before retrying — the money may have moved despite the error.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTxSuccess(provider, txHash, isDone, { tries = 12, gapMs = 5000 } = {}) {
  // Stage 1: inclusion.
  let included = false;
  for (let i = 0; i < tries; i++) {
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx && tx.blockNumber != null) {
        included = true;
        break;
      }
    } catch (_) {
      // RPC hiccup — keep polling.
    }
    await sleep(gapMs);
  }
  if (!included) {
    throw new Error(`Transaction not included after ${tries} polls (${txHash})`);
  }

  // Stage 2: receipt fast-path (revert detection) where served.
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      if (receipt.status === 0) {
        throw new Error(`Transaction reverted on-chain (${txHash})`);
      }
      return receipt;
    }
  } catch (e) {
    if (/reverted on-chain/.test(e.message || '')) throw e;
    // Receipt gated — fall through to effects polling.
  }

  // Stage 3: effects polling (caller's ground truth).
  for (let i = 0; i < tries; i++) {
    try {
      if (await isDone()) return { hash: txHash, byEffects: true };
    } catch (_) {
      // RPC hiccup — keep polling.
    }
    await sleep(gapMs);
  }
  throw new Error(
    `Effects not observed for ${txHash} — check the explorer before retrying`
  );
}

module.exports = { waitForTxSuccess };
