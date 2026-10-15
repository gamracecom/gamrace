import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { limboPayout, limboResultMicros } from "../worker/src/core.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, styles, worker, migration, history, tools, plinko] = await Promise.all([
  read("../dist/game.html"), read("../dist/limbo.js"), read("../dist/styles.css"),
  read("../worker/src/index.js"), read("../worker/migrations/0023_limbo_bets.sql"),
  read("../dist/game-history.js"), read("../dist/game-tools.js"), read("../dist/plinko.js"),
]);

test("Limbo is a wallet-backed original with shared controls and live history", () => {
  assert.match(html, /id="limbo-game"/);
  assert.match(html, /data-limbo-mode="manual"/);
  assert.match(html, /data-limbo-mode="auto"/);
  assert.match(html, /data-shared-game-tools="limbo"/);
  assert.match(html, /data-game-rtp="limbo"/);
  assert.match(script, /\/games\/limbo\/bets/);
  assert.match(script, /GamRaceBetCurrency\?\.render/);
  assert.match(script, /gamrace:session-result/);
  assert.match(worker, /handleLimboBet/);
  assert.match(worker, /limbo_bets/);
  assert.match(migration, /UNIQUE \(uid, request_id\)/);
  assert.match(history, /"limbo"/);
  assert.match(tools, /limbo: "Limbo"/);
  assert.match(styles, /\.limbo-readout\.win/);
});

test("Limbo outcomes use the configured house factor and pay the selected target", () => {
  assert.equal(limboResultMicros(50_000_000, 990_000), 1_980_000);
  assert.equal(limboResultMicros(100_000_000, 990_000), 1_000_000);
  assert.deepEqual(limboPayout(100_000_000, 2_000_000, 2_500_000), { won: true, multiplierMicros: 2_000_000, payoutUnits: 200_000_000 });
  assert.deepEqual(limboPayout(100_000_000, 2_000_000, 1_990_000), { won: false, multiplierMicros: 0, payoutUnits: 0 });
});

test("Plinko uses a tall triangular board with three launch dots and 8 to 16 rows", () => {
  assert.match(html, /id="plinko-canvas" width="820" height="760"/);
  assert.match(plinko, /\[-1, 0, 1\]\.forEach/);
  assert.match(plinko, /for \(let rows = 8; rows <= 16/);
  assert.match(styles, /#plinko-canvas \{ aspect-ratio: 820 \/ 760/);
});

test("Dice reset and increase controls are both visually boxed", () => {
  assert.match(styles, /\.dice-auto-rule label \{[^}]*border-radius:[^}]*background:/s);
  assert.match(styles, /\.dice-auto-rule\.increase-active label \{ background: #343b47/);
});

