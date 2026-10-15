import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
]);

test("every game gets a compact collapsed live-results card", () => {
  assert.equal((html.match(/class="mines-history[^\"]*" hidden/g) || []).length, 11);
  assert.match(script, /game-results-summary/);
  assert.match(script, /section\.removeAttribute\("hidden"\)/);
  assert.match(script, /content\.hidden = !open/);
  assert.match(styles, /\.game-results-card/);
  assert.match(styles, /\.game-results-chevron/);
});

test("game result tables use site typography and return only three winning leaders", () => {
  assert.match(styles, /\.history-tab[^}]*font-family: inherit/);
  assert.match(styles, /\.history-period select[^}]*font-family: inherit/);
  assert.match(script, /entries\.slice\(0, 3\)/);
  assert.match(worker, /ORDER BY \$\{order\} LIMIT 3/);
  assert.match(worker, /b\.payout_units > b\.wager_units/);
  assert.match(worker, /\["30d", "90d"\]/);
});

test("live result users include rank badges and privacy-aware profiles", () => {
  assert.match(script, /history-rank-badge/);
  assert.match(script, /openProfile\(entry\)/);
  assert.match(worker, /Hidden Player/);
  assert.match(worker, /profileVisible/);
});
