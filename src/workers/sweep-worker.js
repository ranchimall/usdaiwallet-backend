const pool = require('../db/pool');
const { decryptKey } = require('../lib/crypto-vault');
const { ensureGas } = require('../lib/gas-manager');
const { sweepToTreasury } = require('../lib/sweeper');

const POLL_INTERVAL_MS = 60_000;

async function tick() {
  const { rows } = await pool.query(`
    SELECT de.id, de.txid, de.usdx_amount, de.chain, de.token,
           da.deposit_address, da.private_key_enc
      FROM deposit_events de
      JOIN deposit_addresses da ON da.id = de.deposit_addr_id
     WHERE de.status = 'confirmed'
     ORDER BY de.detected_at ASC
     LIMIT 10
  `);

  for (const dep of rows) {
    try {
      console.log(
        `[sweeper] Processing ${dep.txid} (${dep.chain} ${dep.token} ${dep.usdx_amount})`
      );

      if (!dep.private_key_enc) {
        throw new Error('Missing private key (was it cleared by cleanup?)');
      }

      const privateKey = decryptKey(dep.private_key_enc);
      await ensureGas(dep.chain, dep.deposit_address);
      const sweepTxid = await sweepToTreasury(
        dep.chain,
        privateKey,
        dep.token,
        dep.usdx_amount
      );

      await pool.query(
        `UPDATE deposit_events SET status='swept', sweep_txid=$1 WHERE id=$2`,
        [sweepTxid, dep.id]
      );

      console.log(`[sweeper] SWEPT ${dep.txid} → ${sweepTxid}`);
    } catch (err) {
      console.error(`[sweeper] Failed ${dep.txid}:`, err.message);

      const failCount = (await pool.query(
        `SELECT COUNT(*) FROM audit_log
          WHERE event_type='sweep_failed' AND payload->>'deposit_id' = $1`,
        [String(dep.id)]
      )).rows[0].count;

      await pool.query(
        `INSERT INTO audit_log (event_type, payload) VALUES ('sweep_failed', $1)`,
        [JSON.stringify({ deposit_id: dep.id, error: err.message })]
      );

      if (Number(failCount) >= 3) {
        await pool.query(
          `UPDATE deposit_events SET status='failed', error_message=$1 WHERE id=$2`,
          [err.message, dep.id]
        );
        console.error(`[sweeper] Marking ${dep.txid} as FAILED after 3 attempts`);
      }
    }
  }
}

function start() {
  console.log('[sweeper] started');
  tick().catch((e) => console.error('[sweeper] tick error:', e));
  setInterval(() => {
    tick().catch((e) => console.error('[sweeper] tick error:', e));
  }, POLL_INTERVAL_MS);
}

module.exports = { start };
