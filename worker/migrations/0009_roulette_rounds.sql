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
