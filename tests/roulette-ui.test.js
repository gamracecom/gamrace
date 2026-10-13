import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration, liveMigration] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/roulette.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0009_roulette_rounds.sql", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0010_roulette_live_rounds.sql", import.meta.url), "utf8"),
]);

test("Roulette offers the exact two 2x lanes plus 7x and 14x tile order", () => {
  assert.match(html, /id="roulette-game"/);
  for (const outcome of ["blue", "cyan", "purple", "gold"]) assert.match(html, new RegExp(`data-roulette-option="${outcome}"`));
  assert.equal((html.match(/Win <strong>2×/g) || []).length, 2);
  assert.match(html, /Win <strong>7×/);
  assert.match(html, /Win <strong>14×/);
  assert.match(script, /"purple", "gold", "purple"/);
  assert.match(html, /blue-2x\.png/);
  assert.doesNotMatch(html, /jackpot/i);
});

test("Roulette animates only the server-authoritative result and settles the wallet", () => {
  assert.match(script, /\/games\/roulette\/wagers/);
  assert.match(script, /\/games\/roulette\/rounds\/\$\{encodeURIComponent\(roundId\)\}\/settle/);
  assert.match(script, /spinToOutcome\(response\.round\.result, response\.round\.landingBasisPoints\)/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.doesNotMatch(script, /getRandomValues/);
  assert.match(worker, /secureRouletteResult\(\)/);
  assert.match(worker, /handleRouletteWager/);
  assert.match(worker, /handleRouletteSettle/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS roulette_rounds/);
  assert.match(liveMigration, /CREATE TABLE IF NOT EXISTS roulette_spins/);
  assert.match(liveMigration, /CREATE TABLE IF NOT EXISTS roulette_wagers/);
  assert.match(script, /ROUND_LENGTH_MS = 12000/);
  assert.match(script, /twoXSelection/);
  assert.match(worker, /You already backed the other 2× tile this spin/);
  assert.match(worker, /available_units = available_units - \?/);
  assert.match(script, /is-centering/);
});

test("Roulette stays simple and responsive", () => {
  assert.match(styles, /\.roulette-options/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.roulette-track-panel/);
  assert.doesNotMatch(html, /Triple/);
  assert.doesNotMatch(html, /Clear bets/i);
  assert.doesNotMatch(html, /data-roulette-balance/);
  assert.match(html, /data-roulette-history-view="top">Top Wins/);
  assert.match(html, /data-roulette-history-view="lucky">Lucky Wins/);
  assert.doesNotMatch(script, /No winning bet/);
});
