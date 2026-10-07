export const DEFAULT_LIMITS = Object.freeze({
  minimumDepositUsdCents: 100,
  maximumDepositUsdCents: 10_000_000,
  minimumWithdrawalUsdCents: 1_000,
  maximumWithdrawalUsdCents: 10_000_000,
});

export function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createIpnSignature(payload, secret) {
  if (!secret) throw new Error("IPN secret is required");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const canonicalPayload = JSON.stringify(sortObject(payload));
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalPayload)));
}

export function signaturesMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const left = received.trim().toLowerCase();
  const right = expected.trim().toLowerCase();
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function parseUsdCents(value, limits = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Enter a valid amount");
  const cents = Math.round(amount * 100);
  const minimum = limits.minimumUsdCents ?? 1;
  const maximum = limits.maximumUsdCents ?? Number.MAX_SAFE_INTEGER;
  if (cents < minimum) throw new Error(`The minimum amount is $${(minimum / 100).toFixed(2)}`);
  if (cents > maximum) throw new Error(`The maximum amount is $${(maximum / 100).toFixed(2)}`);
  return cents;
}

export function normalizeCurrency(value) {
  const currency = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,20}$/.test(currency)) throw new Error("Choose a valid currency");
  return currency;
}

export function normalizeAddress(value) {
  const address = String(value || "").trim();
  if (address.length < 10 || address.length > 256 || /\s/.test(address)) throw new Error("Enter a valid wallet address");
  return address;
}

export function normalizeExtraId(value) {
  const extraId = String(value || "").trim();
  if (extraId.length > 128) throw new Error("Memo or tag is too long");
  return extraId;
}

export function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new Error("Invalid request identifier");
  return requestId;
}

export function maskAddress(value) {
  const address = String(value || "");
  if (address.length < 14) return address;
  return `${address.slice(0, 7)}…${address.slice(-6)}`;
}

export function paymentCanCredit(status) {
  return String(status || "").toLowerCase() === "finished";
}

export function paymentIsTerminal(status) {
  return ["finished", "failed", "refunded", "expired"].includes(String(status || "").toLowerCase());
}
