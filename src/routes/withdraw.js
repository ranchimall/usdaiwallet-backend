const express = require('express');
const pool = require('../db/pool');
const { secureEndpoint } = require('../lib/secure-endpoint');
const { verifyUsdaiPayment } = require('../lib/flo-chain');

const router = express.Router();

const MIN_USDAI_WITHDRAWAL = Number(process.env.MIN_USDAI_WITHDRAWAL || 1);

function isAdmin(floId) {
  const admins = (process.env.ADMIN_FLO_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return admins.includes(floId);
}

// ─── User: create withdrawal request ────────────────────────────
router.post('/request', secureEndpoint(), async (req, res) => {
  const floId = req.floId;
  const { chain, token, recipientAddress, usdaiTxid } = req.body;

  if (!chain || !token || !recipientAddress || !usdaiTxid) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  try {
    const dup = await pool.query(
      `SELECT 1 FROM withdrawal_requests WHERE usdai_txid = $1`,
      [usdaiTxid]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        success: false,
        error: 'This USDAI TXID has already been used',
      });
    }

    const payment = await verifyUsdaiPayment(usdaiTxid, MIN_USDAI_WITHDRAWAL);

    if (payment.sender && payment.sender !== floId) {
      return res.status(403).json({
        success: false,
        error: 'USDAI was sent from a different FLO address',
      });
    }

    const inserted = await pool.query(
      `INSERT INTO withdrawal_requests
         (flo_address, chain, usdx_type, usdx_amount, usdai_amount,
          recipient_address, usdai_txid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, created_at`,
      [
        floId,
        chain,
        token,
        payment.amount,
        payment.amount,
        recipientAddress,
        usdaiTxid,
      ]
    );

    await pool.query(
      `INSERT INTO audit_log (event_type, payload, ip)
       VALUES ('withdrawal_request_created', $1, $2)`,
      [
        JSON.stringify({
          floId,
          chain,
          token,
          amount: payment.amount,
          recipientAddress,
          usdaiTxid,
          requestId: inserted.rows[0].id,
        }),
        req.ip,
      ]
    );

    res.json({
      success: true,
      request: inserted.rows[0],
      message: 'Withdrawal request received. An admin will process it shortly.',
    });
  } catch (err) {
    console.error('[withdraw/request] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── User: list own requests ────────────────────────────────────
router.post('/my-requests', secureEndpoint(), async (req, res) => {
  const floId = req.floId;
  try {
    const { rows } = await pool.query(
      `SELECT id, chain, usdx_type, usdx_amount, status, payout_txid,
              rejection_reason, created_at, resolved_at
         FROM withdrawal_requests
        WHERE flo_address = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [floId]
    );
    res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('[withdraw/my-requests] error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─── Admin: list requests ───────────────────────────────────────
router.post('/admin/list', secureEndpoint({ floIdField: 'adminFloId' }), async (req, res) => {
  if (!isAdmin(req.floId)) {
    return res.status(403).json({ success: false, error: 'Not an admin' });
  }

  const status = req.body.status || 'pending';
  try {
    const { rows } = await pool.query(
      `SELECT * FROM withdrawal_requests
        WHERE ($1 = 'all' OR status = $1)
        ORDER BY created_at ASC`,
      [status]
    );
    res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('[withdraw/admin/list] error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─── Admin: approve ─────────────────────────────────────────────
router.post('/admin/approve', secureEndpoint({ floIdField: 'adminFloId' }), async (req, res) => {
  if (!isAdmin(req.floId)) {
    return res.status(403).json({ success: false, error: 'Not an admin' });
  }

  const { requestId, payoutTxid } = req.body;
  if (!requestId || !payoutTxid) {
    return res.status(400).json({ success: false, error: 'Missing fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await client.query(
      `SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    if (!row.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    if (row.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Already resolved' });
    }

    await client.query(
      `UPDATE withdrawal_requests
          SET status='approved', payout_txid=$1, admin_flo_id=$2, resolved_at=now()
        WHERE id=$3`,
      [payoutTxid, req.floId, requestId]
    );

    await client.query('COMMIT');

    await pool.query(
      `INSERT INTO audit_log (event_type, payload, ip)
       VALUES ('withdrawal_approved', $1, $2)`,
      [JSON.stringify({ adminFloId: req.floId, requestId, payoutTxid }), req.ip]
    );

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[withdraw/admin/approve] error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Admin: reject ──────────────────────────────────────────────
router.post('/admin/reject', secureEndpoint({ floIdField: 'adminFloId' }), async (req, res) => {
  if (!isAdmin(req.floId)) {
    return res.status(403).json({ success: false, error: 'Not an admin' });
  }

  const { requestId, reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE withdrawal_requests
          SET status='rejected', rejection_reason=$1, admin_flo_id=$2, resolved_at=now()
        WHERE id=$3 AND status='pending'
        RETURNING id`,
      [reason || 'Rejected by admin', req.floId, requestId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Not found or already resolved' });
    }

    await pool.query(
      `INSERT INTO audit_log (event_type, payload, ip)
       VALUES ('withdrawal_rejected', $1, $2)`,
      [JSON.stringify({ adminFloId: req.floId, requestId, reason }), req.ip]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[withdraw/admin/reject] error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
