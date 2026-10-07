PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallets (
  uid TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  available_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_usd_cents >= 0),
  held_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (held_usd_cents >= 0),
  lifetime_deposited_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_deposited_usd_cents >= 0),
  lifetime_withdrawn_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_withdrawn_usd_cents >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_id TEXT,
  requested_usd_cents INTEGER NOT NULL,
  pay_currency TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE TABLE IF NOT EXISTS deposits (
  payment_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  requested_usd_cents INTEGER NOT NULL CHECK (requested_usd_cents > 0),
  pay_amount REAL NOT NULL,
  pay_currency TEXT NOT NULL,
  pay_address TEXT NOT NULL,
  payin_extra_id TEXT,
  network TEXT,
  expires_at TEXT,
  actually_paid REAL,
  credited INTEGER NOT NULL DEFAULT 0 CHECK (credited IN (0, 1)),
  credited_at INTEGER,
  provider_created_at TEXT,
  provider_updated_at TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS deposits_uid_created_idx ON deposits(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  hold_state TEXT NOT NULL DEFAULT 'held' CHECK (hold_state IN ('held', 'settled', 'released')),
  requested_usd_cents INTEGER NOT NULL CHECK (requested_usd_cents > 0),
  payout_amount REAL NOT NULL,
  payout_currency TEXT NOT NULL,
  address TEXT NOT NULL,
  masked_address TEXT NOT NULL,
  extra_id TEXT,
  provider_reference TEXT,
  review_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS withdrawals_uid_created_idx ON withdrawals(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_status_created_idx ON withdrawals(status, created_at ASC);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  provider_reference TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS wallet_ledger_uid_created_idx ON wallet_ledger(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_rate_limits (
  uid TEXT NOT NULL,
  action TEXT NOT NULL,
  next_allowed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(uid, action)
);

CREATE TRIGGER IF NOT EXISTS credit_finished_deposit_after_insert
AFTER INSERT ON deposits
WHEN NEW.status = 'finished' AND NEW.credited = 0
BEGIN
  UPDATE wallets
  SET available_usd_cents = available_usd_cents + NEW.requested_usd_cents,
      lifetime_deposited_usd_cents = lifetime_deposited_usd_cents + NEW.requested_usd_cents,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid;

  INSERT OR IGNORE INTO wallet_ledger(id, uid, type, amount_usd_cents, provider_reference, created_at)
  VALUES('deposit_' || NEW.payment_id, NEW.uid, 'deposit', NEW.requested_usd_cents, NEW.payment_id, NEW.updated_at);

  UPDATE deposits SET credited = 1, credited_at = NEW.updated_at WHERE payment_id = NEW.payment_id;
END;

CREATE TRIGGER IF NOT EXISTS credit_finished_deposit_after_update
AFTER UPDATE OF status ON deposits
WHEN NEW.status = 'finished' AND OLD.credited = 0
BEGIN
  UPDATE wallets
  SET available_usd_cents = available_usd_cents + NEW.requested_usd_cents,
      lifetime_deposited_usd_cents = lifetime_deposited_usd_cents + NEW.requested_usd_cents,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid;

  INSERT OR IGNORE INTO wallet_ledger(id, uid, type, amount_usd_cents, provider_reference, created_at)
  VALUES('deposit_' || NEW.payment_id, NEW.uid, 'deposit', NEW.requested_usd_cents, NEW.payment_id, NEW.updated_at);

  UPDATE deposits SET credited = 1, credited_at = NEW.updated_at WHERE payment_id = NEW.payment_id;
END;

CREATE TRIGGER IF NOT EXISTS reserve_withdrawal_before_insert
BEFORE INSERT ON withdrawals
WHEN NEW.hold_state = 'held'
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT available_usd_cents FROM wallets WHERE uid = NEW.uid), 0) < NEW.requested_usd_cents
    THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS')
  END;

  UPDATE wallets
  SET available_usd_cents = available_usd_cents - NEW.requested_usd_cents,
      held_usd_cents = held_usd_cents + NEW.requested_usd_cents,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid;

  INSERT INTO wallet_ledger(id, uid, type, amount_usd_cents, provider_reference, created_at)
  VALUES('withdrawal_hold_' || NEW.id, NEW.uid, 'withdrawal_hold', -NEW.requested_usd_cents, NEW.id, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS settle_withdrawal_after_update
AFTER UPDATE OF status ON withdrawals
WHEN NEW.status = 'finished' AND OLD.hold_state = 'held'
BEGIN
  UPDATE wallets
  SET held_usd_cents = held_usd_cents - NEW.requested_usd_cents,
      lifetime_withdrawn_usd_cents = lifetime_withdrawn_usd_cents + NEW.requested_usd_cents,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid;

  INSERT OR IGNORE INTO wallet_ledger(id, uid, type, amount_usd_cents, provider_reference, created_at)
  VALUES('withdrawal_' || NEW.id, NEW.uid, 'withdrawal', -NEW.requested_usd_cents, COALESCE(NEW.provider_reference, NEW.id), NEW.updated_at);

  UPDATE withdrawals SET hold_state = 'settled' WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS release_withdrawal_after_update
AFTER UPDATE OF status ON withdrawals
WHEN NEW.status IN ('failed', 'rejected', 'cancelled') AND OLD.hold_state = 'held'
BEGIN
  UPDATE wallets
  SET available_usd_cents = available_usd_cents + NEW.requested_usd_cents,
      held_usd_cents = held_usd_cents - NEW.requested_usd_cents,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid;

  INSERT OR IGNORE INTO wallet_ledger(id, uid, type, amount_usd_cents, provider_reference, created_at)
  VALUES('withdrawal_release_' || NEW.id, NEW.uid, 'withdrawal_release', NEW.requested_usd_cents, COALESCE(NEW.provider_reference, NEW.id), NEW.updated_at);

  UPDATE withdrawals SET hold_state = 'released' WHERE id = NEW.id;
END;

