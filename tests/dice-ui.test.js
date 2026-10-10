import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gameHtml = await readFile(new URL("../dist/game.html", import.meta.url), "utf8");
const diceScript = await readFile(new URL("../dist/dice.js", import.meta.url), "utf8");

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

test("Dice uses cryptographic rolls and reacts to wallet selections", () => {
  assert.match(diceScript, /crypto\.getRandomValues/);
  assert.match(diceScript, /gamrace:wallet-balance-changed/);
  assert.match(diceScript, /displayFiat/);
});
