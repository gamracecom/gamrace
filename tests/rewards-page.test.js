import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../dist/rewards.html", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../dist/rewards.js", import.meta.url), "utf8");
const profileConfig = fs.readFileSync(new URL("../dist/profile-config.js", import.meta.url), "utf8");
const mobileNav = fs.readFileSync(new URL("../dist/mobile-nav.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");

test("Rewards is minimal, puts promo first and floats three race reward stations", () => {
  assert.ok(page.indexOf('id="promo"') < page.indexOf('class="reward-stations"'));
  for (const pool of ["instant", "weekly", "monthly"]) {
    assert.match(page, new RegExp(`data-reward-pool="${pool}"`));
    assert.match(page, new RegExp(`assets/rewards/${pool}-rakeback\\.webp`));
  }
  assert.match(page, /GamRace go-kart surrounded by gold reward coins/);
  assert.match(page, /GamRace racing car surrounded by gold reward coins/);
  for (const removed of ["YOUR REWARD CIRCUIT", "Builds from every eligible wager", "AVAILABLE NOW", "WEEKLY DROP", "MONTHLY DROP", "RECENT ACTIVITY", "Reward history"]) assert.doesNotMatch(page, new RegExp(removed));
  assert.match(page, /data-rank-reward-rail/);
  assert.match(page, /class="rewards-faq"/);
  assert.match(page, /How does Instant Rakeback work\?/);
  assert.match(page, /How are Weekly and Monthly rewards calculated\?/);
});

test("Rewards claims, promo claims and history are live wallet-backed actions", () => {
  assert.match(client, /request\("\/rewards"\)/);
  assert.match(client, /`\/rewards\/\$\{pool\}\/claim`/);
  assert.match(client, /request\("\/promotions\/claim"/);
  assert.match(client, /gamrace:wallet-balance-changed/);
  assert.match(client, /\/rewards\/ranks\/\$\{rankId\}\/claim/);
  assert.match(client, /lockIcon/);
  assert.match(client, /gamraceWallet\?\.refresh\?\.\(\)/);
  assert.match(client, /starterRank[\s\S]*?"Current"/);
  assert.doesNotMatch(client, /Next drop in/);
  assert.match(worker, /\["i", "ii", "iii"\]\[tierIndex\]/);
});

test("Account and mobile navigation use the dedicated Rewards page", () => {
  assert.match(profileConfig, /id: "rewards", label: "Rewards", kind: "link"/);
  assert.doesNotMatch(profileConfig, /VIP & Rewards/);
  assert.match(mobileNav, /window\.location\.href = "rewards\.html"/);
});
