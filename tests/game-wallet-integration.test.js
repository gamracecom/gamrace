import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [gameHtml, styles, wallet, dice, mines, worker, migration] = await Promise.all([
  read("../dist/game.html"),
  read("../dist/styles.css"),
  read("../dist/wallet.js"),
  read("../dist/dice.js"),
  read("../dist/mines.js"),
  read("../worker/src/index.js"),
  read("../worker/migrations/0005_game_ledger.sql"),
]);

test("game outcomes are settled against the authenticated wallet", () => {
  assert.match(worker, /POST" && path === "\/games\/dice\/bets"/);
  assert.match(worker, /POST" && path === "\/games\/mines\/rounds"/);
  assert.match(worker, /handleRevealMinesTile/);
  assert.match(worker, /handleCashoutMinesRound/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dice_bets/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mines_rounds/);
  assert.match(migration, /settled INTEGER NOT NULL DEFAULT 0/);
  assert.match(worker, /env\.DB\.batch/);
  assert.match(worker, /available_units >= \?/);
  assert.match(dice, /gamraceWallet\.applyGameResult/);
  assert.match(mines, /gamraceWallet\.applyGameResult/);
  assert.match(wallet, /applyGameResult/);
});

test("game history and win-loss multiplier pills are wired", () => {
  assert.match(gameHtml, /data-game-result-strip/);
  assert.match(styles, /\.game-result-pill\.win/);
  assert.match(styles, /\.game-result-pill\s*\{/);
  assert.match(wallet, /data-wallet-transaction-filter="bet"/);
  assert.match(worker, /FROM dice_bets/);
  assert.match(worker, /FROM mines_rounds/);
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
  ].map(read));
  for (const source of sources) assert.doesNotMatch(source, /[✓✔☑]/u);
});
