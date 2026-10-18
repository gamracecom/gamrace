ALTER TABLE leaderboard_campaigns RENAME TO leaderboard_campaigns_daily_legacy;

CREATE TABLE leaderboard_campaigns (
  cadence TEXT PRIMARY KEY CHECK(cadence IN ('weekly', 'biweekly')),
  prize_usd_cents INTEGER NOT NULL CHECK(prize_usd_cents > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 60 AND 7776000),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO leaderboard_campaigns(
  cadence, prize_usd_cents, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
)
SELECT
  CASE cadence WHEN 'daily' THEN 'weekly' ELSE cadence END,
  prize_usd_cents, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
FROM leaderboard_campaigns_daily_legacy;

DROP TABLE leaderboard_campaigns_daily_legacy;
