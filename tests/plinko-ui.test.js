import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, core] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/plinko.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/core.js", import.meta.url), "utf8"),
]);

test("Plinko has manual and automatic wallet-backed play", () => {
  assert.match(html, /id="plinko-game"/);
  assert.match(html, /data-plinko-mode="manual"/);
  assert.match(html, /data-plinko-mode="auto"/);
  assert.match(html, /id="plinko-canvas"/);
  assert.match(script, /\/games\/plinko\/bets/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.match(worker, /handlePlinkoBet/);
  assert.match(worker, /INSERT INTO plinko_bets/);
});

test("Plinko outcome and animation are server-authoritative", () => {
  assert.match(worker, /const path = Array\.from\(\{ length: rows \}, \(\) => secureRandomInt\(2\)\)/);
  assert.match(core, /export function plinkoPayout/);
  assert.match(script, /await animatePath\(response\.bet\.path/);
  assert.doesNotMatch(script, /getRandomValues/);
});

test("Plinko provides rows, risks, colourful pockets, and responsive board layout", () => {
  for (const risk of ["low", "medium", "high"]) assert.match(html, new RegExp(`data-plinko-risk="${risk}"`));
  assert.match(styles, /\.plinko-payout-slot/);
  assert.match(styles, /--slot-color/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.plinko-stage/);
});
