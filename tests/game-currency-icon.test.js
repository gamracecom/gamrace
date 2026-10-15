import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [html, helper, styles, mines, dice, plinko, roulette, keno, wheel, hilo, blackjack] = await Promise.all([
  read("../dist/game.html"),
  read("../dist/game-currency.js"),
  read("../dist/styles.css"),
  read("../dist/mines.js"),
  read("../dist/dice.js"),
  read("../dist/plinko.js"),
  read("../dist/roulette.js"),
  read("../dist/keno.js"),
  read("../dist/wheel.js"),
  read("../dist/hilo.js"),
  read("../dist/blackjack.js"),
]);

test("game bet fields show fiat symbol or the selected crypto icon", () => {
  assert.match(html, /game-currency\.js\?v=crypto-icons-1/);
  assert.match(helper, /assets\/icons\/crypto\/\$\{icon \|\| "usdt"\}\.svg/);
  assert.match(helper, /field\.textContent = "\$"/);
  assert.match(styles, /\.crypto-icon-mark img/);
  for (const script of [mines, dice, plinko, roulette, keno, wheel, hilo, blackjack]) {
    assert.match(script, /GamRaceBetCurrency\?\.render/);
  }
});
