import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  blackjackHandValue,
  blackjackSideBetResults,
  createIpnSignature,
  createRawHmacSignature,
  crashDurationMs,
  crashMultiplierMicros,
  crashPointMicros,
  dicePayout,
  assetUnitsToString,
  maskAddress,
  normalizeAddress,
  normalizeCurrency,
  normalizeRequestId,
  minesMultiplierMicros,
  parseAssetUnits,
  parseNonNegativeAssetUnits,
  providerAmountToUnits,
  parseUsdCents,
  paymentCanCredit,
  plinkoMultipliers,
  plinkoPayout,
  roulettePayout,
  STACK_LEVELS,
  STACK_SUCCESS_MICROS,
  stackMultiplierMicros,
  wheelMultipliers,
  wheelPayout,
  payoutFromMultiplier,
  oxaDepositStatus,
  oxaPayoutStatus,
  signaturesMatch,
  sortObject,
} from "../src/core.js";

test("Blackjack values aces, naturals, face cards and busts correctly", () => {
  assert.deepEqual(blackjackHandValue([0, 9]), { total: 21, soft: true, blackjack: true, bust: false });
  assert.deepEqual(blackjackHandValue([0, 13, 8, 9]), { total: 21, soft: false, blackjack: false, bust: false });
  assert.deepEqual(blackjackHandValue([9, 10, 4]), { total: 25, soft: false, blackjack: false, bust: true });
  assert.deepEqual(blackjackHandValue([0, 13, 26, 39]), { total: 14, soft: true, blackjack: false, bust: false });
});

test("Blackjack side bets classify Perfect Pairs and 21+3 hands", () => {
  assert.deepEqual(blackjackSideBetResults([5, 57], 32), {
    perfectPairs: { result: "perfect-pair", multiplierMicros: 26_000_000 },
    twentyOnePlusThree: { result: "none", multiplierMicros: 0 },
  });
  assert.equal(blackjackSideBetResults([1, 40], 53).perfectPairs.result, "coloured-pair");
  assert.equal(blackjackSideBetResults([1, 14], 27).perfectPairs.result, "mixed-pair");
  assert.deepEqual(blackjackSideBetResults([0, 11], 12).twentyOnePlusThree, { result: "straight-flush", multiplierMicros: 41_000_000 });
  assert.deepEqual(blackjackSideBetResults([8, 21], 34).twentyOnePlusThree, { result: "three-of-a-kind", multiplierMicros: 31_000_000 });
  assert.deepEqual(blackjackSideBetResults([2, 3], 4).twentyOnePlusThree, { result: "straight-flush", multiplierMicros: 41_000_000 });
});

test("IPN signing recursively sorts object keys", async () => {
  const payload = { z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] };
  const canonical = JSON.stringify(sortObject(payload));
  const expected = createHmac("sha512", "secret").update(canonical).digest("hex");
  assert.equal(await createIpnSignature(payload, "secret"), expected);
  assert.equal(signaturesMatch(expected.toUpperCase(), expected), true);
  assert.equal(signaturesMatch(`${expected}0`, expected), false);
});

test("OxaPay signatures cover the exact raw webhook body", async () => {
  const raw = '{"track_id":"123","status":"Paid"}';
  const expected = createHmac("sha512", "merchant-key").update(raw).digest("hex");
  assert.equal(await createRawHmacSignature(raw, "merchant-key"), expected);
});

test("USD parsing enforces exact cent limits", () => {
  assert.equal(parseUsdCents("10.005", { minimumUsdCents: 100, maximumUsdCents: 2000 }), 1001);
  assert.throws(() => parseUsdCents("0.99", { minimumUsdCents: 100 }), /minimum/);
  assert.throws(() => parseUsdCents("20.01", { maximumUsdCents: 2000 }), /maximum/);
});

test("identifiers, currencies and wallet addresses are normalized", () => {
  assert.equal(normalizeRequestId("abcDEF123456"), "abcDEF123456");
  assert.equal(normalizeCurrency(" USDTTRC20 "), "usdttrc20");
  assert.equal(normalizeAddress("  TExampleWalletAddress123456  "), "TExampleWalletAddress123456");
  assert.throws(() => normalizeRequestId("short"));
  assert.throws(() => normalizeAddress("bad address"));
});

test("only finished deposits are creditable", () => {
  assert.equal(paymentCanCredit("finished"), true);
  assert.equal(paymentCanCredit("confirmed"), false);
  assert.equal(maskAddress("TExampleWalletAddress123456"), "TExampl…123456");
});

test("OxaPay statuses settle only confirmed provider events", () => {
  assert.equal(oxaDepositStatus("Paid", "confirmed"), "finished");
  assert.equal(oxaDepositStatus("Paying", "confirming"), "confirming");
  assert.equal(oxaPayoutStatus("Confirmed"), "finished");
  assert.equal(oxaPayoutStatus("Confirming"), "processing");
  assert.equal(oxaPayoutStatus("Rejected"), "rejected");
});

test("asset balances use exact eight-decimal integer units", () => {
  assert.equal(parseAssetUnits("1"), 100_000_000);
  assert.equal(parseAssetUnits("0.00000001"), 1);
  assert.equal(parseAssetUnits("12.34567890"), 1_234_567_890);
  assert.equal(assetUnitsToString(1_234_567_890), "12.3456789");
  assert.equal(assetUnitsToString(0, false), "0.00000000");
  assert.throws(() => parseAssetUnits("0.000000001"), /8 decimal/);
  assert.throws(() => parseAssetUnits("-1"), /valid amount/);
  assert.equal(providerAmountToUnits("0.123456789"), 12_345_678);
  assert.equal(parseNonNegativeAssetUnits("0"), 0);
  assert.equal(parseNonNegativeAssetUnits("125.50000000"), 12_550_000_000);
  assert.throws(() => parseNonNegativeAssetUnits("-0.01"), /valid amount/);
});

test("server game math settles exact wallet units", () => {
  const win = dicePayout(100_000_000, 5050, "over", 7500);
  assert.equal(win.won, true);
  assert.equal(win.multiplierMicros, 2_000_000);
  assert.equal(win.payoutUnits, 200_000_000);
  const loss = dicePayout(100_000_000, 5050, "over", 1000);
  assert.equal(loss.won, false);
  assert.equal(loss.payoutUnits, 0);
  assert.equal(dicePayout(100_000_000, 5050, "over", 10_000).won, true);
  const minesMultiplier = minesMultiplierMicros(3, 1);
  assert.equal(minesMultiplier, 1_125_000);
  assert.equal(payoutFromMultiplier(100_000_000, minesMultiplier), 112_500_000);
});

test("Crash points and time curves are bounded and inverse", () => {
  assert.equal(crashPointMicros(1_000_000, 990_000), 1_000_000);
  assert.equal(crashPointMicros(500_000, 990_000), 1_980_000);
  assert.equal(crashPointMicros(1, 990_000), 1_000_000_000);
  assert.equal(crashMultiplierMicros(0), 1_000_000);
  assert.equal(crashMultiplierMicros(80_000), 1_000_000_000);
  assert.ok(crashDurationMs(2_000_000) > 7_900 && crashDurationMs(2_000_000) < 8_100);
  assert.ok(crashDurationMs(10_000_000) > 26_500);
  const point = 12_340_000;
  assert.ok(Math.abs(crashMultiplierMicros(crashDurationMs(point)) - point) < 20_000);
  assert.throws(() => crashPointMicros(0));
});

test("Plinko paytables are symmetric and preserve a 99% expected return", () => {
  for (const risk of ["low", "medium", "high"]) {
    for (const rows of [8, 12, 16]) {
      const multipliers = plinkoMultipliers(rows, risk);
      assert.equal(multipliers.length, rows + 1);
      assert.deepEqual(multipliers, [...multipliers].reverse());
      let expectedMicros = 0;
      const choose = (n, k) => {
        let result = 1;
        for (let index = 1; index <= k; index += 1) result = result * (n - k + index) / index;
        return result;
      };
      multipliers.forEach((multiplier, bucket) => { expectedMicros += choose(rows, bucket) / 2 ** rows * multiplier; });
      assert.ok(Math.abs(expectedMicros / 1_000_000 - 0.99) < 0.00001);
    }
  }
  const settlement = plinkoPayout(100_000_000, 8, "high", 0);
  assert.equal(settlement.outcome, "win");
  assert.ok(settlement.payoutUnits > 100_000_000);
});

test("Plinko paytables follow the configured live house edge", () => {
  const multipliers = plinkoMultipliers(12, "medium", 950_000);
  const choose = (n, k) => {
    let result = 1;
    for (let index = 1; index <= k; index += 1) result = result * (n - k + index) / index;
    return result;
  };
  const expectedReturn = multipliers.reduce((total, multiplier, bucket) => total + choose(12, bucket) / 2 ** 12 * multiplier, 0) / 1_000_000;
  assert.ok(Math.abs(expectedReturn - 0.95) < 0.00001);
  assert.ok(plinkoPayout(100_000_000, 12, "medium", 0, 950_000).multiplierMicros < plinkoPayout(100_000_000, 12, "medium", 0).multiplierMicros);
});

test("Wheel paytables preserve 99% RTP at every risk and segment count", () => {
  for (const risk of ["low", "medium", "high"]) {
    for (const segments of [10, 20, 30, 40, 50]) {
      const multipliers = wheelMultipliers(segments, risk);
      assert.equal(multipliers.length, segments);
      const expectedReturn = multipliers.reduce((total, multiplier) => total + multiplier, 0) / segments / 1_000_000;
      assert.ok(Math.abs(expectedReturn - 0.99) < 0.000001, `${risk} ${segments} RTP`);
    }
  }
  assert.equal(Math.max(...wheelMultipliers(50, "high")), 49_500_000);
  assert.deepEqual(wheelPayout(100_000_000, 10, "low", 0), {
    multiplierMicros: 1_080_000,
    payoutUnits: 108_000_000,
    outcome: "win",
  });
  assert.equal(wheelPayout(100_000_000, 20, "medium", 1).payoutUnits, 0);
});

test("Stack multipliers preserve the configured return across all 24 levels", () => {
  for (const difficulty of Object.keys(STACK_SUCCESS_MICROS)) {
    for (const level of [1, 6, 12, STACK_LEVELS]) {
      const multiplier = stackMultiplierMicros(difficulty, level, 990_000) / 1_000_000;
      const survival = (STACK_SUCCESS_MICROS[difficulty] / 1_000_000) ** level;
      const expectedReturn = Math.min(1_000_000, multiplier) * survival;
      assert.ok(Math.abs(expectedReturn - 0.99) < 0.00001 || multiplier === 1_000_000, `${difficulty} level ${level}`);
    }
  }
  assert.ok(stackMultiplierMicros("extreme", 12) > stackMultiplierMicros("hard", 12));
  assert.ok(stackMultiplierMicros("hard", 12) > stackMultiplierMicros("medium", 12));
  assert.throws(() => stackMultiplierMicros("skill", 1), /difficulty/);
});

test("Roulette settles multiple lane bets against one authoritative result", () => {
  const blue = roulettePayout({ blue: 100_000_000 }, "blue");
  assert.equal(blue.payoutUnits, 200_000_000);
  assert.equal(blue.totalWagerUnits, 100_000_000);
  assert.equal(blue.multiplierMicros, 2_000_000);
  assert.equal(roulettePayout({ purple: 100_000_000 }, "purple").payoutUnits, 700_000_000);
  assert.equal(roulettePayout({ gold: 100_000_000 }, "gold").payoutUnits, 1_400_000_000);
  const hedged = roulettePayout({ blue: 100_000_000, cyan: 100_000_000 }, "blue");
  assert.equal(hedged.totalWagerUnits, 200_000_000);
  assert.equal(hedged.payoutUnits, 200_000_000);
  assert.equal(hedged.multiplierMicros, 1_000_000);
  assert.throws(() => roulettePayout({ invalid: 100_000_000 }, "blue"), /selection/);
});
