const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

async function sessionSignature(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`gamrace-admin-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function verifyAdminPassword(candidate, configuredPassword) {
  if (typeof candidate !== "string" || typeof configuredPassword !== "string") return false;
  if (!candidate || candidate.length > 256 || !configuredPassword) return false;
  const [candidateDigest, configuredDigest] = await Promise.all([sha256(candidate), sha256(configuredPassword)]);
  return constantTimeEqual(candidateDigest, configuredDigest);
}

export async function createAdminSessionToken({
  uid,
  secret,
  nowMs = Date.now(),
  ttlMs = 4 * 60 * 60 * 1000,
  version = "1",
} = {}) {
  if (!uid || !secret) throw new Error("Admin session configuration is incomplete");
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const body = {
    sub: String(uid),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000),
    ver: String(version),
    nonce: toBase64Url(nonce),
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(body)));
  const signature = toBase64Url(await sessionSignature(payload, secret));
  return { token: `${payload}.${signature}`, expiresAt: new Date(body.exp * 1000).toISOString() };
}

export async function verifyAdminSessionToken(token, {
  uid,
  secret,
  nowMs = Date.now(),
  version = "1",
} = {}) {
  if (!uid || !secret || typeof token !== "string") return null;
  const pieces = token.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
  let payload;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(pieces[0])));
  } catch {
    return null;
  }
  const currentSeconds = Math.floor(nowMs / 1000);
  if (
    payload?.sub !== String(uid)
    || payload?.ver !== String(version)
    || !Number.isFinite(payload?.iat)
    || !Number.isFinite(payload?.exp)
    || payload.iat > currentSeconds + 60
    || payload.exp <= currentSeconds
    || payload.exp - payload.iat > 24 * 60 * 60
    || typeof payload.nonce !== "string"
  ) return null;
  let received;
  try {
    received = fromBase64Url(pieces[1]);
  } catch {
    return null;
  }
  const expected = await sessionSignature(pieces[0], secret);
  return constantTimeEqual(received, expected) ? payload : null;
}

