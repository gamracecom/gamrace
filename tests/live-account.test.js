import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, auth, services, migration] = await Promise.all([
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/firebase-auth.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/profile-services.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0027_live_account_data.sql", import.meta.url), "utf8"),
]);

test("rank and account statistics use the authoritative live game records", () => {
  assert.match(worker, /const PLAYER_BET_UNION_SQL/);
  for (const table of [
    "dice_bets", "limbo_bets", "mines_rounds", "plinko_bets", "roulette_rounds",
    "keno_bets", "wheel_bets", "hilo_rounds", "coinflip_rounds", "crash_wagers",
    "blackjack_rounds", "towers_rounds", "moles_rounds",
  ]) assert.match(worker, new RegExp(`FROM ${table}`));
  assert.match(worker, /lifetimeWeightedWager/);
  assert.match(worker, /path === "\/account"/);
  assert.match(auth, /refreshLiveAccountData/);
  assert.match(auth, /renderRank\(currentProfile\)/);
  assert.doesNotMatch(services, /totalWagered:\s*0/);
});

test("transactions render live bets and wallet history uses the same account source", () => {
  assert.match(worker, /liveAccountSnapshot\(env, user\.sub\)/);
  assert.match(auth, /account-table-row/);
  assert.match(auth, /renderBetActivity\(accountSnapshot\.activity, accountSnapshot\.pagination\)/);
  assert.match(services, /\/account\?compact=1/);
});

test("live account aggregation stays within D1 compound limits and accepts signed profit", () => {
  assert.match(worker, /const PLAYER_BET_UNION_GROUPS = \[/);
  assert.match(worker, /env\.DB\.batch\(queries\)/);
  assert.match(worker, /assetUnitsToString\(Math\.abs\(numericUnits\), false\)/);
  assert.match(worker, /numericUnits < 0 \? -1 : 1/);
});

test("player settings persist in D1 and sync across devices", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS player_preferences/);
  assert.match(worker, /path === "\/account\/preferences"/);
  assert.match(worker, /INSERT INTO player_preferences/);
  assert.match(services, /saveRemote/);
  assert.match(auth, /profileServices\.preferences\.saveRemote/);
});
