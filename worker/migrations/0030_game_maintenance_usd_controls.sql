ALTER TABLE game_settings
ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_mode IN (0, 1));

ALTER TABLE promotion_codes
ADD COLUMN minimum_deposit_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_deposit_usd_cents >= 0);

-- Preserve existing stablecoin requirements as USD. Requirements created for
-- volatile assets cannot be converted accurately without a historical quote,
-- so they remain disabled until recreated through the USD-only control.
UPDATE promotion_codes
SET minimum_deposit_usd_cents = CAST((minimum_deposit_units + 500000) / 1000000 AS INTEGER)
WHERE minimum_deposit_currency IN (
  'usdttrc20', 'usdtbep20', 'usdtsol', 'usdtpolygon', 'usdterc20',
  'usdcsol', 'usdcpolygon', 'usdcbase', 'usdcbep20', 'usdc'
)
  AND minimum_deposit_units > 0;
