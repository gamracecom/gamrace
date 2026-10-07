import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createIpnSignature,
  maskAddress,
  normalizeAddress,
  normalizeCurrency,
  normalizeRequestId,
  parseUsdCents,
  paymentCanCredit,
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
