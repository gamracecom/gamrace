import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, styles, worker, migration] = await Promise.all([
  read("../dist/game.html"),
  read("../dist/wheel.js"),
  read("../dist/styles.css"),
  read("../worker/src/index.js"),
  read("../worker/migrations/0015_wheel_bets.sql"),
]);

test("Wheel has responsive manual and auto controls with all risk and segment options", () => {
  assert.match(html, /id="wheel-game"/);
  assert.match(html, /data-wheel-mode="manual"/);
  assert.match(html, /data-wheel-mode="auto"/);
  for (const risk of ["low", "medium", "high"]) assert.match(html, new RegExp(`data-wheel-risk="${risk}"`));
  for (const segments of [10, 20, 30, 40, 50]) assert.match(html, new RegExp(`<option value="${segments}"`));
  assert.match(html, /id="wheel-canvas"/);
  assert.match(html, /class="mines-history wheel-history"/);
  assert.match(styles, /\.wheel-stage/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.wheel-stage/);
});

test("Wheel outcomes are server-authoritative and refresh-safe", () => {
  assert.match(worker, /secureRandomInt\(segments\)/);
  assert.match(worker, /'game_wager'/);
  assert.match(worker, /'game_payout'/);
  assert.match(worker, /status = 'spinning'/);
  assert.match(worker, /status = 'settled'/);
  assert.match(migration, /CHECK\(status IN \('spinning', 'settled'\)\)/);
  assert.match(script, /\/games\/wheel\/bets\/active\?currency=/);
  assert.match(script, /bet\.resultIndex/);
  assert.match(script, /applyGameResult\(response\)/);
  assert.doesNotMatch(script, /Math\.random/);
});

test("Wheel animates before settlement and supports safe autobet stops", () => {
  assert.match(script, /requestAnimationFrame\(frame\)/);
  assert.match(script, /duration = turbo \|\| reduceMotion\.matches \? 520 : 4200/);
  assert.match(script, /await animateWheel\(bet\);[\s\S]*await settleBet\(bet\)/);
  assert.match(script, /autoStopRequested/);
  assert.match(script, /cleanAmount\(\) > availableBalance/);
});
