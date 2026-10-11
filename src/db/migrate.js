const fs = require('fs');
const path = require('path');
const pool = require('./pool');

/**
 * Apply the schema on startup.
 * Idempotent: all statements use IF NOT EXISTS.
 */
async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[migrate] Applying schema...');
  try {
    await pool.query(sql);
    console.log('[migrate] Schema applied successfully');
  } catch (err) {
    console.error('[migrate] Schema migration failed:', err.message);
    throw err;
  }
}

module.exports = { migrate };
