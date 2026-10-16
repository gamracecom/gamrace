import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration, rouletteMigration, schema] = await Promise.all([
  readFile(new URL("../dist/admin.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/admin.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0024_admin_transactions.sql", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0025_roulette_ledger_history.sql", import.meta.url), "utf8"),
  readFile(new URL("../worker/schema.sql", import.meta.url), "utf8"),
]);

test("control room exposes a filterable live transaction ledger", () => {
  assert.match(html, /data-admin-view="transactions"/);
  assert.match(html, /data-admin-panel="transactions"/);
  assert.match(html, /id="transaction-type-filter"/);
  assert.match(html, /id="transaction-game-filter"/);
  assert.match(html, /id="transactions-table-body"/);
  assert.match(script, /\/admin\/transactions\?limit=100/);
  assert.match(script, /activeView === "transactions"/);
  assert.match(script, /setInterval\([\s\S]*5000\)/);
  assert.match(styles, /\.transaction-summary-grid/);
  assert.match(styles, /\.transaction-amount\.credit/);
});

test("admin transactions are sourced from the authoritative wallet ledger", () => {
  assert.match(worker, /async function handleAdminTransactions/);
  assert.match(worker, /FROM crypto_ledger/);
  assert.match(worker, /path === "\/admin\/transactions"/);
  assert.match(worker, /LEFT JOIN player_profiles/);
  assert.match(worker, /game_wager/);
  assert.match(worker, /game_payout/);
  assert.match(migration, /dice_wager_/);
  assert.match(migration, /limbo_wager_/);
  assert.match(migration, /plinko_wager_/);
  assert.match(migration, /DELETE FROM crypto_ledger/);
  assert.match(migration, /crypto_ledger_created_idx/);
  assert.match(migration, /crypto_ledger_type_created_idx/);
  assert.match(rouletteMigration, /roulette_wager_/);
  assert.match(rouletteMigration, /roulette_payout_/);
  assert.match(rouletteMigration, /type = 'game_bet'/);
  assert.match(schema, /crypto_ledger_type_created_idx/);
  assert.match(schema, /VALUES\('deposit_' \|\| NEW\.payment_id/);
  assert.match(schema, /VALUES\('withdrawal_hold_' \|\| NEW\.id/);
});
