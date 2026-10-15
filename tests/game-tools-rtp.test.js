import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, tools, worker] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-tools.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
]);

test("every implemented game displays its live return-to-player value", () => {
  for (const game of ["mines", "dice", "plinko", "roulette", "keno", "wheel", "hi-lo", "coinflip", "blackjack"]) {
    assert.match(html, new RegExp(`data-game-rtp="${game}"`));
  }
  assert.match(tools, /games\/settings/);
  assert.match(tools, /setInterval\(refreshRtp, 15_000\)/);
  assert.match(worker, /rtpPercent: 100 - houseEdgeBasisPoints \/ 100/);
});
