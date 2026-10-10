import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createIpnSignature,
  createRawHmacSignature,
  assetUnitsToString,
  maskAddress,
  normalizeAddress,
  normalizeCurrency,
  normalizeRequestId,
  parseAssetUnits,
  parseNonNegativeAssetUnits,
  providerAmountToUnits,
  parseUsdCents,
  paymentCanCredit,
  oxaDepositStatus,
  oxaPayoutStatus,
  signaturesMatch,
  sortObject,
} from "../src/core.js";

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
