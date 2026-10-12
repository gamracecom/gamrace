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
