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
