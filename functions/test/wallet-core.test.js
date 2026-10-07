"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createIpnSignature,
  normalizeAddress,
  normalizeCurrency,
  parseUsdCents,
  paymentCanCredit,
  signaturesMatch,
  sortObject,
} = require("../wallet-core");

test("sortObject recursively sorts keys without reordering arrays", () => {
  assert.deepEqual(sortObject({ z: 1, a: { y: 2, b: 3 }, list: [{ z: 1, a: 2 }] }), {
    a: { b: 3, y: 2 },
    list: [{ a: 2, z: 1 }],
    z: 1,
  });
});

test("IPN signatures use stable alphabetical JSON", () => {
  const first = createIpnSignature({ payment_status: "finished", payment_id: 42 }, "secret");
  const second = createIpnSignature({ payment_id: 42, payment_status: "finished" }, "secret");
  assert.equal(first, second);
  assert.equal(signaturesMatch(first.toUpperCase(), second), true);
  assert.equal(signaturesMatch("bad", second), false);
});

test("USD amounts are converted to integer cents and bounded", () => {
  assert.equal(parseUsdCents("10.25", { minimumUsdCents: 100, maximumUsdCents: 2000 }), 1025);
  assert.throws(() => parseUsdCents("0.99", { minimumUsdCents: 100 }), /minimum/i);
  assert.throws(() => parseUsdCents("20.01", { maximumUsdCents: 2000 }), /maximum/i);
});

test("currency and address inputs are normalized", () => {
  assert.equal(normalizeCurrency(" USDTTRC20 "), "usdttrc20");
  assert.equal(normalizeAddress(" 0x1234567890abcdef "), "0x1234567890abcdef");
  assert.throws(() => normalizeCurrency("btc<script>"));
  assert.throws(() => normalizeAddress("short"));
});

test("only a finished NOWPayments payment can credit a wallet", () => {
  for (const status of ["waiting", "confirming", "confirmed", "sending", "partially_paid", "failed", "expired"]) {
    assert.equal(paymentCanCredit(status), false);
  }
  assert.equal(paymentCanCredit("finished"), true);
});
