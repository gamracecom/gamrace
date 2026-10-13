import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, admin] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/coinflip.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/admin.html", import.meta.url), "utf8"),
]);

test("Coinflip provides manual, auto, cashout and both supplied racing faces", () => {
  assert.match(html, /data-coinflip-mode="manual"/);
  assert.match(html, /data-coinflip-mode="auto"/);
  assert.match(html, /assets\/games\/coinflip\/helmet\.png/);
  assert.match(html, /assets\/games\/coinflip\/wheel\.png/);
  assert.match(script, /\/games\/coinflip\/rounds/);
  assert.match(script, /applyGameResult/);
  assert.match(styles, /@keyframes coinflip-heads/);
  assert.match(styles, /@keyframes coinflip-tails/);
});

test("Coinflip rounds are server authoritative, refresh safe and wager first", () => {
  assert.match(worker, /secureRandomInt\(2\)/);
  assert.match(worker, /coinflip_wager_/);
  assert.match(worker, /coinflip_payout_/);
  assert.match(worker, /handleGetActiveCoinflipRound/);
  assert.match(worker, /available_units = available_units - \?/);
});

test("owner game controls show editable and fixed house edges", () => {
  assert.match(admin, /id="game-edge-grid"/);
  assert.match(worker, /GAME_EDGE_DEFINITIONS/);
  assert.match(worker, /editable: false, reason: "Determined by the live tile distribution"/);
  assert.match(worker, /game\.house_edge\.updated/);
});
