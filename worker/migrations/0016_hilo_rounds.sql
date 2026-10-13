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
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hilo_rounds_one_active_idx ON hilo_rounds(uid, currency) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS hilo_rounds_uid_created_idx ON hilo_rounds(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS hilo_rounds_history_idx ON hilo_rounds(status, created_at DESC);
