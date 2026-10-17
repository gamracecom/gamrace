ALTER TABLE promotion_codes
ADD COLUMN archived_at INTEGER;

CREATE INDEX IF NOT EXISTS promotion_codes_visible_idx
ON promotion_codes(archived_at, created_at DESC);
