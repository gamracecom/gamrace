"use strict";

const crypto = require("node:crypto");

const DEFAULT_LIMITS = Object.freeze({
  minimumDepositUsdCents: 100,
  maximumDepositUsdCents: 10_000_000,
  minimumWithdrawalUsdCents: 1_000,
  maximumWithdrawalUsdCents: 10_000_000,
});

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
}

function createIpnSignature(payload, secret) {
  if (!secret) throw new Error("IPN secret is required");
  const canonicalPayload = JSON.stringify(sortObject(payload));
  return crypto.createHmac("sha512", secret).update(canonicalPayload).digest("hex");
}

function signaturesMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(received.trim().toLowerCase(), "utf8");
  const right = Buffer.from(expected.trim().toLowerCase(), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseUsdCents(value, limits = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Enter a valid amount");
  const cents = Math.round(amount * 100);
  const minimum = limits.minimumUsdCents ?? 1;
  const maximum = limits.maximumUsdCents ?? Number.MAX_SAFE_INTEGER;
  if (cents < minimum) throw new Error(`The minimum amount is $${(minimum / 100).toFixed(2)}`);
  if (cents > maximum) throw new Error(`The maximum amount is $${(maximum / 100).toFixed(2)}`);
  return cents;
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,20}$/.test(currency)) throw new Error("Choose a valid currency");
  return currency;
}

function normalizeAddress(value) {
  const address = String(value || "").trim();
  if (address.length < 10 || address.length > 256 || /\s/.test(address)) {
    throw new Error("Enter a valid wallet address");
  }
  return address;
}

function normalizeExtraId(value) {
  const extraId = String(value || "").trim();
  if (extraId.length > 128) throw new Error("Memo or tag is too long");
  return extraId;
}

function paymentCanCredit(status) {
  return String(status || "").toLowerCase() === "finished";
}

function paymentIsTerminal(status) {
  return ["finished", "failed", "refunded", "expired"].includes(String(status || "").toLowerCase());
}

module.exports = {
  DEFAULT_LIMITS,
  createIpnSignature,
  normalizeAddress,
  normalizeCurrency,
  normalizeExtraId,
  parseUsdCents,
  paymentCanCredit,
  paymentIsTerminal,
  signaturesMatch,
  sortObject,
};
