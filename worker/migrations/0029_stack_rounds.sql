CREATE TABLE IF NOT EXISTS stack_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard', 'extreme')),
  max_levels INTEGER NOT NULL DEFAULT 24 CHECK(max_levels = 24),
  outcomes_json TEXT NOT NULL,
  offsets_json TEXT NOT NULL,
  drops_json TEXT NOT NULL DEFAULT '[]',
  completed_levels INTEGER NOT NULL DEFAULT 0 CHECK(completed_levels BETWEEN 0 AND 24),
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

CREATE UNIQUE INDEX IF NOT EXISTS stack_rounds_one_active_idx
ON stack_rounds(uid, currency) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS stack_rounds_uid_created_idx
ON stack_rounds(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS stack_rounds_top_wins_idx
ON stack_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS stack_rounds_lucky_wins_idx
ON stack_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

INSERT OR IGNORE INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
VALUES ('stack', 100, 0, 'migration');
