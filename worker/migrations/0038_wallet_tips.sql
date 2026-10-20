PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallet_tips (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL,
  recipient_username TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_units INTEGER NOT NULL CHECK(amount_units > 0),
  usd_cents_at_send INTEGER NOT NULL CHECK(usd_cents_at_send >= 10),
  created_at INTEGER NOT NULL,
  CHECK(sender_uid <> recipient_uid),
  UNIQUE(sender_uid, request_id)
);

CREATE INDEX IF NOT EXISTS wallet_tips_sender_created_idx ON wallet_tips(sender_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_tips_recipient_created_idx ON wallet_tips(recipient_uid, created_at DESC);

CREATE TRIGGER IF NOT EXISTS execute_wallet_tip_before_insert
BEFORE INSERT ON wallet_tips
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT available_units FROM crypto_balances WHERE uid = NEW.sender_uid AND currency = NEW.currency), 0) < NEW.amount_units
    THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS')
  END;
END;

CREATE TRIGGER IF NOT EXISTS execute_wallet_tip_after_insert
AFTER INSERT ON wallet_tips
BEGIN
  UPDATE crypto_balances
  SET available_units = available_units - NEW.amount_units,
      updated_at = NEW.created_at
  WHERE uid = NEW.sender_uid AND currency = NEW.currency;

  INSERT INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.recipient_uid, NEW.currency, NEW.amount_units, 0, 0, 0, NEW.created_at, NEW.created_at)
  ON CONFLICT(uid, currency) DO UPDATE SET
    available_units = available_units + NEW.amount_units,
    updated_at = NEW.created_at;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('tip_sent_' || NEW.id, NEW.sender_uid, NEW.currency, 'tip_sent', -NEW.amount_units, NEW.id, NEW.created_at);

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('tip_received_' || NEW.id, NEW.recipient_uid, NEW.currency, 'tip_received', NEW.amount_units, NEW.id, NEW.created_at);
END;

DROP TRIGGER IF EXISTS reserve_crypto_withdrawal_before_insert;

CREATE TRIGGER reserve_crypto_withdrawal_before_insert
BEFORE INSERT ON crypto_withdrawals
WHEN NEW.hold_state = 'held'
BEGIN
  SELECT CASE
    WHEN CASE
      WHEN NEW.payout_currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20') THEN COALESCE((
        SELECT SUM(available_units) FROM crypto_balances WHERE uid = NEW.uid AND currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20')
      ), 0)
      WHEN NEW.payout_currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc') THEN COALESCE((
        SELECT SUM(available_units) FROM crypto_balances WHERE uid = NEW.uid AND currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc')
      ), 0)
      ELSE COALESCE((SELECT available_units FROM crypto_balances WHERE uid = NEW.uid AND currency = NEW.payout_currency), 0)
    END < NEW.requested_units
    THEN RAISE(ABORT, 'INSUFFICIENT_FUNDS')
  END;

  INSERT OR IGNORE INTO crypto_balances(
    uid, currency, available_units, held_units, lifetime_deposited_units,
    lifetime_withdrawn_units, created_at, updated_at
  ) VALUES(NEW.uid, NEW.payout_currency, 0, 0, 0, 0, NEW.created_at, NEW.updated_at);

  UPDATE crypto_balances
  SET available_units = available_units + COALESCE((
    SELECT SUM(source.available_units) FROM crypto_balances AS source
    WHERE source.uid = NEW.uid AND source.currency <> NEW.payout_currency AND (
      (NEW.payout_currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20') AND source.currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20')) OR
      (NEW.payout_currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc') AND source.currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc'))
    )
  ), 0), updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency = NEW.payout_currency;

  UPDATE crypto_balances
  SET available_units = 0, updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency <> NEW.payout_currency AND (
    (NEW.payout_currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20') AND currency IN ('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20')) OR
    (NEW.payout_currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc') AND currency IN ('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc'))
  );

  UPDATE crypto_balances
  SET available_units = available_units - NEW.requested_units,
      held_units = held_units + NEW.requested_units,
      updated_at = NEW.updated_at
  WHERE uid = NEW.uid AND currency = NEW.payout_currency;

  INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
  VALUES('withdrawal_hold_' || NEW.id, NEW.uid, NEW.payout_currency, 'withdrawal_hold', -NEW.requested_units, NEW.id, NEW.created_at);
END;
