const pool = require('../db/pool');
const { fetchDeposits } = require('../lib/chain-monitors');
const { CONFIRMATIONS_REQUIRED } = require('../lib/chain-config');

const POLL_INTERVAL_MS = 30_000;

async function tick() {
  const { rows: addresses } = await pool.query(`
    SELECT id, chain, token, deposit_address
      FROM deposit_addresses
     WHERE status IN ('active', 'used')
       AND (expires_at > now() - INTERVAL '1 day')
  `);

  for (const addr of addresses) {
    try {
      const deposits = await fetchDeposits(addr.chain, addr.deposit_address, addr.token);

      for (const dep of deposits) {
        const insert = await pool.query(
          `INSERT INTO deposit_events
             (deposit_addr_id, txid, chain, token, usdx_amount, usdai_amount,
              status, confirmations)
           VALUES ($1, $2, $3, $4, $5, $5, 'detected', $6)
           ON CONFLICT (txid) DO NOTHING
           RETURNING id`,
          [addr.id, dep.txid, addr.chain, addr.token, dep.amount, dep.confirmations]
        );

        if (insert.rows.length) {
          console.log(
            `[deposit] NEW: ${dep.amount} ${addr.token} on ${addr.chain} → ${addr.deposit_address}`
          );
          await pool.query(
            `UPDATE deposit_addresses SET status='used', used_at=now()
               WHERE id=$1 AND status='active'`,
            [addr.id]
          );
        }
      }

      // Update confirmations + move confirmed
      const required = CONFIRMATIONS_REQUIRED[addr.chain];
      const { rows: pending } = await pool.query(
        `SELECT id, txid, confirmations FROM deposit_events
          WHERE deposit_addr_id = $1 AND status = 'detected'`,
        [addr.id]
      );

      for (const p of pending) {
        const fresh = deposits.find((d) => d.txid === p.txid);
        if (!fresh) continue;

        if (fresh.confirmations >= required) {
          await pool.query(
            `UPDATE deposit_events
                SET status='confirmed', confirmations=$1
              WHERE id=$2`,
            [fresh.confirmations, p.id]
          );
          console.log(
            `[deposit] CONFIRMED: ${p.txid} (${fresh.confirmations}/${required})`
          );
        } else if (fresh.confirmations !== p.confirmations) {
          await pool.query(
            `UPDATE deposit_events SET confirmations=$1 WHERE id=$2`,
            [fresh.confirmations, p.id]
          );
        }
      }
    } catch (err) {
      console.error(
        `[deposit-watcher] ${addr.chain}:${addr.deposit_address} →`,
        err.message
      );
    }
  }
}

function start() {
  console.log('[deposit-watcher] started');
  tick().catch((e) => console.error('[deposit-watcher] tick error:', e));
  setInterval(() => {
    tick().catch((e) => console.error('[deposit-watcher] tick error:', e));
  }, POLL_INTERVAL_MS);
}

module.exports = { start };
