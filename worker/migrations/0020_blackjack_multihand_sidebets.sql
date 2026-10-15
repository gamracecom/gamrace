ALTER TABLE blackjack_rounds ADD COLUMN hand_count INTEGER NOT NULL DEFAULT 1 CHECK(hand_count BETWEEN 1 AND 3);
ALTER TABLE blackjack_rounds ADD COLUMN side_wager_units INTEGER NOT NULL DEFAULT 0 CHECK(side_wager_units >= 0);
ALTER TABLE blackjack_rounds ADD COLUMN side_payout_units INTEGER NOT NULL DEFAULT 0 CHECK(side_payout_units >= 0);
ALTER TABLE blackjack_rounds ADD COLUMN side_bets_json TEXT NOT NULL DEFAULT '{}';
