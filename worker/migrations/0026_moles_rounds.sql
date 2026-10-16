CREATE TABLE IF NOT EXISTS moles_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  mole_count INTEGER NOT NULL CHECK(mole_count BETWEEN 1 AND 6),
  max_hits INTEGER NOT NULL DEFAULT 8 CHECK(max_hits = 8),
  hole_layouts_json TEXT NOT NULL,
  picks_json TEXT NOT NULL DEFAULT '[]',
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK(hit_count BETWEEN 0 AND 8),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 1000000),
  house_factor_micros INTEGER NOT NULL DEFAULT 980000 CHECK(house_factor_micros BETWEEN 900000 AND 1000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out', 'won')),
  last_action_id TEXT,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS moles_rounds_one_active_idx
ON moles_rounds(uid, currency) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS moles_rounds_uid_created_idx
ON moles_rounds(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS moles_rounds_history_idx
ON moles_rounds(status, created_at DESC);

CREATE INDEX IF NOT EXISTS moles_rounds_top_wins_idx
ON moles_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS moles_rounds_lucky_wins_idx
ON moles_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

INSERT OR IGNORE INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
VALUES ('moles', 200, 0, 'migration');
