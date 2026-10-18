ALTER TABLE leaderboard_campaigns RENAME TO leaderboard_campaigns_before_settlement;

CREATE TABLE leaderboard_campaigns (
  cadence TEXT PRIMARY KEY CHECK(cadence IN ('daily', 'weekly', 'biweekly', 'monthly')),
  prize_usd_cents INTEGER NOT NULL CHECK(prize_usd_cents > 0),
  prize_places INTEGER NOT NULL DEFAULT 10 CHECK(prize_places BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'waiting', 'ended')),
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 60 AND 7776000),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO leaderboard_campaigns(
  cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
)
SELECT cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
FROM leaderboard_campaigns_before_settlement;

DROP TABLE leaderboard_campaigns_before_settlement;

CREATE TABLE leaderboard_settlements (
  campaign_key TEXT PRIMARY KEY,
  cadence TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  prize_usd_cents INTEGER NOT NULL,
  paid_usd_cents INTEGER NOT NULL DEFAULT 0,
  winner_count INTEGER NOT NULL DEFAULT 0,
  settled_at INTEGER NOT NULL
);

CREATE TABLE leaderboard_payouts (
  id TEXT PRIMARY KEY,
  campaign_key TEXT NOT NULL,
  cadence TEXT NOT NULL,
  uid TEXT NOT NULL,
  position INTEGER NOT NULL,
  wager_usd_cents INTEGER NOT NULL,
  prize_usd_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount_units INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(campaign_key, uid),
  UNIQUE(campaign_key, position)
);

CREATE INDEX leaderboard_payouts_uid_created_idx ON leaderboard_payouts(uid, created_at DESC);

CREATE TABLE site_settings (
  setting_key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings(setting_key, value_text, updated_at, updated_by)
VALUES('chat_minimum_wager_usd_cents', '10000', 0, 'system');

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  username TEXT NOT NULL,
  rank_label TEXT NOT NULL,
  badge_path TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX chat_messages_created_idx ON chat_messages(created_at DESC);
CREATE INDEX chat_messages_uid_created_idx ON chat_messages(uid, created_at DESC);
