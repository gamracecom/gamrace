import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/roulette.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0008_roulette_bets.sql", import.meta.url), "utf8"),
]);

test("Roulette offers two 2x lanes plus 7x and 14x lanes with original vector icons", () => {
  assert.match(html, /id="roulette-game"/);
  for (const outcome of ["cyan", "red", "violet", "gold"]) assert.match(html, new RegExp(`data-roulette-option="${outcome}"`));
  assert.equal((html.match(/Win 2×/g) || []).length, 2);
  assert.match(html, /Win 7×/);
  assert.match(html, /Win 14×/);
  assert.match(html, /<svg viewBox="0 0 64 64"/);
  assert.doesNotMatch(html, /jackpot/i);
});

test("Roulette animates only the server-authoritative result and settles the wallet", () => {
  assert.match(script, /\/games\/roulette\/bets/);
  assert.match(script, /spinToOutcome\(response\.bet\.result\)/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.doesNotMatch(script, /getRandomValues/);
  assert.match(worker, /secureRouletteResult\(\)/);
  assert.match(worker, /handleRouletteBet/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS roulette_bets/);
});

test("Roulette stays simple and responsive", () => {
  assert.match(styles, /\.roulette-options/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.roulette-track-panel/);
  assert.doesNotMatch(html, /Triple/);
});
