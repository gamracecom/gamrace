import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, script, styles, worker, migration, expansionMigration, history] = await Promise.all([
  readFile(new URL("../dist/game.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/blackjack.js", import.meta.url), "utf8"),
  readFile(new URL("../dist/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../worker/src/index.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0019_blackjack_rounds.sql", import.meta.url), "utf8"),
  readFile(new URL("../worker/migrations/0020_blackjack_multihand_sidebets.sql", import.meta.url), "utf8"),
  readFile(new URL("../dist/game-history.js", import.meta.url), "utf8"),
]);

test("Blackjack has a responsive table and complete game tools", () => {
  assert.match(html, /id="blackjack-game"/);
  assert.match(html, /id="blackjack-dealer-cards"/);
  assert.match(html, /id="blackjack-player-hands"/);
  for (const action of ["hit", "stand", "double", "split"]) assert.match(html, new RegExp(`data-blackjack-action="${action}"`));
  assert.match(html, /data-shared-game-tools="blackjack"/);
  assert.match(html, /data-shared-game-favorite="blackjack"/);
  assert.match(html, /data-game-rtp="blackjack"/);
  assert.match(styles, /\.blackjack-table/);
  assert.match(styles, /@media\(max-width:780px\).*\.blackjack-stage/);
  assert.match(styles, /blackjack-footer \.fairness-label[^}]*background:transparent/);
  assert.match(html, /data-blackjack-view="side-bets"/);
  assert.equal((html.match(/data-blackjack-hand-count=/g) || []).length, 3);
  assert.match(html, /id="blackjack-perfect-pairs"/);
  assert.match(html, /id="blackjack-twenty-one-three"/);
  assert.doesNotMatch(html, /Six-deck shoe/);
  assert.doesNotMatch(html, /Place your bet/);
  assert.doesNotMatch(html, /Your cards appear here/);
});

test("Blackjack is server authoritative, refresh safe and wallet backed", () => {
  assert.match(script, /\/games\/blackjack\/rounds\/active\?currency=/);
  assert.match(script, /\/games\/blackjack\/rounds/);
  assert.match(script, /gamraceWallet\.applyGameResult/);
  assert.doesNotMatch(script, /Math\.random/);
  assert.match(worker, /blackjackShoe/);
  assert.match(worker, /secureRandomInt\(index \+ 1\)/);
  assert.match(worker, /blackjack_wager_/);
  assert.match(worker, /blackjack_extra_/);
  assert.match(worker, /blackjack_payout_/);
  assert.match(worker, /available_units = available_units - \?/);
  assert.match(migration, /blackjack_rounds_one_active_idx/);
  assert.match(migration, /UNIQUE\(uid, request_id\)/);
  assert.match(expansionMigration, /hand_count/);
  assert.match(expansionMigration, /side_bets_json/);
  assert.match(worker, /blackjackSideBetResults/);
  assert.match(worker, /handCount/);
});

test("Blackjack uses six-deck S17 and 3:2 natural rules", () => {
  assert.match(worker, /6 \* 52/);
  assert.match(worker, /value\.total >= 17/);
  assert.match(worker, /2_500_000/);
  assert.match(html, /Blackjack pays <strong>3:2<\/strong>/);
  assert.match(html, /Dealer stands on <strong>soft 17<\/strong>/);
  assert.match(history, /"blackjack"/);
  assert.match(worker, /blackjack: \{ table: "blackjack_rounds", where: "b\.status = 'settled'" \}/);
});
