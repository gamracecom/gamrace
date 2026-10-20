import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("leaderboard schema stores one authoritative campaign per cadence", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const columns = database.prepare("PRAGMA table_info(leaderboard_campaigns)").all().map((column) => column.name);
  assert.deepEqual(columns, [
    "cadence", "prize_usd_cents", "prize_places", "status", "duration_seconds",
    "starts_at", "ends_at", "updated_at", "updated_by",
  ]);
  database.prepare(`
    INSERT INTO leaderboard_campaigns(
      cadence, prize_usd_cents, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
    ) VALUES('weekly', 3000000, 'active', 604800, 1000, 604801000, 1000, 'owner')
  `).run();
  assert.equal(database.prepare("SELECT prize_usd_cents FROM leaderboard_campaigns WHERE cadence = 'weekly'").get().prize_usd_cents, 3000000);
  database.prepare(`
    INSERT INTO leaderboard_campaigns(
      cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
    ) VALUES('daily', 100, 5, 'active', 60, 1, 2, 1, 'owner')
  `).run();
  assert.equal(database.prepare("SELECT prize_places FROM leaderboard_campaigns WHERE cadence = 'daily'").get().prize_places, 5);
  assert.throws(() => database.prepare(`
    INSERT INTO leaderboard_campaigns(
      cadence, prize_usd_cents, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
    ) VALUES('hourly', 100, 'active', 60, 1, 2, 1, 'owner')
  `).run());
});

test("leaderboard routes separate public display from owner-only race control", () => {
  assert.match(worker, /path === "\/leaderboards"/);
  assert.match(worker, /handleAdminStartLeaderboard/);
  assert.match(worker, /requireAdminSession\(request, env, user\)/);
  assert.match(worker, /durationSeconds > 7_776_000/);
  assert.match(worker, /leaderboard\.started/);
  assert.match(worker, /async function leaderboardStandings/);
  assert.match(worker, /type IN \('game_wager', 'game_bet'\)/);
  assert.match(worker, /wagerUsdCents/);
  assert.match(worker, /playerRank: rankVisible \? leaderboardRank/);
  assert.match(worker, /LEADERBOARD_CADENCES = \["daily", "weekly", "biweekly", "monthly"\]/);
  assert.match(worker, /Prize places must be between 1 and 50/);
  assert.match(worker, /await optionalUser\(request, env\)/);
  assert.match(worker, /currentPlayer/);
  assert.match(worker, /badgePath: `\/ranks\/\$\{stageId\}-\$\{badgeTier\}\.webp`/);
  assert.match(worker, /async function settleEndedLeaderboards/);
  assert.match(worker, /leaderboard_settlements/);
  assert.match(worker, /type, amount_units, provider_reference, created_at\)\s+VALUES\(\?, \?, \?, 'leaderboard_payout'/);
  assert.match(worker, /status = 'waiting'/);
  assert.match(worker, /maintainLiveGameTimelines\(env, now\(\)\), settleEndedLeaderboards\(env\)/);
});

test("leaderboard settlements and shared chat are persisted and duplicate safe", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const settlementColumns = database.prepare("PRAGMA table_info(leaderboard_settlements)").all().map((column) => column.name);
  assert.ok(settlementColumns.includes("campaign_key"));
  const payoutIndexes = database.prepare("PRAGMA index_list(leaderboard_payouts)").all();
  assert.ok(payoutIndexes.some((index) => index.unique === 1));
  assert.equal(database.prepare("SELECT value_text FROM site_settings WHERE setting_key = 'chat_minimum_wager_usd_cents'").get().value_text, "10000");
  assert.equal(database.prepare("SELECT value_text FROM site_settings WHERE setting_key = 'chat_cooldown_ms'").get().value_text, "1500");
  assert.equal(database.prepare("SELECT value_text FROM site_settings WHERE setting_key = 'chat_max_characters'").get().value_text, "240");
  assert.ok(database.prepare("PRAGMA table_info(chat_messages)").all().some((column) => column.name === "message"));
  assert.ok(database.prepare("PRAGMA table_info(chat_messages)").all().some((column) => column.name === "mentioned_uid"));
  assert.ok(database.prepare("PRAGMA table_info(player_avatars)").all().some((column) => column.name === "public_id"));
  assert.match(worker, /path === "\/profile\/avatar"/);
  assert.match(worker, /mentionedMe/);
  assert.match(worker, /CHAT_MESSAGE_TOO_LONG/);
  assert.match(worker, /CHAT_COOLDOWN/);
});
