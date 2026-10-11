-- ═══════════════════════════════════════════════════════════════
-- Deposit addresses (one per user request)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS deposit_addresses (
  id              SERIAL PRIMARY KEY,
  flo_address     TEXT NOT NULL,
  chain           TEXT NOT NULL,
  token           TEXT NOT NULL,
  deposit_address TEXT NOT NULL UNIQUE,
  private_key_enc TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dep_addr_status_exp
  ON deposit_addresses (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_dep_addr_user
  ON deposit_addresses (flo_address, chain, token);

-- ═══════════════════════════════════════════════════════════════
-- Deposit events
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS deposit_events (
  id              SERIAL PRIMARY KEY,
  deposit_addr_id INTEGER NOT NULL REFERENCES deposit_addresses(id),
  txid            TEXT NOT NULL UNIQUE,
  chain           TEXT NOT NULL,
  token           TEXT NOT NULL,
  usdx_amount     NUMERIC NOT NULL,
  usdai_amount    NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'detected',
  confirmations   INTEGER NOT NULL DEFAULT 0,
  sweep_txid      TEXT,
  flo_txid        TEXT,
  error_message   TEXT,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  credited_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dep_events_status ON deposit_events (status);
CREATE INDEX IF NOT EXISTS idx_dep_events_addr   ON deposit_events (deposit_addr_id);

-- ═══════════════════════════════════════════════════════════════
-- Withdrawal requests
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id                SERIAL PRIMARY KEY,
  flo_address       TEXT NOT NULL,
  chain             TEXT NOT NULL,
  usdx_type         TEXT NOT NULL,
  usdx_amount       NUMERIC NOT NULL,
  usdai_amount      NUMERIC NOT NULL,
  recipient_address TEXT NOT NULL,
  usdai_txid        TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending',
  payout_txid       TEXT,
  admin_flo_id      TEXT,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_withdraw_status ON withdrawal_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_withdraw_user   ON withdrawal_requests (flo_address, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- Audit log
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload    JSONB NOT NULL,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_log (event_type, created_at DESC);

ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS last_checked_block BIGINT;
