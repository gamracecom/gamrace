import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [shell, styles, adminHtml, admin, worker, migration] = await Promise.all([
  read("../dist/shell-state.js"), read("../dist/styles.css"), read("../dist/admin.html"),
  read("../dist/admin.js"), read("../worker/src/index.js"), read("../worker/migrations/0037_chat_controls_announcements.sql"),
]);

test("owner announcements are timed, live and rendered beneath the site header", () => {
  assert.match(worker, /path === "\/announcements\/current"/);
  assert.match(worker, /path === "\/admin\/announcement"/);
  assert.match(worker, /endsAt <= startsAt/);
  assert.match(migration, /global_announcement/);
  assert.match(shell, /\/announcements\/current/);
  assert.match(shell, /global-announcement/);
  assert.match(shell, /setInterval\(loadAnnouncement, 30_000\)/);
  assert.match(styles, /\.global-announcement\{[\s\S]*?background:#ffd02f/);
  assert.match(adminHtml, /id="announcement-form"/);
  assert.match(adminHtml, /type="datetime-local"/);
  assert.match(admin, /\/admin\/announcement/);
});
