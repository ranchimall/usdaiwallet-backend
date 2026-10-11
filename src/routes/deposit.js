const express = require('express');
const pool = require('../db/pool');
const { encryptKey } = require('../lib/crypto-vault');
const { generateWallet } = require('../lib/wallet-generator');
const { CHAINS } = require('../lib/chain-config');
const { secureEndpoint } = require('../lib/secure-endpoint');

const router = express.Router();

/**
 * POST /api/exchange/deposit/create
 */
router.post('/create', secureEndpoint(), async (req, res) => {
  const { chain, token } = req.body;
  const floId = req.floId;

  if (!CHAINS[chain]) {
    return res.status(400).json({ success: false, error: 'Unsupported chain' });
  }
  if (!CHAINS[chain].tokens[token]) {
    return res.status(400).json({
      success: false,
      error: `Token ${token} not supported on ${chain}`,
    });
  }

  try {
    const ttlMinutes = Number(process.env.DEPOSIT_ADDRESS_TTL_MINUTES || 60);

    // Reuse active address if within TTL
    const existing = await pool.query(
      `SELECT deposit_address, expires_at
         FROM deposit_addresses
        WHERE flo_address = $1
          AND chain = $2
          AND token = $3
          AND status = 'active'
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [floId, chain, token]
    );

    if (existing.rows.length) {
      return res.json({
        success: true,
        address: existing.rows[0].deposit_address,
        chain,
        token,
        expiresAt: existing.rows[0].expires_at,
        reused: true,
      });
    }

    const wallet = generateWallet(chain);
    const encrypted = encryptKey(wallet.privateKey);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    await pool.query(
      `INSERT INTO deposit_addresses
         (flo_address, chain, token, deposit_address,
          private_key_enc, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [floId, chain, token, wallet.address, encrypted, expiresAt]
    );

    await pool.query(
      `INSERT INTO audit_log (event_type, payload, ip)
       VALUES ('deposit_address_created', $1, $2)`,
      [JSON.stringify({ floId, chain, token, address: wallet.address }), req.ip]
    );

    return res.json({
      success: true,
      address: wallet.address,
      chain,
      token,
      expiresAt,
      reused: false,
    });
  } catch (err) {
    console.error('[deposit/create] error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/exchange/deposit/status
 */
router.post('/status', secureEndpoint(), async (req, res) => {
  const floId = req.floId;

  try {
    const { rows } = await pool.query(
      `SELECT
          de.txid,
          de.chain,
          de.token,
          de.usdx_amount,
          de.usdai_amount,
          de.status,
          de.confirmations,
          de.flo_txid,
          de.detected_at,
          de.credited_at,
          da.deposit_address
         FROM deposit_events de
         JOIN deposit_addresses da ON da.id = de.deposit_addr_id
        WHERE da.flo_address = $1
        ORDER BY de.detected_at DESC
        LIMIT 20`,
      [floId]
    );

    return res.json({ success: true, deposits: rows });
  } catch (err) {
    console.error('[deposit/status] error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
