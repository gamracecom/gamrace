import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration, history] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/keno.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0011_keno_bets.sql", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
]);

test("Keno uses a forty-number board with one to ten selectable numbers", () => {
  assert.match(html, /id="keno-game"/);
  assert.match(html, /id="keno-board"/);
  assert.match(html, /id="keno-paytable"/);
  assert.match(html, /data-keno-risk="easy"/);
  assert.match(html, /data-keno-risk="extreme"/);
  assert.match(script, /length: 40/);
  assert.match(script, /selectedNumbers\.size < 10/);
  assert.match(html, /id="keno-auto-pick"/);
});

test("Keno outcomes are generated and settled by the worker", () => {
  assert.match(worker, /shuffledKenoNumbers\(\)\.slice\(0, 10\)/);
  assert.match(worker, /handleStartKenoBet/);
  assert.match(worker, /handleSettleKenoBet/);
  assert.match(worker, /'game_wager', -wager_units/);
  assert.match(worker, /'game_payout', payout_units/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'revealing'/);
  assert.match(script, /\/games\/keno\/bets\/\$\{encodeURIComponent\(bet\.id\)\}\/settle/);
  assert.match(script, /if \(!turbo\) await delay\(260\)/);
});

test("Keno has distinctive responsive tiles and live result history", () => {
  assert.match(styles, /\.keno-tile[\s\S]*clip-path: polygon/);
  assert.match(styles, /\.keno-tile\.selected/);
  assert.match(styles, /\.keno-tile\.drawn\.hit/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*repeat\(5/);
  assert.match(html, /data-keno-history-view="top">Top Wins/);
  assert.match(history, /setInterval\(refresh, 4000\)/);
  assert.match(worker, /LEFT JOIN player_profiles/);
});
