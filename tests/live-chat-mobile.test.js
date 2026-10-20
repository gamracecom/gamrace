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
  assert.match(chat, /Everyone can read the chat/);
  assert.match(chat, /Requirement to chat:/);
  assert.match(chat, /minimumWagerUsdCents/);
  assert.doesNotMatch(chat, /Checking chat access/);
  for (const html of [index, game, leaderboard]) assert.match(html, /chat\.js\?v=live-chat-6/);
  assert.match(chat, /live-chat-mention/);
  assert.match(chat, /mentionedMe/);
  assert.match(chat, /live-chat-send/);
  assert.match(chat, /live-chat-emoji-toggle/);
  assert.match(chat, /data-chat-emoji/);
  assert.match(chat, /access\?\.maxCharacters/);
  assert.match(chat, /access\?\.cooldownMs/);
  assert.match(chat, /send\.disabled = !allowed \|\| coolingDown/);
  assert.match(chat, /<circle cx="16" cy="16" r="10\.5"/);
  assert.match(admin, /\/admin\/chat\/settings/);
  assert.match(admin, /Minimum lifetime wager \(USD\)/);
  assert.match(admin, /Cooldown \(seconds\)/);
  assert.match(admin, /Maximum characters/);
});

test("mobile chat toggles over the previous page and account transactions cannot overflow", () => {
  assert.match(navigation, /if \(action === "chat"\)/);
  assert.match(navigation, /GamRaceChat\.toggle/);
  assert.match(navigation, /actionBeforeChat/);
  assert.match(styles, /body\.live-chat-open/);
  assert.match(styles, /\.account-workspace \.account-table-row\{width:100%;box-sizing:border-box;grid-template-columns:minmax\(0,1fr\)!important\}/);
  assert.match(styles, /overflow-x:hidden!important/);
  assert.match(styles, /\.live-chat-avatar/);
  assert.match(styles, /\.live-chat-mention-highlight/);
  assert.match(styles, /bottom:calc\(var\(--mobile-tabbar-height,62px\) \+ env\(safe-area-inset-bottom\)\)!important/);
  assert.match(styles, /\.mobile-tab-action\.active[\s\S]*?color:#168bff!important/);
  assert.match(styles, /\.live-chat-form input\{height:42px;font-size:16px!important\}/);
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) 42px 42px/);
});
