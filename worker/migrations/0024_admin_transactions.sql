-- Expand older net-only instant-game ledger entries into exact wager and payout
-- movements so the owner feed reflects what the player actually staked.
INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'dice_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at FROM dice_bets;
INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'dice_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at FROM dice_bets WHERE payout_units > 0;

INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'limbo_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at FROM limbo_bets;
INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'limbo_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at FROM limbo_bets WHERE payout_units > 0;

INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'plinko_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at FROM plinko_bets;
INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'plinko_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at FROM plinko_bets WHERE payout_units > 0;

DELETE FROM crypto_ledger
WHERE type = 'game_bet' AND (id LIKE 'dice_%' OR id LIKE 'limbo_%' OR id LIKE 'plinko_%');

-- Keep the owner transaction feed fast as the wager ledger grows.
CREATE INDEX IF NOT EXISTS crypto_ledger_created_idx
ON crypto_ledger(created_at DESC);

CREATE INDEX IF NOT EXISTS crypto_ledger_type_created_idx
ON crypto_ledger(type, created_at DESC);
