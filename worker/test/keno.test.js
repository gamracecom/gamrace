import assert from "node:assert/strict";
import test from "node:test";
import { KENO_PAYTABLE_MICROS, kenoMultiplierMicros, kenoPayout } from "../src/core.js";

function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index += 1) result = result * (n - Math.min(k, n - k) + index) / index;
  return result;
}

test("Keno paytables hold the house return at or below 99 percent", () => {
  let maximumMultiplier = 0;
  for (const risk of ["easy", "medium", "hard", "extreme"]) {
    for (let selected = 1; selected <= 10; selected += 1) {
      let returnToPlayer = 0;
      for (let hits = 0; hits <= selected; hits += 1) {
        const probability = combinations(selected, hits) * combinations(40 - selected, 10 - hits) / combinations(40, 10);
        returnToPlayer += probability * kenoMultiplierMicros(selected, hits, risk) / 1_000_000;
      }
      assert.ok(returnToPlayer <= 0.9900001, `${risk} with ${selected} picks exceeds 99% RTP`);
      assert.ok(returnToPlayer >= 0.9899, `${risk} with ${selected} picks falls below the intended RTP`);
      for (const multiplier of Object.values(KENO_PAYTABLE_MICROS[risk][selected])) {
        maximumMultiplier = Math.max(maximumMultiplier, multiplier);
        assert.ok(multiplier <= 1_000_000_000, `${risk} with ${selected} picks exceeds the 1000x maximum`);
      }
    }
  }
  assert.equal(maximumMultiplier, 1_000_000_000);
});

test("Keno payouts use the selected-count table and exact integer accounting", () => {
  assert.equal(KENO_PAYTABLE_MICROS.medium[1][1], 3_959_999);
  assert.deepEqual(kenoPayout(100_000_000, 1, 1, "medium"), { multiplierMicros: 3_959_999, payoutUnits: 395_999_900, outcome: "win" });
  assert.deepEqual(kenoPayout(100_000_000, 5, 2, "medium"), { multiplierMicros: 0, payoutUnits: 0, outcome: "loss" });
  assert.ok(kenoMultiplierMicros(10, 10, "extreme") > kenoMultiplierMicros(10, 10, "easy"));
  assert.throws(() => kenoMultiplierMicros(11, 1), /between 1 and 10/);
  assert.throws(() => kenoMultiplierMicros(5, 2, "impossible"), /valid Keno risk/);
});

test("Keno payouts follow the configured live house edge", () => {
  const defaultMultiplier = kenoMultiplierMicros(5, 5, "medium");
  const configuredMultiplier = kenoMultiplierMicros(5, 5, "medium", 950_000);
  assert.equal(configuredMultiplier, Math.floor(defaultMultiplier * 950_000 / 990_000));
  assert.ok(configuredMultiplier < defaultMultiplier);
  assert.equal(kenoPayout(100_000_000, 5, 5, "medium", 950_000).multiplierMicros, configuredMultiplier);
});
