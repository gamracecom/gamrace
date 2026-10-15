import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { towersMultiplierMicros } from "../worker/src/core.js";

const [html, script, styles, worker, migration, history] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/towers.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0021_towers_rounds.sql", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
]);

test("Towers has four risks, eight levels and the complete shared tool set", () => {
  assert.match(html, /id="towers-game"/);
  for (const risk of ["easy", "medium", "hard", "extreme"]) assert.match(html, new RegExp(`data-towers-difficulty="${risk}"`));
  for (const tool of ["settings", "stats", "info"]) assert.match(html, new RegExp(`data-shared-game-tool="${tool}"`));
  assert.match(html, /data-shared-game-favorite="towers"/);
  assert.match(html, /data-game-rtp="towers"/);
  assert.match(script, /const ROWS = 8/);
  assert.match(styles, /\.towers-tile/);
  assert.match(styles, /towers-footer \.fairness-label[^}]*background:transparent!important/);
});

test("Towers is wallet-backed, refresh-safe and server authoritative", () => {
  assert.match(script, /\/games\/towers\/rounds\/active\?currency=/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.match(worker, /handleStartTowersRound/);
  assert.match(worker, /handleChooseTowersTile/);
  assert.match(worker, /handleCashoutTowersRound/);
  assert.match(worker, /towers_wager_/);
  assert.match(worker, /towers_payout_/);
  assert.match(worker, /available_units = available_units - \?/);
  assert.match(migration, /towers_rounds_one_active_idx/);
});

test("Towers multipliers preserve the configured RTP at every climb height", () => {
  const levels = [{ columns: 4, traps: 1 }, { columns: 3, traps: 1 }, { columns: 2, traps: 1 }, { columns: 3, traps: 2 }];
  for (const config of levels) {
    const probability = (config.columns - config.traps) / config.columns;
    for (let level = 1; level <= 8; level += 1) {
      const multiplier = towersMultiplierMicros(config.columns, config.traps, level, 990_000) / 1_000_000;
      assert.ok(Math.abs(Math.pow(probability, level) * multiplier - 0.99) < 0.00001);
    }
  }
});

test("Towers results are included in the live wins card", () => {
  assert.match(history, /"towers"/);
  assert.match(worker, /towers: \{ table: "towers_rounds", where: "b\.status IN \('cashed_out', 'won'\)" \}/);
});
