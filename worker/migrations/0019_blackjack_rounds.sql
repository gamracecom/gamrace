CREATE TABLE IF NOT EXISTS blackjack_rounds (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  base_wager_units INTEGER NOT NULL CHECK(base_wager_units > 0),
  wager_units INTEGER NOT NULL CHECK(wager_units > 0),
  payout_units INTEGER NOT NULL DEFAULT 0 CHECK(payout_units >= 0),
  shoe_json TEXT NOT NULL,
  shoe_position INTEGER NOT NULL DEFAULT 0 CHECK(shoe_position >= 0),
  dealer_cards_json TEXT NOT NULL,
  player_hands_json TEXT NOT NULL,
  active_hand INTEGER NOT NULL DEFAULT 0 CHECK(active_hand >= 0),
  split_hand INTEGER NOT NULL DEFAULT 0 CHECK(split_hand IN (0, 1)),
  multiplier_micros INTEGER NOT NULL DEFAULT 0 CHECK(multiplier_micros >= 0),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('win', 'loss', 'push')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'settled')),
  last_action_id TEXT,
  settlement_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE(uid, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS blackjack_rounds_one_active_idx
ON blackjack_rounds(uid, currency) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS blackjack_rounds_uid_created_idx
ON blackjack_rounds(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS blackjack_rounds_history_idx
ON blackjack_rounds(status, created_at DESC);
