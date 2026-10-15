CREATE TABLE IF NOT EXISTS towers_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard', 'extreme')),
  rows INTEGER NOT NULL DEFAULT 8 CHECK(rows = 8),
  columns INTEGER NOT NULL CHECK(columns BETWEEN 2 AND 4),
  traps_per_row INTEGER NOT NULL CHECK(traps_per_row BETWEEN 1 AND 2),
  tower_json TEXT NOT NULL,
  picks_json TEXT NOT NULL DEFAULT '[]',
  cleared_rows INTEGER NOT NULL DEFAULT 0 CHECK(cleared_rows BETWEEN 0 AND 8),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 1000000),
  house_factor_micros INTEGER NOT NULL DEFAULT 990000 CHECK(house_factor_micros BETWEEN 900000 AND 1000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out', 'won')),
  last_action_id TEXT,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS towers_rounds_one_active_idx
ON towers_rounds(uid, currency) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS towers_rounds_uid_created_idx
ON towers_rounds(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS towers_rounds_history_idx
ON towers_rounds(status, created_at DESC);

INSERT OR IGNORE INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
VALUES ('towers', 100, 0, 'migration');
