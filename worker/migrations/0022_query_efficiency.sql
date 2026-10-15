-- Keep live game, wallet, and admin reads on indexes. These endpoints are
-- latency-sensitive and are called far more often than maintenance reports.
CREATE INDEX IF NOT EXISTS roulette_live_rounds_status_settled_idx
ON roulette_live_rounds(status, settled_at DESC);

CREATE INDEX IF NOT EXISTS crash_live_rounds_status_starts_idx
ON crash_live_rounds(status, starts_at DESC);

CREATE INDEX IF NOT EXISTS crypto_deposits_status_updated_idx
ON crypto_deposits(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS crypto_deposits_status_created_idx
ON crypto_deposits(status, created_at DESC);

CREATE INDEX IF NOT EXISTS crypto_withdrawals_status_updated_idx
ON crypto_withdrawals(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS crypto_balances_currency_idx
ON crypto_balances(currency);

CREATE INDEX IF NOT EXISTS crypto_balances_updated_idx
ON crypto_balances(updated_at DESC);

-- The compact game result card asks for either biggest payouts or biggest
-- multipliers. Matching indexes prevent every open game page scanning all
-- historical bets to find three rows.
CREATE INDEX IF NOT EXISTS dice_bets_top_wins_idx
ON dice_bets(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS dice_bets_lucky_wins_idx
ON dice_bets(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS mines_rounds_top_wins_idx
ON mines_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS mines_rounds_lucky_wins_idx
ON mines_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS plinko_bets_top_wins_idx
ON plinko_bets(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS plinko_bets_lucky_wins_idx
ON plinko_bets(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS roulette_rounds_top_wins_idx
ON roulette_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS roulette_rounds_lucky_wins_idx
ON roulette_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS keno_bets_top_wins_idx
ON keno_bets(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS keno_bets_lucky_wins_idx
ON keno_bets(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS wheel_bets_top_wins_idx
ON wheel_bets(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS wheel_bets_lucky_wins_idx
ON wheel_bets(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS hilo_rounds_top_wins_idx
ON hilo_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS hilo_rounds_lucky_wins_idx
ON hilo_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS coinflip_rounds_top_wins_idx
ON coinflip_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS coinflip_rounds_lucky_wins_idx
ON coinflip_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS crash_wagers_top_wins_idx
ON crash_wagers(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS crash_wagers_lucky_wins_idx
ON crash_wagers(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS blackjack_rounds_top_wins_idx
ON blackjack_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS blackjack_rounds_lucky_wins_idx
ON blackjack_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS towers_rounds_top_wins_idx
ON towers_rounds(payout_units DESC, multiplier_micros DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS towers_rounds_lucky_wins_idx
ON towers_rounds(multiplier_micros DESC, payout_units DESC, created_at DESC);
