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
  assert.match(html, /leaderboard-circuit-v3\.webp/);
  assert.match(html, /leaderboard-race-cars-v1\.webp/);
  assert.equal((html.match(/class="podium-flag"/g) || []).length, 3);
  assert.equal((html.match(/data-racer-prize/g) || []).length, 3);
  assert.doesNotMatch(html, /View Podium/i);
  assert.match(script, /prizeShares/);
  assert.match(script, /standings\.slice\(0, 10\)/);
  assert.match(styles, /@keyframes leaderboard-cars-zoom/);
  assert.match(styles, /@keyframes leaderboard-flag-sway/);
  assert.match(styles, /@media\(max-width:720px\)/);
});

test("leaderboard artwork is compressed for live loading", async () => {
  const circuit = await stat(new URL("../dist/assets/banners/leaderboard-circuit-v3.webp", import.meta.url));
  const cars = await stat(new URL("../dist/assets/banners/leaderboard-race-cars-v1.webp", import.meta.url));
  assert.ok(circuit.size < 350_000);
  assert.ok(cars.size < 500_000);
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
