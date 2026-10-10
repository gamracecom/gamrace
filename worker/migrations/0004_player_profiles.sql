CREATE TABLE IF NOT EXISTS player_profiles (
  uid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS player_profiles_username_idx
ON player_profiles(username COLLATE NOCASE);
