import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminHtml = await readFile(new URL("../dist/admin.html", import.meta.url), "utf8");
const adminScript = await readFile(new URL("../dist/admin.js", import.meta.url), "utf8");
const workerScript = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");

test("owner player controls expose an audited balance editor", () => {
  assert.match(adminHtml, /id="balance-dialog"/);
  assert.match(adminHtml, /Held funds are protected/);
  assert.match(adminScript, /data-edit-player-balance/);
  assert.match(workerScript, /requireAdminSession\(request, env, user\)/);
  assert.match(workerScript, /player\.balance\.set/);
  assert.match(workerScript, /admin_balance_set/);
});

test("player usernames are synchronized and rendered in the control panel", () => {
  assert.match(adminScript, /user\.username/);
  assert.match(workerScript, /handleSyncProfile/);
  assert.match(workerScript, /player_profiles/);
});
