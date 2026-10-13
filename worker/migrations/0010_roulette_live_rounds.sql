CREATE TABLE IF NOT EXISTS roulette_spins (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  closes_at INTEGER NOT NULL,
  two_x_selection TEXT CHECK(two_x_selection IS NULL OR two_x_selection IN ('blue', 'cyan')),
  result TEXT CHECK(result IS NULL OR result IN ('blue', 'cyan', 'purple', 'gold')),
  landing_basis_points INTEGER CHECK(landing_basis_points IS NULL OR landing_basis_points BETWEEN -3200 AND 3200),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS roulette_spins_uid_status_idx ON roulette_spins(uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS roulette_spins_uid_created_idx ON roulette_spins(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS roulette_wagers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  spin_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  selection TEXT NOT NULL CHECK(selection IN ('blue', 'cyan', 'purple', 'gold')),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settled')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE INDEX IF NOT EXISTS roulette_wagers_spin_idx ON roulette_wagers(spin_id, uid, status);
CREATE INDEX IF NOT EXISTS roulette_wagers_uid_created_idx ON roulette_wagers(uid, created_at DESC);
