import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration, history, workerConfig] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/crash.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0018_crash_live.sql", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/wrangler.toml", import.meta.url), "utf8"),
]);

test("Crash has a live flight surface, four independent Dual slips and full animation states", () => {
  assert.match(html, /id="crash-game"/);
  assert.match(html, /data-crash-mode="manual"/);
  assert.match(html, /data-crash-mode="dual"/);
  assert.equal((html.match(/data-crash-slip="[0-3]"/g) || []).length, 4);
  assert.match(html, /id="crash-rocket"/);
  assert.match(html, /id="crash-explosion"/);
  assert.match(styles, /@keyframes crash-swoosh/);
  assert.match(styles, /@keyframes crash-burst/);
  assert.match(script, /multiplier >= 10 \? "overdrive" : multiplier >= 5 \? "streak" : multiplier >= 2 \? "boost" : "normal"/);
  assert.match(styles, /data-power="overdrive"/);
  assert.match(html, /class="crash-speed-streaks"/);
  assert.match(script, /requestAnimationFrame\(renderFlight\)/);
  assert.doesNotMatch(html, /id="crash-players"/);
  assert.doesNotMatch(html, /Shared live round/);
});

test("Crash is a shared server-authoritative round with immediate wallet debits", () => {
  assert.match(worker, /const CRASH_POST_CRASH_MS = 3_000/);
  assert.match(worker, /settleCrashAutomaticWagers/);
  assert.match(worker, /crashesAtMs: phase === "crashed"/);
  assert.match(worker, /secureRandomInt\(1_000_000\) \+ 1/);
  assert.match(worker, /available_units = available_units - \?/);
  assert.match(worker, /crash_wager_/);
  assert.match(worker, /crash_payout_/);
  assert.match(worker, /phase === "crashed" \? Number\(row\.crash_multiplier_micros\)/);
  assert.doesNotMatch(script, /Math\.random/);
  assert.match(migration, /UNIQUE\(round_id, uid, currency, slot\)/);
  assert.match(migration, /auto_cashout_micros/);
  assert.match(script, /\/ 80000/);
  assert.match(html, /data-crash-auto-infinite/);
  assert.match(worker, /maintainCrashTimeline/);
  assert.match(worker, /settleDueCrashRounds/);
  assert.match(worker, /async scheduled\(controller, env, ctx\)/);
  assert.match(workerConfig, /crons = \["\* \* \* \* \*"\]/);
});

test("Crash uses the shared tools, live RTP and winning history", () => {
  assert.match(html, /data-shared-game-tools="crash"/);
  assert.match(html, /data-game-rtp="crash"/);
  assert.match(html, /data-crash-history-view="top"/);
  assert.match(html, /data-crash-history-view="lucky"/);
  assert.match(history, /"crash"/);
  assert.match(worker, /crash: \{ table: "crash_wagers", where: "b\.status = 'cashed_out'" \}/);
});
