import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [styles, gameHtml, indexHtml, kenoScript] = await Promise.all([
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/keno.js", import.meta.url), "utf8"),
]);

test("site surfaces use the neutral palette with blue primary actions and no game background glow", () => {
  const modern = styles.slice(styles.indexOf("/* Modern neutral surface system */"));
  assert.match(styles, /--bg: #0a0c10/);
  assert.match(modern, /\.game-page,[\s\S]*background: var\(--bg\)/);
  assert.match(modern, /\.mines-board-panel,[\s\S]*background: #0f1115/);
  assert.match(modern, /\.mines-primary-button,[\s\S]*background: #168cf2/);
  assert.match(gameHtml, /styles\.css\?v=coinflip-1/);
  assert.match(indexHtml, /styles\.css\?v=compact-results-1/);
});

test("risk choices are separate colour-coded controls", () => {
  const modern = styles.slice(styles.indexOf("/* Modern neutral surface system */"));
  assert.match(modern, /\.keno-risk-options \{ gap: 8px; padding: 0; border: 0/);
  assert.match(modern, /\.keno-risk-options button:nth-child\(1\) \{ color: #3ba3ff/);
  assert.match(modern, /\.keno-risk-options button:nth-child\(4\) \{ color: #ff5064/);
});

test("Keno advertises and renders the 1000x maximum", () => {
  assert.match(gameHtml, /<dt>Maximum win<\/dt><dd>1,000×<\/dd>/);
  assert.match(kenoScript, /MAX_MULTIPLIER_MICROS = 1_000_000_000/);
  assert.match(gameHtml, /keno\.js\?v=keno-clean-1/);
});
