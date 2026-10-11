import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

test("game ledger schema includes exact settlement records", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  const minesColumns = database.prepare("PRAGMA table_info(mines_rounds)").all().map((column) => column.name);
  assert.ok(minesColumns.includes("settled"));
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dice_bets'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mines_rounds'").get());
});

test("game settlement uses atomic D1 batches and balance eligibility checks", () => {
  assert.match(worker, /env\.DB\.batch/);
  assert.match(worker, /available_units >= \?/);
  assert.match(worker, /settleMinesRound/);
  assert.match(worker, /settled = 0/);
});
