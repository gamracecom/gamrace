CREATE TABLE IF NOT EXISTS roulette_live_rounds (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL UNIQUE,
  closes_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('blue', 'cyan', 'purple', 'gold')),
  landing_basis_points INTEGER NOT NULL CHECK(landing_basis_points BETWEEN -3200 AND 3200),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'settling', 'settled')),
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS roulette_live_rounds_timeline_idx
ON roulette_live_rounds(starts_at DESC, ends_at DESC);

CREATE INDEX IF NOT EXISTS roulette_wagers_live_round_idx
ON roulette_wagers(spin_id, status, uid, currency);
