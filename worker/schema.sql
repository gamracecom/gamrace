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

CREATE TABLE IF NOT EXISTS player_profiles (
  uid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  profile_public INTEGER NOT NULL DEFAULT 1 CHECK (profile_public IN (0, 1)),
  show_username INTEGER NOT NULL DEFAULT 1 CHECK (show_username IN (0, 1)),
  show_rank INTEGER NOT NULL DEFAULT 1 CHECK (show_rank IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_profiles_username_idx ON player_profiles(username COLLATE NOCASE);

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
CREATE UNIQUE INDEX IF NOT EXISTS crypto_static_address_uid_currency_idx
ON crypto_deposits(uid, pay_currency) WHERE status = 'address_ready';

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

-- Approximate Cloudflare session geography. Raw IP addresses are deliberately
-- not stored; only a masked value is retained for the user's session screen.
CREATE TABLE IF NOT EXISTS user_sessions (
  uid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  device TEXT NOT NULL,
  operating_system TEXT NOT NULL,
  browser TEXT NOT NULL,
  country_code TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT,
  ip_masked TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(uid, session_id)
);

CREATE INDEX IF NOT EXISTS user_sessions_uid_active_idx ON user_sessions(uid, last_seen_at DESC);

-- Countries are allowed by default. A row records an explicit owner decision.
CREATE TABLE IF NOT EXISTS country_access (
  country_code TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK(allowed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

-- Owner-controlled homepage races. The authoritative end timestamp keeps the
-- public countdown consistent across devices and page refreshes.
CREATE TABLE IF NOT EXISTS leaderboard_campaigns (
  cadence TEXT PRIMARY KEY CHECK(cadence IN ('daily', 'biweekly')),
  prize_usd_cents INTEGER NOT NULL CHECK(prize_usd_cents > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 60 AND 7776000),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS dice_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL CHECK(payout_units >= 0),
  target_basis_points INTEGER NOT NULL CHECK(target_basis_points BETWEEN 100 AND 9800),
  direction TEXT NOT NULL CHECK(direction IN ('over', 'under')),
  roll_basis_points INTEGER NOT NULL CHECK(roll_basis_points BETWEEN 1 AND 10000),
  chance_basis_points INTEGER NOT NULL CHECK(chance_basis_points BETWEEN 100 AND 9900),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 1000000),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS dice_bets_uid_created_idx ON dice_bets(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL CHECK(payout_units >= 0),
  selection TEXT NOT NULL CHECK(selection IN ('cyan', 'red', 'violet', 'gold')),
  result TEXT NOT NULL CHECK(result IN ('cyan', 'red', 'violet', 'gold')),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS roulette_bets_uid_created_idx ON roulette_bets(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL CHECK(payout_units >= 0),
  bets_json TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('blue', 'cyan', 'purple', 'gold')),
  winning_multiplier_micros INTEGER NOT NULL CHECK(winning_multiplier_micros IN (2000000, 7000000, 14000000)),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS roulette_rounds_uid_created_idx ON roulette_rounds(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS roulette_rounds_created_idx ON roulette_rounds(created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_spins (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  closes_at INTEGER NOT NULL,
  two_x_selection TEXT CHECK(two_x_selection IS NULL OR two_x_selection IN ('blue', 'cyan')),
  result TEXT CHECK(result IS NULL OR result IN ('blue', 'cyan', 'purple', 'gold')),
  landing_basis_points INTEGER CHECK(landing_basis_points IS NULL OR landing_basis_points BETWEEN -3200 AND 3200),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS roulette_spins_uid_status_idx ON roulette_spins(uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS roulette_spins_uid_created_idx ON roulette_spins(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_wagers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  spin_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  selection TEXT NOT NULL CHECK(selection IN ('blue', 'cyan', 'purple', 'gold')),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS roulette_wagers_spin_idx ON roulette_wagers(spin_id, uid, status);
CREATE INDEX IF NOT EXISTS roulette_wagers_uid_created_idx ON roulette_wagers(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_live_rounds (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL UNIQUE,
  closes_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('blue', 'cyan', 'purple', 'gold')),
  landing_basis_points INTEGER NOT NULL CHECK(landing_basis_points BETWEEN -3200 AND 3200),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS roulette_live_rounds_timeline_idx
ON roulette_live_rounds(starts_at DESC, ends_at DESC);

CREATE INDEX IF NOT EXISTS roulette_wagers_live_round_idx
ON roulette_wagers(spin_id, status, uid, currency);

CREATE TABLE IF NOT EXISTS crash_live_rounds (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL UNIQUE,
  launches_at INTEGER NOT NULL,
  crashes_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  crash_multiplier_micros INTEGER NOT NULL CHECK(crash_multiplier_micros BETWEEN 1000000 AND 1000000000),
  house_factor_micros INTEGER NOT NULL CHECK(house_factor_micros BETWEEN 900000 AND 1000000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS crash_live_rounds_timeline_idx
ON crash_live_rounds(starts_at DESC, ends_at DESC);

CREATE TABLE IF NOT EXISTS crash_wagers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 3),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  auto_cashout_micros INTEGER CHECK(auto_cashout_micros IS NULL OR auto_cashout_micros BETWEEN 1010000 AND 1000000000),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  multiplier_micros INTEGER NOT NULL DEFAULT 0 CHECK(multiplier_micros >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'cashed_out', 'lost')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id),
  UNIQUE(round_id, uid, currency, slot)
);

CREATE INDEX IF NOT EXISTS crash_wagers_round_status_idx
ON crash_wagers(round_id, status, auto_cashout_micros);

CREATE INDEX IF NOT EXISTS crash_wagers_uid_created_idx
ON crash_wagers(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS mines_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  mine_count INTEGER NOT NULL CHECK(mine_count BETWEEN 1 AND 24),
  mine_positions TEXT NOT NULL,
  revealed_positions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out', 'won')),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 0),
  house_factor_micros INTEGER NOT NULL DEFAULT 990000,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS mines_rounds_uid_created_idx ON mines_rounds(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS plinko_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL CHECK(payout_units >= 0),
  risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
  rows INTEGER NOT NULL CHECK(rows BETWEEN 8 AND 16),
  path TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS plinko_bets_uid_created_idx ON plinko_bets(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS keno_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  selected_numbers TEXT NOT NULL,
  drawn_numbers TEXT NOT NULL,
  selected_count INTEGER NOT NULL CHECK(selected_count BETWEEN 1 AND 10),
  risk TEXT NOT NULL CHECK(risk IN ('easy', 'medium', 'hard', 'extreme')),
  hits INTEGER NOT NULL CHECK(hits BETWEEN 0 AND 10),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  status TEXT NOT NULL DEFAULT 'revealing' CHECK(status IN ('revealing', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS keno_bets_uid_status_idx ON keno_bets(uid, currency, status, created_at DESC);
CREATE INDEX IF NOT EXISTS keno_bets_created_idx ON keno_bets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS wheel_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
  segments INTEGER NOT NULL CHECK(segments IN (10, 20, 30, 40, 50)),
  result_index INTEGER NOT NULL CHECK(result_index >= 0 AND result_index < segments),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  status TEXT NOT NULL DEFAULT 'spinning' CHECK(status IN ('spinning', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS wheel_bets_uid_status_idx ON wheel_bets(uid, currency, status, created_at DESC);
CREATE INDEX IF NOT EXISTS wheel_bets_created_idx ON wheel_bets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS hilo_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  current_rank INTEGER NOT NULL CHECK(current_rank BETWEEN 1 AND 13),
  current_suit INTEGER NOT NULL CHECK(current_suit BETWEEN 0 AND 3),
  card_history TEXT NOT NULL DEFAULT '[]',
  guesses INTEGER NOT NULL DEFAULT 0 CHECK(guesses >= 0),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 1000000),
  house_factor_micros INTEGER NOT NULL DEFAULT 990000,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hilo_rounds_one_active_idx ON hilo_rounds(uid, currency) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS hilo_rounds_uid_created_idx ON hilo_rounds(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS hilo_rounds_history_idx ON hilo_rounds(status, created_at DESC);

CREATE TABLE IF NOT EXISTS game_settings (
  game_id TEXT PRIMARY KEY,
  house_edge_basis_points INTEGER NOT NULL DEFAULT 100 CHECK(house_edge_basis_points BETWEEN 0 AND 1000),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coinflip_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK(streak BETWEEN 0 AND 20),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 1000000),
  house_factor_micros INTEGER NOT NULL DEFAULT 990000 CHECK(house_factor_micros BETWEEN 900000 AND 1000000),
  last_result TEXT CHECK(last_result IS NULL OR last_result IN ('heads', 'tails')),
  flip_history TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS coinflip_rounds_one_active_idx ON coinflip_rounds(uid, currency) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS coinflip_rounds_uid_created_idx ON coinflip_rounds(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS coinflip_rounds_history_idx ON coinflip_rounds(status, created_at DESC);

INSERT OR IGNORE INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
VALUES ('crash', 100, 0, 'schema');

CREATE TABLE IF NOT EXISTS blackjack_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  base_wager_units INTEGER NOT NULL CHECK(base_wager_units > 0),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  hand_count INTEGER NOT NULL DEFAULT 1 CHECK(hand_count BETWEEN 1 AND 3),
  side_wager_units INTEGER NOT NULL DEFAULT 0 CHECK(side_wager_units >= 0),
  side_payout_units INTEGER NOT NULL DEFAULT 0 CHECK(side_payout_units >= 0),
  side_bets_json TEXT NOT NULL DEFAULT '{}',
  shoe_json TEXT NOT NULL,
  shoe_position INTEGER NOT NULL DEFAULT 0 CHECK(shoe_position >= 0),
  dealer_cards_json TEXT NOT NULL,
  player_hands_json TEXT NOT NULL,
  active_hand INTEGER NOT NULL DEFAULT 0 CHECK(active_hand >= 0),
  split_hand INTEGER NOT NULL DEFAULT 0 CHECK(split_hand IN (0, 1)),
  multiplier_micros INTEGER NOT NULL DEFAULT 0 CHECK(multiplier_micros >= 0),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('win', 'loss', 'push')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'settled')),
  last_action_id TEXT,
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS blackjack_rounds_one_active_idx
ON blackjack_rounds(uid, currency) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS blackjack_rounds_uid_created_idx
ON blackjack_rounds(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS blackjack_rounds_history_idx
ON blackjack_rounds(status, created_at DESC);

