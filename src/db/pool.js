const { Pool } = require('pg');

// Neon (and most NATs/firewalls) kill idle TCP connections after a few
// minutes, so the pool must NOT hold sockets open: close idle clients
// quickly and let each worker tick open a fresh one (Neon wakes in ~1s).
// TCP keepalive + one automatic retry cover the stragglers.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected error:', err.message);
});

// Retry once on transient connection errors. Keeps every existing
// `pool.query(...)` call site working unchanged.
const _query = pool.query.bind(pool);
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);
function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code)) return true;
  return /terminated|timeout|econnreset|socket hang up/i.test(err.message || '');
}
pool.query = async (...args) => {
  const delays = [1000, 3000, 5000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await _query(...args);
    } catch (err) {
      if (!isTransient(err) || attempt >= delays.length) throw err;
      console.warn(
        `[pg] Transient connection error (attempt ${attempt + 1}/${delays.length + 1}), ` +
        `retrying in ${delays[attempt]}ms:`,
        err.message
      );
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
};

module.exports = pool;
