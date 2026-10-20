import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [styles, adminStyles, gameHtml, indexHtml, kenoScript, plinkoScript, wheelScript] = await Promise.all([
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/admin.css", import.meta.url), "utf8"),
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/keno.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/plinko.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/wheel.js", import.meta.url), "utf8"),
]);

function isAccentBlue(hex) {
  const [red, green, blue] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  hue = (hue + 360) % 360;
  return saturation > 0.35 && hue >= 180 && hue <= 235 && lightness >= 0.42 && lightness <= 0.82;
}

test("site surfaces use the neutral palette with blue primary actions and no game background glow", () => {
  const modern = styles.slice(styles.indexOf("/* Modern neutral surface system */"));
  assert.match(styles, /--bg: #0a0c10/);
  assert.match(modern, /\.game-page,[\s\S]*background: var\(--bg\)/);
  assert.match(modern, /\.mines-board-panel,[\s\S]*background: #0f1115/);
  assert.match(modern, /\.mines-primary-button,[\s\S]*background: #168bff/);
  assert.match(gameHtml, /styles\.css\?v=game-tools-3/);
  assert.match(indexHtml, /styles\.css\?v=lobby-modern-2/);
});

test("risk choices are separate colour-coded controls", () => {
  const modern = styles.slice(styles.indexOf("/* Modern neutral surface system */"));
  assert.match(modern, /\.keno-risk-options \{ gap: 8px; padding: 0; border: 0/);
  assert.match(modern, /\.keno-risk-options button:nth-child\(1\) \{ color: #168bff/);
  assert.match(modern, /\.keno-risk-options button:nth-child\(4\) \{ color: #ff5064/);
});

test("all bright blue accents resolve to the wallet blue", () => {
  const source = [styles, adminStyles, gameHtml, plinkoScript, wheelScript].join("\n");
  const unexpected = [...new Set(source.match(/#[0-9a-fA-F]{6}\b/g) || [])]
    .map((color) => color.toLowerCase())
    .filter((color) => isAccentBlue(color) && color !== "#168bff" && color !== "#4285f4");
  assert.deepEqual(unexpected, []);
  const unexpectedRgb = [...source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)]
    .map((match) => match.slice(1, 4).map(Number))
    .filter(([red, green, blue]) => {
      const hex = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
      return isAccentBlue(hex) && hex !== "#168bff";
    });
  assert.deepEqual(unexpectedRgb, []);
});

test("Keno advertises and renders the 1000x maximum", () => {
  assert.match(gameHtml, /<dt>Maximum win<\/dt><dd>1,000×<\/dd>/);
  assert.match(kenoScript, /MAX_MULTIPLIER_MICROS = 1_000_000_000/);
  assert.match(gameHtml, /keno\.js\?v=session-stats-2/);
});
