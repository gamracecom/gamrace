import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0028_account_profiles_promotions.sql", import.meta.url), "utf8");

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
