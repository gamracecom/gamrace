import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { molesMultiplierMicros } from "../worker/src/core.js";

const [html, index, script, styles, worker, migration, history, tools, artwork] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/moles.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0026_moles_rounds.sql", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-tools.js", import.meta.url), "utf8"),
  stat(new URL("../dist/assets/games/originals/moles.png", import.meta.url)),
]);

test("Moles has a complete seven-hole animated interface and homepage artwork", () => {
  assert.match(html, /id="moles-game"/);
  assert.equal((html.match(/data-moles-count="[1-6]"/g) || []).length, 12);
  assert.match(html, /id="moles-holes"/);
  assert.match(html, /data-shared-game-tools="moles"/);
  assert.match(html, /data-game-rtp="moles"/);
  assert.match(index, /assets\/games\/originals\/moles\.png/);
  assert.ok(artwork.size > 100_000);
  assert.match(styles, /@keyframes moles-pop/);
  assert.match(styles, /@keyframes moles-hammer/);
  assert.match(script, /const HOLES = 7/);
  assert.match(script, /const MAX_HITS = 8/);
});

test("Moles rounds are wallet-backed, refresh-safe, recorded, and admin configurable", () => {
  assert.match(script, /\/games\/moles\/rounds\/active\?currency=/);
  assert.match(script, /\/games\/moles\/rounds/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.match(worker, /moles_wager_/);
  assert.match(worker, /moles_payout_/);
  assert.match(worker, /id: "moles", name: "Moles", editable: true/);
  assert.match(worker, /moles: \{ table: "moles_rounds", where: "b\.status IN \('cashed_out', 'won'\)" \}/);
  assert.match(migration, /moles_rounds_one_active_idx/);
  assert.match(migration, /moles_rounds_top_wins_idx/);
  assert.match(history, /"moles"/);
  assert.match(tools, /moles: "Moles"/);
});

test("Moles multiplier keeps the configured RTP at every risk and hit depth", () => {
  assert.equal(molesMultiplierMicros(1, 8, 980_000), 5_649_504_980_000);
  for (let moles = 1; moles <= 6; moles += 1) {
    for (let hits = 1; hits <= 8; hits += 1) {
      const multiplier = molesMultiplierMicros(moles, hits, 980_000) / 1_000_000;
      const expectedReturn = Math.pow(moles / 7, hits) * multiplier;
      assert.ok(Math.abs(expectedReturn - 0.98) < 0.000002, `${moles} moles / ${hits} hits returns ${expectedReturn}`);
    }
  }
});
