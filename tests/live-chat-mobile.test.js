import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [chat, navigation, styles, index, game, leaderboard, admin] = await Promise.all([
  read("../dist/chat.js"), read("../dist/mobile-nav.js"), read("../dist/styles.css"),
  read("../dist/index.html"), read("../dist/game.html"), read("../dist/leaderboard.html"), read("../dist/admin.js"),
]);

test("live chat is shared, wager gated and available on every main surface", () => {
  assert.match(chat, /\/chat\/messages/);
  assert.match(chat, /\/chat\/status/);
  assert.match(chat, /window\.setInterval\(refresh, 2_500\)/);
  assert.match(chat, /Everyone can still read chat/);
  assert.match(chat, /minimumWagerUsdCents|remainingUsdCents/);
  for (const html of [index, game, leaderboard]) assert.match(html, /chat\.js\?v=live-chat-1/);
  assert.match(admin, /\/admin\/chat\/settings/);
  assert.match(admin, /Minimum lifetime wager \(USD\)/);
});

test("mobile chat toggles over the previous page and account transactions cannot overflow", () => {
  assert.match(navigation, /if \(action === "chat"\)/);
  assert.match(navigation, /GamRaceChat\.toggle/);
  assert.match(navigation, /actionBeforeChat/);
  assert.match(styles, /body\.live-chat-open/);
  assert.match(styles, /\.account-workspace \.account-table-row\{width:100%;box-sizing:border-box;grid-template-columns:minmax\(0,1fr\)!important\}/);
  assert.match(styles, /overflow-x:hidden!important/);
});
