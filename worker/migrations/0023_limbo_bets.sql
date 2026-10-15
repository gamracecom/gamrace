CREATE TABLE IF NOT EXISTS limbo_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK (wager_units > 0),
  payout_units INTEGER NOT NULL CHECK (payout_units >= 0),
  target_multiplier_micros INTEGER NOT NULL CHECK (target_multiplier_micros BETWEEN 1010000 AND 1000000000000),
  result_multiplier_micros INTEGER NOT NULL CHECK (result_multiplier_micros BETWEEN 1000000 AND 1000000000000),
  multiplier_micros INTEGER NOT NULL CHECK (multiplier_micros >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss')),
  house_factor_micros INTEGER NOT NULL CHECK (house_factor_micros BETWEEN 900000 AND 1000000),
  created_at INTEGER NOT NULL,
  UNIQUE (uid, request_id)
);

CREATE INDEX IF NOT EXISTS limbo_bets_uid_created_idx
  ON limbo_bets(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS limbo_bets_history_idx
  ON limbo_bets(payout_units DESC, multiplier_micros DESC, created_at DESC)
  WHERE payout_units > wager_units;
