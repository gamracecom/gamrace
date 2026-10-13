CREATE TABLE IF NOT EXISTS game_settings (
  game_id TEXT PRIMARY KEY,
  house_edge_basis_points INTEGER NOT NULL DEFAULT 100 CHECK(house_edge_basis_points BETWEEN 0 AND 1000),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

ALTER TABLE mines_rounds ADD COLUMN house_factor_micros INTEGER NOT NULL DEFAULT 990000;
ALTER TABLE hilo_rounds ADD COLUMN house_factor_micros INTEGER NOT NULL DEFAULT 990000;

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
