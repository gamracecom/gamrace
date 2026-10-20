import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [profile, worker, chat, leaderboard, history, wallet, rewards, styles, index, game, leaderboardPage, rewardsPage] = await Promise.all([
  read("../dist/public-profile.js"), read("../worker/src/index.js"), read("../dist/chat.js"),
  read("../dist/leaderboard.js"), read("../dist/game-history.js"), read("../dist/wallet.js"),
  read("../dist/rewards.js"), read("../dist/styles.css"), read("../dist/index.html"),
  read("../dist/game.html"), read("../dist/leaderboard.html"), read("../dist/rewards.html"),
]);

test("public player profiles respect visibility and expose only opted-in statistics", () => {
  assert.match(worker, /async function handlePublicPlayerProfile/);
  assert.match(worker, /preferences\.profilePublic !== false/);
  assert.match(worker, /preferences\.showUsername !== false/);
  assert.match(worker, /preferences\.showProfit === true/);
  assert.match(worker, /preferences\.showWagers === true/);
  assert.match(worker, /This player keeps their profile private/);
  assert.match(worker, /GET" && publicPlayerProfileMatch/);
  assert.match(profile, /Bets placed/);
  assert.match(profile, /Profit \/ loss/);
  assert.match(profile, /Highest multiplier/);
  assert.match(profile, /Private/);
});

test("player profile links work from chat, game wins and leaderboards", () => {
  assert.match(chat, /dataset\.playerProfile = message\.username/);
  assert.match(leaderboard, /dataset\.playerProfile = profileUsername/);
  assert.match(leaderboard, /dataset\.playerProfile = entry\.username/);
  assert.match(history, /button\.dataset\.playerProfile = entry\.username/);
  for (const page of [index, game, leaderboardPage, rewardsPage]) assert.match(page, /public-profile\.js\?v=player-profile-1/);
});

test("profile tips use the live wallet and recipient privacy settings", () => {
  assert.match(profile, /gamraceWallet\?\.openTip\?\.\(username\)/);
  assert.match(wallet, /openTip: async \(username = ""\)/);
  assert.match(worker, /recipientPreferences\.allowTips === false/);
  assert.match(worker, /That player is not accepting tips/);
});

test("wallet balances are compact and rank cards centre without offset-parent assumptions", () => {
  assert.match(styles, /\.balance-menu\{width:252px/);
  assert.match(styles, /\.balance-option\{min-height:45px;grid-template-columns:25px minmax\(0,1fr\)/);
  assert.doesNotMatch(wallet, /\$\{shownBalance\}<\/em><\/span><i/);
  assert.match(rewards, /getBoundingClientRect\(\)/);
  assert.match(styles, /--rank-card-width:calc\(100% - 32px\)/);
  assert.match(styles, /padding-inline:16px/);
});
