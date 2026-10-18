import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, styles, index, stack, shell, wallet] = await Promise.all([
  read("../dist/leaderboard.html"), read("../dist/leaderboard.js"), read("../dist/styles.css"),
  read("../dist/index.html"), read("../dist/stack.js"), read("../dist/shell-state.js"), read("../dist/wallet.js"),
]);

test("leaderboard page has four live cadences, exact prize rows and an authenticated player row", () => {
  assert.match(html, /data-leaderboard-tab="daily"/);
  assert.match(html, /data-leaderboard-tab="weekly"/);
  assert.match(html, /data-leaderboard-tab="biweekly"/);
  assert.match(html, /data-leaderboard-tab="monthly"/);
  assert.equal((html.match(/data-podium-position="[1-3]"/g) || []).length, 3);
  assert.match(html, /data-leaderboard-rows/);
  assert.match(html, /data-current-player-row/);
  assert.match(script, /fetch\(`\$\{API_BASE\}\/leaderboards`/);
  assert.match(script, /campaign\.standings/);
  assert.match(script, /campaign\?\.prizePlaces/);
  assert.match(script, /Array\.from\(\{ length: places \}/);
  assert.match(script, /GamRaceAuth\?\.getToken/);
  assert.doesNotMatch(html, /race-leaderboard-hero|leaderboard-circuit-v3|leaderboard-race-cars-v1/);
  assert.equal((html.match(/leaderboard-checkered-flag-v1\.webp/g) || []).length, 3);
  assert.equal((html.match(/class="podium-aura"/g) || []).length, 3);
  assert.equal((html.match(/data-racer-prize/g) || []).length, 3);
  assert.doesNotMatch(html, /View Podium/i);
  assert.doesNotMatch(html, /Compete, climb the grid|starting grid is open|race-live-chip/i);
  assert.doesNotMatch(script, /position === 1 \? "♛"/);
  assert.doesNotMatch(script, /prizeShares/);
  assert.match(styles, /@keyframes realistic-flag-wave-left/);
  assert.match(styles, /@keyframes realistic-flag-wave-right/);
  assert.match(styles, /Leaderboard v5: one compact dark row per prize place/);
  assert.match(styles, /@media\(max-width:720px\)/);
});

test("realistic leaderboard flag artwork is compressed for live loading", async () => {
  const flag = await stat(new URL("../dist/assets/banners/leaderboard-checkered-flag-v1.webp", import.meta.url));
  assert.ok(flag.size < 500_000);
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
