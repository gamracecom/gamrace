CREATE TABLE IF NOT EXISTS leaderboard_campaigns (
  cadence TEXT PRIMARY KEY CHECK(cadence IN ('daily', 'biweekly')),
  prize_usd_cents INTEGER NOT NULL CHECK(prize_usd_cents > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 60 AND 7776000),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
