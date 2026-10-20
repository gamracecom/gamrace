import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [wallet, worker, schema, migration, index, script, navigation, styles] = await Promise.all([
  read("../dist/wallet.js"), read("../worker/src/index.js"), read("../worker/schema.sql"),
  read("../worker/migrations/0038_wallet_tips.sql"), read("../dist/index.html"),
  read("../dist/script.js"), read("../dist/mobile-nav.js"), read("../dist/styles.css"),
]);

test("wallet tips are server-authoritative, atomic and idempotent", () => {
  assert.match(wallet, /data-wallet-form="tip"/);
  assert.match(wallet, /requestId: crypto\.randomUUID/);
  assert.match(wallet, /api\("\/wallet\/tips"/);
  assert.match(worker, /POST" && path === "\/wallet\/tips"/);
  assert.match(worker, /SELECT \* FROM wallet_tips WHERE sender_uid = \? AND request_id = \?/);
  assert.match(worker, /usdValue \+ 1e-9 < 0\.10/);
  assert.match(worker, /You cannot tip your own account/);
  for (const sql of [schema, migration]) {
    assert.match(sql, /UNIQUE\(sender_uid, request_id\)/);
    assert.match(sql, /CHECK\(sender_uid <> recipient_uid\)/);
    assert.match(sql, /usd_cents_at_send INTEGER NOT NULL CHECK\(usd_cents_at_send >= 10\)/);
    assert.match(sql, /CREATE TRIGGER IF NOT EXISTS execute_wallet_tip_before_insert/);
    assert.match(sql, /RAISE\(ABORT, 'INSUFFICIENT_FUNDS'\)/);
    assert.match(sql, /CREATE TRIGGER IF NOT EXISTS execute_wallet_tip_after_insert/);
    assert.match(sql, /available_units = available_units - NEW\.amount_units/);
    assert.match(sql, /available_units = available_units \+ NEW\.amount_units/);
    assert.match(sql, /'tip_sent'/);
    assert.match(sql, /'tip_received'/);
  }
});

test("wallet dropdown groups stablecoins while withdrawals can choose any supported network", () => {
  assert.match(wallet, /const visibleGroups = currencyGroups\(currencies\)/);
  assert.match(wallet, /group\.length === 1 \? `<small>\$\{asset\.network\}<\/small>` : ""/);
  assert.match(wallet, /const fundedSymbols = new Set\(positiveBalances\.map\(\(asset\) => asset\.symbol\)\)/);
  assert.match(wallet, /currencies\.filter\(\(asset\) => fundedSymbols\.has\(asset\.symbol\)\)/);
  for (const sql of [schema, migration]) {
    assert.match(sql, /NEW\.payout_currency IN \('usdttrc20','usdtbep20','usdtsol','usdtpolygon','usdterc20'\)/);
    assert.match(sql, /NEW\.payout_currency IN \('usdcsol','usdcpolygon','usdcbase','usdcbep20','usdc'\)/);
    assert.match(sql, /SET available_units = 0, updated_at = NEW\.updated_at/);
  }
});

test("lobby rotates a rewards slide with leaderboard slides", () => {
  assert.match(index, /class="leaderboard-slide rewards-banner-slide" data-banner-href="rewards\.html"/);
  assert.match(index, /assets\/rewards\/instant-rakeback\.webp/);
  assert.match(script, /querySelectorAll\("\.leaderboard-slide"\)/);
  assert.match(script, /leaderboardBanner\.href = slide\?\.dataset\.bannerHref/);
  assert.equal((index.match(/leaderboard-slide-indicators[\s\S]*?<\/span>/)?.[0].match(/<i/g) || []).length, 3);
});

test("mobile chat close is hidden and nav icons use an exact solid brand mask", () => {
  assert.match(styles, /\.live-chat-panel>header \[data-chat-close\]\{display:none!important\}/);
  assert.match(navigation, /mobile-tab-icon-mask/);
  assert.match(navigation, /--mobile-tab-icon/);
  assert.match(styles, /\.mobile-tab-action\.active>\.mobile-tab-icon-mask[\s\S]*?background:#168bff/);
  assert.match(styles, /\.wallet-tab\.active[^}]*color: #168bff/);
});

test("deposit address uses the same neutral wallet surfaces", () => {
  assert.match(styles, /\.deposit-address-row>div,[^{]+\{border-color:#2b3440!important;background:#151a21!important\}/);
  assert.match(styles, /\.deposit-address-row button,[^{]+\{border-left-color:#2b3440!important;background:#20262e!important;color:#fff!important\}/);
});
