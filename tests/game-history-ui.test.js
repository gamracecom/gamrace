import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
]);

test("game result tables start closed behind a custom toolbar toggle", () => {
  assert.equal((html.match(/class="mines-history[^\"]*" hidden/g) || []).length, 5);
  assert.match(script, /game-history-toggle-icon/);
  assert.match(script, /section\.hidden = !open/);
  assert.match(styles, /\.game-history-toggle-icon/);
});

test("game result tables use site typography and return only five leaders", () => {
  assert.match(styles, /\.history-tab[^}]*font-family: inherit/);
  assert.match(styles, /\.history-period select[^}]*font-family: inherit/);
  assert.match(script, /entries\.slice\(0, 5\)/);
  assert.match(worker, /ORDER BY \$\{order\} LIMIT 5/);
});
