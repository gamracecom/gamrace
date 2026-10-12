import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [gameHtml, styles, wallet, dice, mines, plinko, roulette, worker, migration, plinkoMigration, rouletteMigration] = await Promise.all([
  read("../dist/game.html"),
  read("../dist/styles.css"),
  read("../dist/wallet.js"),
  read("../dist/dice.js"),
  read("../dist/mines.js"),
  read("../dist/plinko.js"),
  read("../dist/roulette.js"),
  read("../worker/src/index.js"),
  read("../worker/migrations/0005_game_ledger.sql"),
  read("../worker/migrations/0007_plinko_bets.sql"),
  read("../worker/migrations/0009_roulette_rounds.sql"),
]);

test("game outcomes are settled against the authenticated wallet", () => {
  assert.match(worker, /POST" && path === "\/games\/dice\/bets"/);
  assert.match(worker, /POST" && path === "\/games\/mines\/rounds"/);
  assert.match(worker, /POST" && path === "\/games\/plinko\/bets"/);
  assert.match(worker, /POST" && path === "\/games\/roulette\/bets"/);
  assert.match(worker, /handleRevealMinesTile/);
  assert.match(worker, /handleCashoutMinesRound/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dice_bets/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mines_rounds/);
  assert.match(plinkoMigration, /CREATE TABLE IF NOT EXISTS plinko_bets/);
  assert.match(rouletteMigration, /CREATE TABLE IF NOT EXISTS roulette_rounds/);
  assert.match(migration, /settled INTEGER NOT NULL DEFAULT 0/);
  assert.match(worker, /env\.DB\.batch/);
  assert.match(worker, /available_units >= \?/);
  assert.match(dice, /gamraceWallet\.applyGameResult/);
  assert.match(mines, /gamraceWallet\.applyGameResult/);
  assert.match(plinko, /gamraceWallet\.applyGameResult/);
  assert.match(roulette, /gamraceWallet\.applyGameResult/);
  assert.match(wallet, /applyGameResult/);
});

test("Mines reveals numeric tiles and restores unfinished rounds", () => {
  assert.match(mines, /JSON\.stringify\(\{ tile: index \}\)/);
  assert.doesNotMatch(mines, /JSON\.stringify\(\{ tile \}\)/);
  assert.match(mines, /\/games\/mines\/rounds\/active\?currency=/);
  assert.match(mines, /adoptActiveRound/);
  assert.match(worker, /handleGetActiveMinesRound/);
  assert.match(worker, /GET" && path === "\/games\/mines\/rounds\/active"/);
  assert.match(worker, /WHERE uid = \? AND currency = \? AND status = 'active'/);
  assert.match(worker, /NOT EXISTS\(\s*SELECT 1 FROM mines_rounds/);
});

test("Dice owns the win-loss roll rail and game history is wired", () => {
  assert.match(gameHtml, /data-game-result-strip/);
  assert.match(styles, /\.game-result-pill\.win/);
  assert.match(styles, /\.game-result-pill\s*\{/);
  assert.match(gameHtml, /data-dice-history-view="top"/);
  assert.match(gameHtml, /data-dice-history-view="lucky"/);
  assert.doesNotMatch(mines, /game-result-pill/);
  assert.match(wallet, /data-wallet-transaction-filter="bet"/);
  assert.match(worker, /FROM dice_bets/);
  assert.match(worker, /FROM mines_rounds/);
  assert.match(worker, /FROM plinko_bets/);
  assert.match(worker, /FROM roulette_rounds/);
});

test("visible tick glyphs are absent from the site UI", async () => {
  const sources = await Promise.all([
    "../dist/index.html",
    "../dist/game.html",
    "../dist/admin.html",
    "../dist/admin.js",
    "../dist/admin.css",
    "../dist/styles.css",
    "../dist/wallet.js",
    "../dist/dice.js",
    "../dist/mines.js",
    "../dist/plinko.js",
    "../dist/roulette.js",
  ].map(read));
  for (const source of sources) assert.doesNotMatch(source, /[✓✔☑]/u);
});
