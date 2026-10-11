const pool = require('../db/pool');

const POLL_INTERVAL_MS = 60 * 60 * 1000; 

async function tick() {
  const expired = await pool.query(`
    UPDATE deposit_addresses
       SET status = 'expired'
     WHERE status = 'active' AND expires_at < now()
     RETURNING id
  `);
  if (expired.rows.length) {
    console.log(`[cleanup] Expired ${expired.rows.length} unused addresses`);
  }

  const cleared = await pool.query(`
    UPDATE deposit_addresses
       SET private_key_enc = NULL
     WHERE status = 'expired'
       AND used_at IS NULL
       AND expires_at < now() - INTERVAL '30 days'
       AND private_key_enc IS NOT NULL
     RETURNING id
  `);
  if (cleared.rows.length) {
    console.log(`[cleanup] Cleared keys for ${cleared.rows.length} old addresses`);
  }
}

function start() {
  console.log('[cleanup] started');
  tick().catch((e) => console.error('[cleanup] tick error:', e));
  setInterval(() => {
    tick().catch((e) => console.error('[cleanup] tick error:', e));
  }, POLL_INTERVAL_MS);
}

module.exports = { start };
