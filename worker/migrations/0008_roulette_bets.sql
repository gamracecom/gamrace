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
