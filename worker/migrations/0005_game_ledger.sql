CREATE TABLE IF NOT EXISTS dice_bets (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL CHECK(payout_units >= 0),
  target_basis_points INTEGER NOT NULL CHECK(target_basis_points BETWEEN 100 AND 9800),
  direction TEXT NOT NULL CHECK(direction IN ('over', 'under')),
  roll_basis_points INTEGER NOT NULL CHECK(roll_basis_points BETWEEN 1 AND 10000),
  chance_basis_points INTEGER NOT NULL CHECK(chance_basis_points BETWEEN 100 AND 9900),
  multiplier_micros INTEGER NOT NULL CHECK(multiplier_micros >= 1000000),
  outcome TEXT NOT NULL CHECK(outcome IN ('win', 'loss')),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS dice_bets_uid_created_idx ON dice_bets(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS mines_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  mine_count INTEGER NOT NULL CHECK(mine_count BETWEEN 1 AND 24),
  mine_positions TEXT NOT NULL,
  revealed_positions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'lost', 'cashed_out', 'won')),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  multiplier_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(multiplier_micros >= 0),
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS mines_rounds_uid_created_idx ON mines_rounds(uid, created_at DESC);
