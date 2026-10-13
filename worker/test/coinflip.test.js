import assert from "node:assert/strict";
import test from "node:test";
import { coinflipMultiplierMicros } from "../src/core.js";

test("Coinflip streaks compound the configured 99 percent step return", () => {
  assert.equal(coinflipMultiplierMicros(0), 1_000_000);
  assert.equal(coinflipMultiplierMicros(1), 1_980_000);
  assert.equal(coinflipMultiplierMicros(2), 3_920_400);
  assert.equal(coinflipMultiplierMicros(3), 7_762_392);
});

test("Coinflip accepts a zero-edge configuration without changing outcome odds", () => {
  assert.equal(coinflipMultiplierMicros(1, 1_000_000), 2_000_000);
  assert.equal(coinflipMultiplierMicros(4, 1_000_000), 16_000_000);
  assert.throws(() => coinflipMultiplierMicros(21), /streak/);
});
