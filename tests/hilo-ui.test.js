import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/hilo.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
]);

test("Hi-Lo provides responsive manual and auto play", () => {
  assert.match(html, /id="hilo-game"/);
  assert.match(html, /data-hilo-mode="manual"/);
  assert.match(html, /data-hilo-mode="auto"/);
  assert.match(html, /Higher or Same/);
  assert.match(html, /Lower or Same/);
  assert.match(styles, /\.hilo-stage/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.hilo-stage/);
  assert.match(script, /automaticDirection/);
});

test("Hi-Lo is wallet-backed, refresh-safe, and server-authoritative", () => {
  assert.match(script, /\/games\/hi-lo\/rounds\/active\?currency=/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.doesNotMatch(script, /Math\.random/);
  assert.match(worker, /secureRandomInt\(13\) \+ 1/);
  assert.match(worker, /available_units = available_units - \?/);
  assert.match(worker, /status = 'cashed_out'/);
  assert.match(worker, /INSERT OR IGNORE INTO crypto_ledger/);
});

test("Hi-Lo includes shared tools and live win tables", () => {
  assert.match(html, /data-hilo-game-tool="settings"/);
  assert.match(html, /data-hilo-game-tool="stats"/);
  assert.match(html, /data-hilo-history-view="top"/);
  assert.match(html, /data-hilo-history-view="lucky"/);
  assert.match(script, /gamrace:game-history-refresh/);
});
