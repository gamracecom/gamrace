import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gameHtml = await readFile(new URL("../dist/game.html", import.meta.url), "utf8");
const diceScript = await readFile(new URL("../dist/dice.js", import.meta.url), "utf8");
const minesScript = await readFile(new URL("../dist/mines.js", import.meta.url), "utf8");
const workerScript = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");

test("Dice exposes Manual and Auto without an Advanced mode", () => {
  assert.match(gameHtml, /data-dice-mode="manual"/);
  assert.match(gameHtml, /data-dice-mode="auto"/);
  assert.doesNotMatch(gameHtml, /data-dice-mode="advanced"/);
});

test("Dice includes the complete roll controls and GamRace tools", () => {
  for (const id of ["dice-roll-target", "dice-multiplier", "dice-roll-over", "dice-chance", "dice-action", "dice-auto-action"]) {
    assert.match(gameHtml, new RegExp(`id="${id}"`));
  }
  for (const tool of ["settings", "stats", "info"]) assert.match(gameHtml, new RegExp(`data-dice-game-tool="${tool}"`));
  assert.match(gameHtml, /data-dice-game-favorite="dice"/);
});

test("Dice settles through the authenticated wallet service and reacts to wallet selections", () => {
  assert.match(diceScript, /\/games\/dice\/bets/);
  assert.match(diceScript, /gamraceWallet\.applyGameResult/);
  assert.doesNotMatch(diceScript, /crypto\.getRandomValues/);
  assert.match(diceScript, /gamrace:wallet-balance-changed/);
  assert.match(diceScript, /displayFiat/);
  assert.match(workerScript, /handleDiceBet/);
});

test("completed Dice and Mines bets share the recent multiplier strip", () => {
  assert.match(gameHtml, /data-game-result-strip/);
  assert.match(diceScript, /game-result-pill/);
  assert.match(minesScript, /game-result-pill/);
});
