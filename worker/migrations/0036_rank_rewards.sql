CREATE TABLE IF NOT EXISTS rank_reward_settings (
  rank_id TEXT PRIMARY KEY,
  reward_usd_cents INTEGER NOT NULL CHECK(reward_usd_cents >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rank_reward_claims (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  rank_id TEXT NOT NULL,
  threshold_usd_cents INTEGER NOT NULL CHECK(threshold_usd_cents >= 0),
  reward_usd_cents INTEGER NOT NULL CHECK(reward_usd_cents > 0),
  currency TEXT NOT NULL,
  amount_units INTEGER NOT NULL CHECK(amount_units > 0),
  created_at INTEGER NOT NULL,
  UNIQUE(uid, rank_id)
);

CREATE INDEX IF NOT EXISTS rank_reward_claims_uid_created_idx ON rank_reward_claims(uid, created_at DESC);

CREATE TRIGGER IF NOT EXISTS credit_rank_reward_after_insert
AFTER INSERT ON rank_reward_claims
BEGIN
  INSERT INTO crypto_balances(uid, currency, available_units, held_units, lifetime_deposited_units, lifetime_withdrawn_units, created_at, updated_at)
  VALUES(NEW.uid, NEW.currency, NEW.amount_units, 0, 0, 0, NEW.created_at, NEW.created_at)
  ON CONFLICT(uid, currency) DO UPDATE SET available_units = available_units + NEW.amount_units, updated_at = NEW.created_at;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('rank_' || NEW.id, NEW.uid, NEW.currency, 'vip_reward', NEW.amount_units, NEW.rank_id, NEW.created_at);

  INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
  VALUES(NEW.uid, NEW.currency, NEW.created_at);
END;

INSERT OR IGNORE INTO rank_reward_settings(rank_id, reward_usd_cents, enabled, updated_at, updated_by) VALUES
('rookie-1',0,1,0,'schema'),('rookie-2',50,1,0,'schema'),('rookie-3',125,1,0,'schema'),
('street-1',250,1,0,'schema'),('street-2',500,1,0,'schema'),('street-3',1000,1,0,'schema'),
('circuit-1',1750,1,0,'schema'),('circuit-2',2500,1,0,'schema'),('circuit-3',3750,1,0,'schema'),
('turbo-1',5000,1,0,'schema'),('turbo-2',7500,1,0,'schema'),('turbo-3',11250,1,0,'schema'),
('velocity-1',17500,1,0,'schema'),('velocity-2',25000,1,0,'schema'),('velocity-3',37500,1,0,'schema'),
('hyper-1',50000,1,0,'schema'),('hyper-2',75000,1,0,'schema'),('hyper-3',125000,1,0,'schema'),
('apex-1',200000,1,0,'schema'),('apex-2',300000,1,0,'schema'),('apex-3',500000,1,0,'schema'),
('pole-1',750000,1,0,'schema'),('pole-2',1250000,1,0,'schema'),('pole-3',2000000,1,0,'schema'),
('champion-1',3000000,1,0,'schema'),('champion-2',5000000,1,0,'schema'),('champion-3',8750000,1,0,'schema'),
('hall-of-fame-1',12500000,1,0,'schema'),('hall-of-fame-2',25000000,1,0,'schema'),('hall-of-fame-3',50000000,1,0,'schema');
