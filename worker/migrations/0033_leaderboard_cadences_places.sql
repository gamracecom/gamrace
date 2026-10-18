ALTER TABLE leaderboard_campaigns RENAME TO leaderboard_campaigns_two_cadences;

CREATE TABLE leaderboard_campaigns (
  cadence TEXT PRIMARY KEY CHECK(cadence IN ('daily', 'weekly', 'biweekly', 'monthly')),
  prize_usd_cents INTEGER NOT NULL CHECK(prize_usd_cents > 0),
  prize_places INTEGER NOT NULL DEFAULT 10 CHECK(prize_places BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended')),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 60 AND 7776000),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO leaderboard_campaigns(
  cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
)
SELECT cadence, prize_usd_cents, 10, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
FROM leaderboard_campaigns_two_cadences;

DROP TABLE leaderboard_campaigns_two_cadences;
