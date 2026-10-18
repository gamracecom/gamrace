import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, styles, index, stack, shell, wallet] = await Promise.all([
  read("../dist/leaderboard.html"), read("../dist/leaderboard.js"), read("../dist/styles.css"),
  read("../dist/index.html"), read("../dist/stack.js"), read("../dist/shell-state.js"), read("../dist/wallet.js"),
]);

test("leaderboard page has live Daily and BiWeekly podium views", () => {
  assert.match(html, /data-leaderboard-tab="daily"/);
  assert.match(html, /data-leaderboard-tab="biweekly"/);
  assert.equal((html.match(/data-podium-position="[1-3]"/g) || []).length, 3);
  assert.match(html, /data-leaderboard-rows/);
  assert.match(script, /fetch\(`\$\{API_BASE\}\/leaderboards`/);
  assert.match(script, /campaign\.standings/);
  assert.match(styles, /@keyframes podium-arrive/);
  assert.match(styles, /@media\(max-width:620px\)/);
});

test("lobby assets are compressed and Stack no longer narrates a missed level", async () => {
  assert.match(index, /assets\/games\/originals\/stack-v3\.webp/);
  assert.match(index, /assets\/banners\/leaderboard-track-monument-v2\.webp/);
  assert.doesNotMatch(stack, /Missed on level/);
  const original = await stat(new URL("../dist/assets/games/originals/stack-v3.webp", import.meta.url));
  assert.ok(original.size < 500_000);
});

test("wallet selection survives page changes without a temporary zero balance", () => {
  assert.match(shell, /gamrace-wallet-selection-v1/);
  assert.match(shell, /window\.gamraceWalletSelection = initialWalletSelection/);
  assert.match(wallet, /cacheWalletSelection\(detail\)/);
});
