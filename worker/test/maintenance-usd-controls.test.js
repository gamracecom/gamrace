import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0030_game_maintenance_usd_controls.sql", import.meta.url), "utf8");

test("game maintenance is persisted and guards every new original wager route", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const gameColumns = database.prepare("PRAGMA table_info(game_settings)").all().map((column) => column.name);
  assert.ok(gameColumns.includes("maintenance_mode"));
  for (const path of [
    "/games/mines/rounds", "/games/dice/bets", "/games/wheel/bets", "/games/hi-lo/rounds",
    "/games/coinflip/rounds", "/games/crash/wagers", "/games/plinko/bets", "/games/keno/bets",
    "/games/roulette/wagers", "/games/blackjack/rounds", "/games/towers/rounds", "/games/moles/rounds",
    "/games/limbo/bets", "/games/stack/rounds",
  ]) assert.ok(source.includes(`"${path}"`), `${path} must be covered`);
  assert.match(source, /NEW_GAME_BET_PATHS\[path\].*requireGameAvailable/s);
  assert.match(source, /GAME_MAINTENANCE/);
  assert.match(migration, /ADD COLUMN maintenance_mode/);
});

test("migration adds controls and carries stablecoin promo requirements into dollars", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE game_settings(game_id TEXT PRIMARY KEY, house_edge_basis_points INTEGER, updated_at INTEGER, updated_by TEXT);
    CREATE TABLE promotion_codes(id TEXT PRIMARY KEY, minimum_deposit_currency TEXT NOT NULL, minimum_deposit_units INTEGER NOT NULL DEFAULT 0);
    INSERT INTO promotion_codes(id, minimum_deposit_currency, minimum_deposit_units) VALUES('stable', 'usdttrc20', 1000000000);
    INSERT INTO promotion_codes(id, minimum_deposit_currency, minimum_deposit_units) VALUES('volatile', 'btc', 100000000);
  `);
  database.exec(migration);
  assert.equal(database.prepare("SELECT maintenance_mode FROM game_settings WHERE game_id = 'none'").get(), undefined);
  assert.equal(database.prepare("SELECT minimum_deposit_usd_cents AS cents FROM promotion_codes WHERE id = 'stable'").get().cents, 1000);
  assert.equal(database.prepare("SELECT minimum_deposit_usd_cents AS cents FROM promotion_codes WHERE id = 'volatile'").get().cents, 0);
});

test("promotion eligibility and admin balance edits use USD", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const promotionColumns = database.prepare("PRAGMA table_info(promotion_codes)").all().map((column) => column.name);
  assert.ok(promotionColumns.includes("minimum_deposit_usd_cents"));
  assert.match(source, /SUM\(requested_usd_cents\).*crypto_deposits/s);
  assert.match(source, /credited = 1/);
  assert.match(source, /body\.amountUsd/);
  assert.match(source, /usdCentsToAssetUnits/);
  assert.doesNotMatch(source, /body\.minimumDepositCurrency/);
});
