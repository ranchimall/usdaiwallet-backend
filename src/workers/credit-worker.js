const pool = require('../db/pool');
const { sendUsdaiPayment } = require('../lib/flo-chain');

const POLL_INTERVAL_MS = 30_000;

async function tick() {
  const { rows } = await pool.query(`
    SELECT de.id, de.usdai_amount, de.txid,
           da.flo_address
      FROM deposit_events de
      JOIN deposit_addresses da ON da.id = de.deposit_addr_id
     WHERE de.status = 'swept'
     ORDER BY de.detected_at ASC
     LIMIT 10
  `);

  for (const dep of rows) {
    try {
      console.log(
        `[creditor] Sending ${dep.usdai_amount} USDAI → ${dep.flo_address} (deposit ${dep.txid})`
      );

      const floTxid = await sendUsdaiPayment(dep.flo_address, dep.usdai_amount);

      await pool.query(
        `UPDATE deposit_events
            SET status='credited', flo_txid=$1, credited_at=now()
          WHERE id=$2`,
        [floTxid, dep.id]
      );

      console.log(`[creditor] CREDITED ${dep.txid} → FLO ${floTxid}`);
    } catch (err) {
      console.error(`[creditor] Failed ${dep.txid}:`, err.message);
    }
  }
}

function start() {
  console.log('[creditor] started');
  tick().catch((e) => console.error('[creditor] tick error:', e));
  setInterval(() => {
    tick().catch((e) => console.error('[creditor] tick error:', e));
  }, POLL_INTERVAL_MS);
}

module.exports = { start };
