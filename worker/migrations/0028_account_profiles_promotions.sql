CREATE TABLE IF NOT EXISTS account_profiles (
  uid TEXT PRIMARY KEY,
  legal_first_name TEXT NOT NULL DEFAULT '',
  legal_last_name TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT NOT NULL DEFAULT '',
  address_line_1 TEXT NOT NULL DEFAULT '',
  address_line_2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en',
  display_currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  level_one_completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reward_currency TEXT NOT NULL,
  reward_units INTEGER NOT NULL CHECK(reward_units > 0),
  minimum_rank_stage TEXT NOT NULL DEFAULT 'rookie',
  minimum_rank_tier INTEGER NOT NULL DEFAULT 1 CHECK(minimum_rank_tier BETWEEN 1 AND 3),
  minimum_deposit_currency TEXT NOT NULL,
  minimum_deposit_units INTEGER NOT NULL DEFAULT 0 CHECK(minimum_deposit_units >= 0),
  deposit_lookback_days INTEGER NOT NULL DEFAULT 0 CHECK(deposit_lookback_days BETWEEN 0 AND 3650),
  max_claims INTEGER NOT NULL DEFAULT 0 CHECK(max_claims >= 0),
  claim_count INTEGER NOT NULL DEFAULT 0 CHECK(claim_count >= 0),
  starts_at INTEGER,
  ends_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS promotion_codes_active_idx
ON promotion_codes(enabled, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  reward_currency TEXT NOT NULL,
  reward_units INTEGER NOT NULL CHECK(reward_units > 0),
  created_at INTEGER NOT NULL,
  UNIQUE(promotion_id, uid),
  FOREIGN KEY(promotion_id) REFERENCES promotion_codes(id)
);

CREATE INDEX IF NOT EXISTS promotion_redemptions_uid_created_idx
ON promotion_redemptions(uid, created_at DESC);

CREATE TRIGGER IF NOT EXISTS validate_promotion_redemption_before_insert
BEFORE INSERT ON promotion_redemptions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM promotion_codes p
    WHERE p.id = NEW.promotion_id
      AND p.enabled = 1
      AND (p.starts_at IS NULL OR p.starts_at <= NEW.created_at)
      AND (p.ends_at IS NULL OR p.ends_at > NEW.created_at)
      AND (p.max_claims = 0 OR p.claim_count < p.max_claims)
      AND p.reward_currency = NEW.reward_currency
      AND p.reward_units = NEW.reward_units
  ) THEN RAISE(ABORT, 'PROMOTION_UNAVAILABLE') END;
END;

CREATE TRIGGER IF NOT EXISTS credit_promotion_redemption_after_insert
AFTER INSERT ON promotion_redemptions
BEGIN
  UPDATE promotion_codes
  SET claim_count = claim_count + 1, updated_at = NEW.created_at
  WHERE id = NEW.promotion_id;

  INSERT INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.uid, NEW.reward_currency, NEW.reward_units, 0, 0, 0, NEW.created_at, NEW.created_at)
  ON CONFLICT(uid, currency) DO UPDATE SET
    available_units = available_units + NEW.reward_units,
    updated_at = NEW.created_at;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('promo_' || NEW.id, NEW.uid, NEW.reward_currency, 'promo_reward', NEW.reward_units, NEW.promotion_id, NEW.created_at);

  INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
  VALUES(NEW.uid, NEW.reward_currency, NEW.created_at);
END;
