CREATE TABLE player_avatars (
  uid TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  image_base64 TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX player_avatars_public_id_idx ON player_avatars(public_id);

ALTER TABLE chat_messages ADD COLUMN mentioned_uid TEXT;
ALTER TABLE chat_messages ADD COLUMN mentioned_username TEXT;

