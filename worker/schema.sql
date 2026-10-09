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

-- Multi-asset wallet ledger. Amounts are stored as integer units at 8 decimal
-- places so balances remain exact and one deposited asset can never be
-- withdrawn as another asset.
CREATE TABLE IF NOT EXISTS crypto_balances (
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  available_units INTEGER NOT NULL DEFAULT 0 CHECK (available_units >= 0),
  held_units INTEGER NOT NULL DEFAULT 0 CHECK (held_units >= 0),
  lifetime_deposited_units INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_deposited_units >= 0),
  lifetime_withdrawn_units INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_withdrawn_units >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(uid, currency)
);

CREATE TABLE IF NOT EXISTS wallet_preferences (
  uid TEXT PRIMARY KEY,
  selected_currency TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crypto_deposit_requests (
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

CREATE TABLE IF NOT EXISTS crypto_deposits (
  payment_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  requested_usd_cents INTEGER NOT NULL CHECK (requested_usd_cents > 0),
  pay_amount TEXT NOT NULL,
  pay_currency TEXT NOT NULL,
  pay_address TEXT NOT NULL,
  payin_extra_id TEXT,
  network TEXT,
  expires_at TEXT,
  actually_paid TEXT,
  credit_units INTEGER NOT NULL DEFAULT 0 CHECK (credit_units >= 0),
  credited INTEGER NOT NULL DEFAULT 0 CHECK (credited IN (0, 1)),
  credited_at INTEGER,
  provider_created_at TEXT,
  provider_updated_at TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS crypto_deposits_uid_created_idx ON crypto_deposits(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS crypto_deposits_address_currency_idx ON crypto_deposits(pay_address, pay_currency);

CREATE TABLE IF NOT EXISTS crypto_withdrawals (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  hold_state TEXT NOT NULL DEFAULT 'held' CHECK (hold_state IN ('held', 'settled', 'released')),
  requested_units INTEGER NOT NULL CHECK (requested_units > 0),
  payout_amount TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS crypto_withdrawals_uid_created_idx ON crypto_withdrawals(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS crypto_withdrawals_status_created_idx ON crypto_withdrawals(status, created_at ASC);

CREATE TABLE IF NOT EXISTS crypto_ledger (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_units INTEGER NOT NULL,
  provider_reference TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS crypto_ledger_uid_created_idx ON crypto_ledger(uid, created_at DESC);

-- Owner-only admin control plane. Passwords and session tokens are never stored
-- in D1; only throttling and an immutable activity trail are persisted here.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  uid TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);

CREATE TRIGGER IF NOT EXISTS credit_finished_crypto_deposit_after_insert
AFTER INSERT ON crypto_deposits
WHEN NEW.status = 'finished' AND NEW.credited = 0 AND NEW.credit_units > 0
BEGIN
  INSERT INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.uid, NEW.pay_currency, NEW.credit_units, 0, NEW.credit_units, 0, NEW.updated_at, NEW.updated_at)
  ON CONFLICT(uid, currency) DO UPDATE SET
    available_units = available_units + NEW.credit_units,
    lifetime_deposited_units = lifetime_deposited_units + NEW.credit_units,
    updated_at = NEW.updated_at;

  INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('deposit_' || NEW.payment_id, NEW.uid, NEW.pay_currency, 'deposit', NEW.credit_units, NEW.payment_id, NEW.updated_at);

  INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
  VALUES(NEW.uid, NEW.pay_currency, NEW.updated_at);

  UPDATE crypto_deposits SET credited = 1, credited_at = NEW.updated_at WHERE payment_id = NEW.payment_id;
END;

CREATE TRIGGER IF NOT EXISTS credit_finished_crypto_deposit_after_update
AFTER UPDATE OF status ON crypto_deposits
WHEN NEW.status = 'finished' AND OLD.credited = 0 AND NEW.credit_units > 0
BEGIN
  INSERT INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.uid, NEW.pay_currency, NEW.credit_units, 0, NEW.credit_units, 0, NEW.updated_at, NEW.updated_at)
  ON CONFLICT(uid, currency) DO UPDATE SET
    available_units = available_units + NEW.credit_units,
    lifetime_deposited_units = lifetime_deposited_units + NEW.credit_units,
    updated_at = NEW.updated_at;

  INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('deposit_' || NEW.payment_id, NEW.uid, NEW.pay_currency, 'deposit', NEW.credit_units, NEW.payment_id, NEW.updated_at);

  INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
  VALUES(NEW.uid, NEW.pay_currency, NEW.updated_at);

  UPDATE crypto_deposits SET credited = 1, credited_at = NEW.updated_at WHERE payment_id = NEW.payment_id;
END;

CREATE TRIGGER IF NOT EXISTS reserve_crypto_withdrawal_before_insert
BEFORE INSERT ON crypto_withdrawals
WHEN NEW.hold_state = 'held'
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT available_units FROM crypto_balances WHERE uid = NEW.uid AND currency = NEW.payout_currency), 0) < NEW.requested_units
    THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS')
  END;

  UPDATE crypto_balances
  SET available_units = available_units - NEW.requested_units,
      held_units = held_units + NEW.requested_units,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency = NEW.payout_currency;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('withdrawal_hold_' || NEW.id, NEW.uid, NEW.payout_currency, 'withdrawal_hold', -NEW.requested_units, NEW.id, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS settle_crypto_withdrawal_after_update
AFTER UPDATE OF status ON crypto_withdrawals
WHEN NEW.status = 'finished' AND OLD.hold_state = 'held'
BEGIN
  UPDATE crypto_balances
  SET held_units = held_units - NEW.requested_units,
      lifetime_withdrawn_units = lifetime_withdrawn_units + NEW.requested_units,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency = NEW.payout_currency;

  INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('withdrawal_' || NEW.id, NEW.uid, NEW.payout_currency, 'withdrawal', -NEW.requested_units, COALESCE(NEW.provider_reference, NEW.id), NEW.updated_at);

  UPDATE crypto_withdrawals SET hold_state = 'settled' WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS release_crypto_withdrawal_after_update
AFTER UPDATE OF status ON crypto_withdrawals
WHEN NEW.status IN ('failed', 'rejected', 'cancelled') AND OLD.hold_state = 'held'
BEGIN
  UPDATE crypto_balances
  SET available_units = available_units + NEW.requested_units,
      held_units = held_units - NEW.requested_units,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency = NEW.payout_currency;

  INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('withdrawal_release_' || NEW.id, NEW.uid, NEW.payout_currency, 'withdrawal_release', NEW.requested_units, COALESCE(NEW.provider_reference, NEW.id), NEW.updated_at);

  UPDATE crypto_withdrawals SET hold_state = 'released' WHERE id = NEW.id;
END;

