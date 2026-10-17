import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0028_account_profiles_promotions.sql", import.meta.url), "utf8");
const archiveMigration = readFileSync(new URL("../migrations/0031_promotion_archives.sql", import.meta.url), "utf8");

test("account details and activity are server-backed", () => {
  assert.match(source, /handleAccountDetails/);
  assert.match(source, /handleAccountActivity/);
  assert.match(source, /\/account\/activity/);
  assert.match(source, /\/account\/details/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS account_profiles/);
});

test("promotion claims are unique and credit wallets atomically", () => {
  assert.match(migration, /UNIQUE\(promotion_id, uid\)/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS validate_promotion_redemption_before_insert/);
  assert.match(migration, /available_units = available_units \+ NEW\.reward_units/);
  assert.match(migration, /'promo_reward'/);
  assert.match(source, /handlePromotionClaim/);
  assert.match(source, /handleAdminCreatePromotion/);
});

test("promotion removal is recoverable and immediately prevents claims", () => {
  assert.match(archiveMigration, /ADD COLUMN archived_at/);
  assert.match(source, /handleAdminRemovePromotion/);
  assert.match(source, /SET enabled = 0, archived_at = \?/);
  assert.match(source, /promo\.archived_at \|\| !promo\.enabled/);
  assert.match(source, /WHERE archived_at IS NULL ORDER BY created_at DESC/);
});
