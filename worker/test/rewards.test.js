import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const worker = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0035_player_rewards.sql", import.meta.url), "utf8");

test("rakeback claims are unique, auditable and atomically credit the wallet", () => {
  assert.match(migration, /UNIQUE\(uid, pool, period_start\)/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS credit_reward_claim_after_insert/);
  assert.match(migration, /'rakeback_claim'/);
  assert.match(migration, /available_units = available_units \+ NEW\.amount_units/);
});

test("reward routes are authenticated and cover instant, weekly and monthly pools", () => {
  assert.match(worker, /path === "\/rewards"/);
  assert.match(worker, /\^\\\/rewards\\\/\(instant\|weekly\|monthly\)\\\/claim\$/);
  assert.match(worker, /instant: Object\.freeze\(\{ rateBasisPoints: 10/);
  assert.match(worker, /weekly: Object\.freeze\(\{ rateBasisPoints: 3/);
  assert.match(worker, /monthly: Object\.freeze\(\{ rateBasisPoints: 2/);
  assert.match(worker, /periodStart >= periodEnd/);
  assert.doesNotMatch(worker.slice(worker.indexOf("const REWARD_POOLS"), worker.indexOf("function playerRankIndex")), /Math\.random/);
});
