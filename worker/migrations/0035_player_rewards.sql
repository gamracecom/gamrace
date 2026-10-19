CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  pool TEXT NOT NULL CHECK(pool IN ('instant', 'weekly', 'monthly')),
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  wager_usd_cents INTEGER NOT NULL CHECK(wager_usd_cents >= 0),
  reward_usd_cents INTEGER NOT NULL CHECK(reward_usd_cents > 0),
  currency TEXT NOT NULL,
  amount_units INTEGER NOT NULL CHECK(amount_units > 0),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, pool, period_start)
);

CREATE INDEX IF NOT EXISTS reward_claims_uid_created_idx
ON reward_claims(uid, created_at DESC);

CREATE TRIGGER IF NOT EXISTS credit_reward_claim_after_insert
AFTER INSERT ON reward_claims
BEGIN
  INSERT INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.uid, NEW.currency, NEW.amount_units, 0, 0, 0, NEW.created_at, NEW.created_at)
  ON CONFLICT(uid, currency) DO UPDATE SET
    available_units = available_units + NEW.amount_units,
    updated_at = NEW.created_at;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('rakeback_' || NEW.id, NEW.uid, NEW.currency, 'rakeback_claim', NEW.amount_units, NEW.pool, NEW.created_at);

  INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
  VALUES(NEW.uid, NEW.currency, NEW.created_at);
END;
