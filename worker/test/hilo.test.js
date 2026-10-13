import assert from "node:assert/strict";
import test from "node:test";
import { hiloChoice, hiloWins } from "../src/core.js";

test("Hi-Lo choices pay at a 99 percent return for every rank", () => {
  for (let rank = 1; rank <= 13; rank += 1) {
    for (const direction of ["higher", "lower"]) {
      const choice = hiloChoice(rank, direction);
      const returnToPlayer = choice.favorableCards / 13 * choice.multiplierMicros / 1_000_000;
      assert.ok(returnToPlayer <= 0.99, `${rank} ${direction} exceeds 99% RTP`);
      assert.ok(returnToPlayer > 0.989999, `${rank} ${direction} is below the intended RTP`);
    }
  }
});

test("Hi-Lo treats equal cards as wins on both choices", () => {
  assert.equal(hiloWins(7, 7, "higher"), true);
  assert.equal(hiloWins(7, 7, "lower"), true);
  assert.equal(hiloWins(7, 8, "higher"), true);
  assert.equal(hiloWins(7, 6, "higher"), false);
  assert.equal(hiloWins(7, 6, "lower"), true);
  assert.equal(hiloWins(7, 8, "lower"), false);
  assert.equal(hiloChoice(1, "higher").multiplierMicros, 990_000);
  assert.equal(hiloChoice(13, "lower").multiplierMicros, 990_000);
  assert.equal(hiloChoice(1, "higher").available, false);
  assert.equal(hiloChoice(13, "lower").available, false);
  for (let rank = 1; rank <= 13; rank += 1) {
    for (const direction of ["higher", "lower"]) {
      const choice = hiloChoice(rank, direction);
      if (choice.available) assert.ok(choice.multiplierMicros >= 1_000_000);
    }
  }
});
