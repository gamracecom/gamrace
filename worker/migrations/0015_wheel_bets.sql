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
