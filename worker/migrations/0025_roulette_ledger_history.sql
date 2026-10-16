-- Replace historical net-only Roulette entries with exact wager and payout
-- movements. Current shared Roulette rounds already write these separately.
INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'roulette_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
FROM roulette_rounds;

INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
SELECT 'roulette_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at
FROM roulette_rounds WHERE payout_units > 0;

DELETE FROM crypto_ledger WHERE type = 'game_bet' AND id LIKE 'roulette_%';
