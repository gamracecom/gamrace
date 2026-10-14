CREATE TABLE IF NOT EXISTS crash_live_rounds (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL UNIQUE,
  launches_at INTEGER NOT NULL,
  crashes_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  crash_multiplier_micros INTEGER NOT NULL CHECK(crash_multiplier_micros BETWEEN 1000000 AND 1000000000),
  house_factor_micros INTEGER NOT NULL CHECK(house_factor_micros BETWEEN 900000 AND 1000000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS crash_live_rounds_timeline_idx
ON crash_live_rounds(starts_at DESC, ends_at DESC);

CREATE TABLE IF NOT EXISTS crash_wagers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 3),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  auto_cashout_micros INTEGER CHECK(auto_cashout_micros IS NULL OR auto_cashout_micros BETWEEN 1010000 AND 1000000000),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  multiplier_micros INTEGER NOT NULL DEFAULT 0 CHECK(multiplier_micros >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'cashed_out', 'lost')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id),
  UNIQUE(round_id, uid, currency, slot)
);

CREATE INDEX IF NOT EXISTS crash_wagers_round_status_idx
ON crash_wagers(round_id, status, auto_cashout_micros);

CREATE INDEX IF NOT EXISTS crash_wagers_uid_created_idx
ON crash_wagers(uid, created_at DESC);

INSERT OR IGNORE INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
VALUES ('crash', 100, 0, 'migration');
