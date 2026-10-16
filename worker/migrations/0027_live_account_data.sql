CREATE TABLE IF NOT EXISTS player_preferences (
  uid TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

