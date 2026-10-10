CREATE TABLE IF NOT EXISTS user_sessions (
  uid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  device TEXT NOT NULL,
  operating_system TEXT NOT NULL,
  browser TEXT NOT NULL,
  country_code TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT,
  ip_masked TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(uid, session_id)
);

CREATE INDEX IF NOT EXISTS user_sessions_uid_active_idx ON user_sessions(uid, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS country_access (
  country_code TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK(allowed IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
