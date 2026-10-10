import {
  assetUnitsToString,
  createRawHmacSignature,
  maskAddress,
  normalizeAddress,
  normalizeCurrency,
  normalizeExtraId,
  normalizeRequestId,
  parseAssetUnits,
  oxaDepositStatus,
  oxaPayoutStatus,
  providerAmountToUnits,
  signaturesMatch,
} from "./core.js";
import { DEFAULT_WALLET_ASSET, WALLET_ASSETS, getWalletAsset, getWalletAssetByProvider, requireWalletAsset } from "./assets.js";
import { createAdminSessionToken, verifyAdminPassword, verifyAdminSessionToken } from "./admin-auth.js";

let firebaseKeys;
let firebaseKeysExpiresAt = 0;
let currencyCache;
let currencyCacheExpiresAt = 0;
let priceCache;
let priceCacheExpiresAt = 0;

function httpError(status, message, code = "REQUEST_FAILED") {
  return Object.assign(new Error(message), { httpStatus: status, code });
}

function now() {
  return Date.now();
}

function envNumber(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "https://gamrace.com,https://www.gamrace.com").split(",").map((value) => value.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id, X-Admin-Session, X-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && allowedOrigins(env).has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

async function requestJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 65_536) throw httpError(413, "Request is too large");
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Request body must be valid JSON");
  }
}

function base64UrlBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function getFirebaseKeys() {
  if (firebaseKeys && firebaseKeysExpiresAt > now() + 60_000) return firebaseKeys;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw httpError(503, "Authentication service is unavailable");
  const body = await response.json();
  firebaseKeys = Array.isArray(body.keys) ? body.keys : [];
  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  firebaseKeysExpiresAt = now() + maxAge * 1000;
  return firebaseKeys;
}

async function verifyFirebaseToken(token, projectId) {
  const pieces = String(token || "").split(".");
  if (pieces.length !== 3) throw httpError(401, "Your session has expired. Sign in again.");
  let header;
  let payload;
  try {
    header = decodeJwtPart(pieces[0]);
    payload = decodeJwtPart(pieces[1]);
  } catch {
    throw httpError(401, "Your session has expired. Sign in again.");
  }
  if (header.alg !== "RS256" || !header.kid) throw httpError(401, "Your session has expired. Sign in again.");
  const keyData = (await getFirebaseKeys()).find((candidate) => candidate.kid === header.kid);
  if (!keyData) {
    firebaseKeysExpiresAt = 0;
    const refreshed = (await getFirebaseKeys()).find((candidate) => candidate.kid === header.kid);
    if (!refreshed) throw httpError(401, "Your session has expired. Sign in again.");
    return verifyFirebaseTokenWithKey(pieces, payload, refreshed, projectId);
  }
  return verifyFirebaseTokenWithKey(pieces, payload, keyData, projectId);
}

async function verifyFirebaseTokenWithKey(pieces, payload, keyData, projectId) {
  const currentSeconds = Math.floor(now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw httpError(401, "Your session has expired. Sign in again.");
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) throw httpError(401, "Your session has expired. Sign in again.");
  if (!Number.isFinite(payload.exp) || payload.exp <= currentSeconds || !Number.isFinite(payload.iat) || payload.iat > currentSeconds + 60) {
    throw httpError(401, "Your session has expired. Sign in again.");
  }
  const key = await crypto.subtle.importKey("jwk", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(pieces[2]),
    new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
  );
  if (!verified) throw httpError(401, "Your session has expired. Sign in again.");
  return payload;
}

async function requireUser(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Sign in to use the wallet");
  return verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID || "gamrace");
}

function requestGeo(request) {
  const cf = request.cf || {};
  return {
    countryCode: String(cf.country || request.headers.get("CF-IPCountry") || "XX").toUpperCase().slice(0, 2),
    region: String(cf.region || "").slice(0, 120),
    city: String(cf.city || "").slice(0, 120),
    timezone: String(cf.timezone || "").slice(0, 80),
  };
}

function maskedIp(request) {
  const value = String(request.headers.get("CF-Connecting-IP") || "").trim();
  if (!value) return "Unavailable";
  if (value.includes(".")) {
    const pieces = value.split(".");
    return pieces.length === 4 ? `${pieces[0]}.${pieces[1]}.${pieces[2]}.xxx` : "Hidden";
  }
  if (value.includes(":")) return `${value.split(":").filter(Boolean).slice(0, 3).join(":")}::`;
  return "Hidden";
}

function clientDetails(request) {
  const agent = String(request.headers.get("User-Agent") || "");
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other browser";
  const operatingSystem = /Windows NT/.test(agent) ? "Windows" : /iPhone|iPad/.test(agent) ? "iOS / iPadOS" : /Android/.test(agent) ? "Android" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "Unknown OS";
  const device = /iPad|Tablet/.test(agent) ? "Tablet" : /Mobi|iPhone|Android/.test(agent) ? "Mobile device" : "Desktop computer";
  return { browser, operatingSystem, device };
}

async function countryAccess(env, countryCode) {
  const normalized = /^[A-Z]{2}$/.test(countryCode) ? countryCode : "XX";
  if (normalized === "XX") return { allowed: true, countryCode: normalized };
  const row = await env.DB.prepare("SELECT allowed FROM country_access WHERE country_code = ?").bind(normalized).first();
  return { allowed: row ? Boolean(row.allowed) : true, countryCode: normalized };
}

async function requireAllowedRegion(request, env) {
  const geo = requestGeo(request);
  const access = await countryAccess(env, geo.countryCode);
  if (!access.allowed) throw httpError(451, "GamRace is not available in your region. If you are using a VPN or proxy, try disabling it and refresh.", "REGION_BLOCKED");
  return geo;
}

async function touchUserSession(request, env, user, geo = requestGeo(request)) {
  const sessionId = String(request.headers.get("X-Session-Id") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) return;
  const details = clientDetails(request);
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO user_sessions(uid, session_id, device, operating_system, browser, country_code, region, city, timezone, ip_masked, first_seen_at, last_seen_at, is_active)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(uid, session_id) DO UPDATE SET
      device = excluded.device, operating_system = excluded.operating_system, browser = excluded.browser,
      country_code = excluded.country_code, region = excluded.region, city = excluded.city,
      timezone = excluded.timezone, ip_masked = excluded.ip_masked, last_seen_at = excluded.last_seen_at, is_active = 1
  `).bind(user.sub, sessionId, details.device, details.operatingSystem, details.browser, geo.countryCode, geo.region, geo.city, geo.timezone, maskedIp(request), timestamp, timestamp).run();
}

async function handleRegionAccess(request, env) {
  const geo = requestGeo(request);
  const access = await countryAccess(env, geo.countryCode);
  return json(request, env, 200, { ...access, region: geo.region, city: geo.city, timezone: geo.timezone });
}

async function handleSessions(request, env, user) {
  const currentSessionId = String(request.headers.get("X-Session-Id") || "");
  const result = await env.DB.prepare(`
    SELECT session_id, device, operating_system, browser, country_code, region, city, timezone, ip_masked, first_seen_at, last_seen_at, is_active
    FROM user_sessions WHERE uid = ? ORDER BY last_seen_at DESC LIMIT 30
  `).bind(user.sub).all();
  return json(request, env, 200, {
    sessions: (result.results || []).map((row) => ({
      id: row.session_id,
      device: row.device,
      operatingSystem: row.operating_system,
      browser: row.browser,
      countryCode: row.country_code,
      region: row.region,
      city: row.city,
      timezone: row.timezone,
      ipAddress: row.ip_masked,
      firstLogin: new Date(Number(row.first_seen_at)).toISOString(),
      lastActive: new Date(Number(row.last_seen_at)).toISOString(),
      current: row.session_id === currentSessionId,
      active: Boolean(row.is_active),
    })),
  });
}

function requireOwner(user, env) {
  if (!env.OWNER_FIREBASE_UID) throw httpError(503, "Owner access has not been configured");
  if (user.sub !== env.OWNER_FIREBASE_UID) throw httpError(403, "Owner access is required");
}

function adminSessionSecret(env) {
  if (!env.ADMIN_PANEL_PASSWORD || String(env.ADMIN_PANEL_PASSWORD).length < 12) {
    throw httpError(503, "Admin password has not been configured", "ADMIN_NOT_CONFIGURED");
  }
  return env.ADMIN_PANEL_PASSWORD;
}

async function requireAdminSession(request, env, user) {
  requireOwner(user, env);
  const token = request.headers.get("X-Admin-Session") || "";
  const session = await verifyAdminSessionToken(token, {
    uid: user.sub,
    secret: adminSessionSecret(env),
    version: env.ADMIN_SESSION_VERSION || "1",
  });
  if (!session) throw httpError(401, "Your admin session has expired. Enter your admin password again.", "ADMIN_SESSION_EXPIRED");
  return session;
}

function sessionTtlMs(env) {
  const configuredMinutes = envNumber(env, "ADMIN_SESSION_TTL_MINUTES", 240);
  const minutes = Math.min(720, Math.max(15, configuredMinutes));
  return minutes * 60 * 1000;
}

async function writeAdminAudit(env, user, eventType, targetId = null, detail = null) {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_audit_log(id, uid, event_type, target_id, detail, created_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      user.sub,
      String(eventType).slice(0, 80),
      targetId ? String(targetId).slice(0, 160) : null,
      detail ? String(detail).slice(0, 500) : null,
      now(),
    ).run();
  } catch (error) {
    console.error("Admin audit write failed", { eventType, message: error?.message });
  }
}

async function handleCreateAdminSession(request, env, user) {
  requireOwner(user, env);
  const configuredPassword = adminSessionSecret(env);
  const attempt = await env.DB.prepare("SELECT failed_count, blocked_until FROM admin_login_attempts WHERE uid = ?").bind(user.sub).first();
  const timestamp = now();
  if (Number(attempt?.blocked_until || 0) > timestamp) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Number(attempt.blocked_until) - timestamp) / 1000));
    throw httpError(429, `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute${retryAfterSeconds > 60 ? "s" : ""}.`, "ADMIN_RATE_LIMITED");
  }
  const body = await requestJson(request);
  const valid = await verifyAdminPassword(body.password, configuredPassword);
  if (!valid) {
    const failedCount = Number(attempt?.failed_count || 0) + 1;
    const blockedUntil = failedCount >= 5 ? timestamp + 15 * 60 * 1000 : 0;
    await env.DB.prepare(`
      INSERT INTO admin_login_attempts(uid, failed_count, blocked_until, updated_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET failed_count = excluded.failed_count,
        blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
    `).bind(user.sub, failedCount >= 5 ? 0 : failedCount, blockedUntil, timestamp).run();
    await writeAdminAudit(env, user, "admin.login.failed");
    throw httpError(401, "That admin password is not correct", "ADMIN_PASSWORD_INVALID");
  }
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE uid = ?").bind(user.sub).run();
  const session = await createAdminSessionToken({
    uid: user.sub,
    secret: configuredPassword,
    ttlMs: sessionTtlMs(env),
    version: env.ADMIN_SESSION_VERSION || "1",
  });
  await writeAdminAudit(env, user, "admin.login.succeeded");
  return json(request, env, 201, {
    session,
    owner: { uid: user.sub, email: user.email || null, name: user.name || user.email || "Owner" },
  });
}

async function handleGetAdminSession(request, env, user) {
  const session = await requireAdminSession(request, env, user);
  return json(request, env, 200, {
    valid: true,
    expiresAt: new Date(session.exp * 1000).toISOString(),
    owner: { uid: user.sub, email: user.email || null, name: user.name || user.email || "Owner" },
  });
}

function handleAdminAccess(request, env, user) {
  requireOwner(user, env);
  return json(request, env, 200, { owner: true });
}

async function oxaPay(env, path, options = {}) {
  const auth = options.auth || "none";
  const secret = auth === "merchant" ? env.OXAPAY_MERCHANT_API_KEY : auth === "payout" ? env.OXAPAY_PAYOUT_API_KEY : null;
  if (auth !== "none" && !secret) throw httpError(503, auth === "merchant" ? "Wallet deposits are not configured yet" : "Wallet withdrawals are not configured yet");
  const url = new URL(`${String(env.OXAPAY_API_BASE || "https://api.oxapay.com/v1").replace(/\/$/, "")}${path}`);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(auth === "merchant" ? { merchant_api_key: secret } : {}),
      ...(auth === "payout" ? { payout_api_key: secret } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  const providerError = body?.error && typeof body.error === "object" ? body.error : {};
  if (!response.ok || Number(body?.status || response.status) >= 400 || providerError?.message) {
    const providerMessage = String(providerError?.message || body?.message || "").slice(0, 200);
    console.error("OxaPay request failed", {
      path,
      status: response.status,
      code: body?.code || body?.status,
      message: providerMessage,
    });
    const clientStatus = response.status === 429 ? 503 : response.status >= 500 ? 502 : 400;
    const error = httpError(clientStatus, "The payment service could not complete that request", "PROVIDER_ERROR");
    error.providerMessage = providerMessage;
    error.providerStatus = Number(body?.status || response.status);
    const retryAfter = Number(response.headers.get("Retry-After"));
    error.providerRetryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    throw error;
  }
  return body?.data ?? body;
}

async function providerCurrencies(env) {
  if (!currencyCache || currencyCacheExpiresAt < now()) {
    currencyCache = await oxaPay(env, "/common/currencies");
    currencyCacheExpiresAt = now() + 5 * 60 * 1000;
  }
  return currencyCache || {};
}

async function providerPrices(env) {
  if (!priceCache || priceCacheExpiresAt < now()) {
    priceCache = await oxaPay(env, "/common/prices");
    priceCacheExpiresAt = now() + 60 * 1000;
  }
  return priceCache || {};
}

function providerRules(currencies, asset) {
  const currency = currencies?.[asset.providerCurrency];
  const network = currency?.networks?.[asset.providerNetwork];
  if (!currency?.status || !network) return null;
  return network;
}

async function ensureWalletPreference(env, uid) {
  const timestamp = now();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO wallet_preferences(uid, selected_currency, updated_at)
    VALUES(?, ?, ?)
  `).bind(uid, DEFAULT_WALLET_ASSET, timestamp).run();
  return env.DB.prepare("SELECT selected_currency FROM wallet_preferences WHERE uid = ?").bind(uid).first();
}

async function walletResponse(env, uid) {
  const preference = await ensureWalletPreference(env, uid);
  const selectedCurrency = getWalletAsset(preference?.selected_currency)?.code || DEFAULT_WALLET_ASSET;
  const result = await env.DB.prepare(`
    SELECT currency, available_units, held_units, lifetime_deposited_units, lifetime_withdrawn_units
    FROM crypto_balances WHERE uid = ?
  `).bind(uid).all();
  const rows = new Map((result.results || []).map((row) => [row.currency, row]));
  const balances = WALLET_ASSETS.map((asset) => {
    const row = rows.get(asset.code) || {};
    return {
      ...asset,
      available: assetUnitsToString(Number(row.available_units || 0), false),
      held: assetUnitsToString(Number(row.held_units || 0), false),
      lifetimeDeposited: assetUnitsToString(Number(row.lifetime_deposited_units || 0), false),
      lifetimeWithdrawn: assetUnitsToString(Number(row.lifetime_withdrawn_units || 0), false),
    };
  });
  let prices = {};
  if (balances.some((balance) => Number(balance.available) > 0)) {
    try { prices = await providerPrices(env); } catch { prices = {}; }
  }
  const pricedBalances = balances.map((balance) => ({
    ...balance,
    usdCents: Math.max(0, Math.round(Number(balance.available) * Number(prices?.[balance.providerCurrency] || 0) * 100)),
  }));
  const selected = pricedBalances.find((balance) => balance.code === selectedCurrency) || pricedBalances[0];
  return { selectedCurrency, selectedUsdCents: selected?.usdCents || 0, balances: pricedBalances };
}

function depositResponse(row) {
  return {
    id: String(row.payment_id),
    status: row.status,
    requestedUsdCents: Number(row.requested_usd_cents),
    payAmount: String(row.pay_amount),
    minimumDepositAmount: String(row.pay_amount),
    payCurrency: row.pay_currency,
    payAddress: row.pay_address,
    payinExtraId: row.payin_extra_id || null,
    network: row.network || null,
    expiresAt: row.expires_at || null,
    credited: Boolean(row.credited),
    creditedAmount: assetUnitsToString(Number(row.credit_units || 0), false),
  };
}

function withdrawalResponse(row) {
  return {
    id: row.id,
    status: row.status,
    requestedAmount: assetUnitsToString(Number(row.requested_units), false),
    payoutAmount: String(row.payout_amount),
    payoutCurrency: row.payout_currency,
    address: row.masked_address,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function enforceCooldown(env, uid, action, seconds) {
  const timestamp = now();
  const result = await env.DB.prepare(`
    INSERT INTO wallet_rate_limits(uid, action, next_allowed_at, updated_at)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(uid, action) DO UPDATE SET
      next_allowed_at = excluded.next_allowed_at,
      updated_at = excluded.updated_at
    WHERE wallet_rate_limits.next_allowed_at <= excluded.updated_at
  `).bind(uid, action, timestamp + seconds * 1000, timestamp).run();
  if (Number(result.meta?.changes || 0) === 0) throw httpError(429, "Please wait a moment before trying again");
}

async function listActivity(env, uid) {
  const result = await env.DB.prepare(`
    SELECT payment_id AS id, 'deposit' AS type, status, pay_amount AS amount,
           pay_currency AS currency, created_at
    FROM crypto_deposits WHERE uid = ? AND status <> 'address_ready'
    UNION ALL
    SELECT id, 'withdrawal' AS type, status, payout_amount AS amount,
           payout_currency AS currency, created_at
    FROM crypto_withdrawals WHERE uid = ?
    ORDER BY created_at DESC LIMIT 30
  `).bind(uid, uid).all();
  return (result.results || []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    amount: String(row.amount || "0"),
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
}

async function handleGetWallet(request, env, user) {
  return json(request, env, 200, { wallet: await walletResponse(env, user.sub), activity: await listActivity(env, user.sub) });
}

async function handleCurrencies(request, env) {
  const provider = await providerCurrencies(env);
  return json(request, env, 200, {
    currencies: WALLET_ASSETS.flatMap((asset) => {
      const rules = providerRules(provider, asset);
      if (!rules) return [];
      return [{
        code: asset.code,
        symbol: asset.symbol,
        name: asset.name,
        network: asset.network,
        icon: asset.icon,
        requiresExtraId: Boolean(asset.requiresExtraId),
        minimumDeposit: String(rules.deposit_min ?? "0"),
        minimumWithdrawal: String(rules.withdraw_min ?? "0"),
        withdrawalFee: String(rules.withdraw_fee ?? "0"),
      }];
    }),
  });
}

async function handleSelectCurrency(request, env, user) {
  const body = await requestJson(request);
  const asset = requireWalletAsset(body.currency);
  await env.DB.prepare(`
    INSERT INTO wallet_preferences(uid, selected_currency, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET selected_currency = excluded.selected_currency, updated_at = excluded.updated_at
  `).bind(user.sub, asset.code, now()).run();
  return json(request, env, 200, { wallet: await walletResponse(env, user.sub) });
}

async function existingDepositForCurrency(env, uid, payCurrency) {
  return env.DB.prepare(`
    SELECT * FROM crypto_deposits
    WHERE uid = ? AND pay_currency = ? AND status = 'address_ready' AND pay_address <> ''
    ORDER BY created_at DESC LIMIT 1
  `).bind(uid, payCurrency).first();
}

async function handleDepositAddresses(request, env, user) {
  const result = await env.DB.prepare(`
    SELECT * FROM crypto_deposits AS deposit
    WHERE deposit.uid = ? AND deposit.status = 'address_ready' AND deposit.pay_address <> ''
      AND deposit.created_at = (
        SELECT MAX(candidate.created_at) FROM crypto_deposits AS candidate
        WHERE candidate.uid = deposit.uid AND candidate.pay_currency = deposit.pay_currency
          AND candidate.status = 'address_ready'
      )
    ORDER BY deposit.created_at DESC
  `).bind(user.sub).all();
  return json(request, env, 200, { deposits: (result.results || []).map(depositResponse) });
}

async function handleCreateDeposit(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const asset = requireWalletAsset(normalizeCurrency(body.payCurrency));
  const payCurrency = asset.code;
  await ensureWalletPreference(env, user.sub);

  // OxaPay static addresses are permanent for a player and network. Once saved,
  // the browser can show the address and QR instantly on every future visit.
  const savedAddress = await existingDepositForCurrency(env, user.sub, payCurrency);
  if (savedAddress) return json(request, env, 200, { deposit: depositResponse(savedAddress) });

  await enforceCooldown(env, user.sub, `deposit:${payCurrency}`, 3);
  const currencies = await providerCurrencies(env);
  const rules = providerRules(currencies, asset);
  if (!rules) throw httpError(409, "That currency and network are not currently available");
  const minimumDeposit = String(rules.deposit_min ?? "0");
  const prices = await providerPrices(env);
  const amountUsdCents = Math.max(1, Math.ceil(Number(minimumDeposit) * Number(prices?.[asset.providerCurrency] || 0) * 100));

  const timestamp = now();
  const internalRequestId = `oxa_${requestId}`;
  const requestKey = `oxa:${user.sub}:${requestId}`;
  const reserved = await env.DB.prepare(`
    INSERT OR IGNORE INTO crypto_deposit_requests(
      id, uid, request_id, status, requested_usd_cents, pay_currency, created_at, updated_at
    ) VALUES(?, ?, ?, 'creating', ?, ?, ?, ?)
  `).bind(requestKey, user.sub, internalRequestId, amountUsdCents, payCurrency, timestamp, timestamp).run();

  if (Number(reserved.meta?.changes || 0) === 0) {
    const requestRow = await env.DB.prepare("SELECT * FROM crypto_deposit_requests WHERE id = ?").bind(requestKey).first();
    if (requestRow?.payment_id) {
      const deposit = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(requestRow.payment_id).first();
      if (deposit) return json(request, env, 200, { deposit: depositResponse(deposit) });
    }
    throw httpError(409, "This deposit is already being created");
  }

  try {
    if (!env.PUBLIC_BASE_URL) throw httpError(503, "Wallet callback URL has not been configured");
    const orderId = `GRS-${requestId}`.slice(0, 64);
    const payment = await oxaPay(env, "/payment/static-address", {
      auth: "merchant",
      method: "POST",
      body: {
        network: asset.providerNetwork,
        auto_withdrawal: 0,
        order_id: orderId,
        description: `GamRace ${asset.symbol} deposit address`,
        callback_url: `${String(env.PUBLIC_BASE_URL).replace(/\/$/, "")}/webhooks/oxapay/deposit`,
      },
    });
    if (!payment.track_id || !payment.address) throw httpError(502, "The payment service returned incomplete deposit details");
    const paymentId = String(payment.track_id);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO crypto_deposits(
          payment_id, uid, request_id, order_id, status, requested_usd_cents,
          pay_amount, pay_currency, pay_address, payin_extra_id, network, expires_at,
          actually_paid, credit_units, credited, provider_created_at, provider_updated_at, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).bind(
        paymentId,
        user.sub,
        internalRequestId,
        orderId,
        "address_ready",
        amountUsdCents,
        minimumDeposit,
        payCurrency,
        String(payment.address),
        payment.memo || null,
        payment.network || asset.providerNetwork,
        null,
        "0",
        0,
        payment.date ? new Date(Number(payment.date) * 1000).toISOString() : null,
        null,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(`
        UPDATE crypto_deposit_requests
        SET status = 'created', payment_id = ?, requested_usd_cents = ?, updated_at = ?
        WHERE id = ?
      `).bind(paymentId, amountUsdCents, timestamp, requestKey),
    ]);
    const deposit = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(paymentId).first();
    return json(request, env, 201, { deposit: depositResponse(deposit) });
  } catch (error) {
    await env.DB.prepare(`
      UPDATE crypto_deposit_requests SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?
    `).bind(String(error?.code || "provider_error").slice(0, 80), now(), requestKey).run();
    throw error;
  }
}

function safeProviderId(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96);
}

async function applyOxaPayment(env, payment) {
  const trackId = safeProviderId(payment?.track_id);
  if (!trackId) throw httpError(400, "Payment identifier is missing");
  const address = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ? AND status = 'address_ready'").bind(trackId).first();
  if (!address) throw httpError(404, "Deposit address not found");
  if (payment.order_id && payment.order_id !== address.order_id) throw httpError(409, "Payment reference mismatch");
  const transactions = Array.isArray(payment.txs) ? payment.txs : [];
  const timestamp = now();

  for (const transaction of transactions) {
    const transactionHash = safeProviderId(transaction?.tx_hash);
    const asset = getWalletAssetByProvider(transaction?.currency || payment?.currency, transaction?.network || payment?.network);
    if (!transactionHash || !asset) continue;
    if (transaction.address && String(transaction.address).trim() !== String(address.pay_address).trim()) throw httpError(409, "Deposit address mismatch");
    const receivedAmount = String(transaction.received_amount ?? transaction.sent_amount ?? "0");
    const status = oxaDepositStatus(payment.status, transaction.status);
    const paymentId = `oxa_${trackId}_${transactionHash}`;
    const requestId = `oxa_tx_${transactionHash}`.slice(0, 120);
    const orderId = `GRX-${trackId}-${transactionHash}`.slice(0, 120);
    const transactionDate = Number(transaction.date || payment.date || 0);
    const createdAt = transactionDate > 0 ? transactionDate * 1000 : timestamp;
    const creditUnits = status === "finished" ? providerAmountToUnits(receivedAmount) : 0;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_deposits(
        payment_id, uid, request_id, order_id, status, requested_usd_cents,
        pay_amount, pay_currency, pay_address, payin_extra_id, network, expires_at,
        actually_paid, credit_units, credited, provider_created_at, provider_updated_at, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?)
    `).bind(
      paymentId,
      address.uid,
      requestId,
      orderId,
      status,
      Math.max(1, Number(address.requested_usd_cents || 1)),
      receivedAmount,
      asset.code,
      address.pay_address,
      address.payin_extra_id || null,
      transaction.network || asset.providerNetwork,
      receivedAmount,
      creditUnits,
      transactionDate > 0 ? new Date(createdAt).toISOString() : null,
      new Date(timestamp).toISOString(),
      createdAt,
      timestamp,
    ).run();
    const existing = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(paymentId).first();
    if (existing && !existing.credited) {
      await env.DB.prepare(`
        UPDATE crypto_deposits
        SET status = ?, actually_paid = ?, credit_units = ?, provider_updated_at = ?, updated_at = ?
        WHERE payment_id = ?
      `).bind(status, receivedAmount, creditUnits || Number(existing.credit_units || 0), new Date(timestamp).toISOString(), timestamp, paymentId).run();
    }
  }
  await env.DB.prepare("UPDATE crypto_deposits SET updated_at = ? WHERE payment_id = ?").bind(timestamp, trackId).run();
  return env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(trackId).first();
}

async function handleGetDeposit(request, env, user, paymentId) {
  let deposit = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ? AND uid = ?").bind(paymentId, user.sub).first();
  if (!deposit) throw httpError(404, "Deposit not found");
  if (deposit.status === "address_ready" && now() - Number(deposit.updated_at || 0) >= 60_000) {
    const payment = await oxaPay(env, `/payment/${encodeURIComponent(paymentId)}`, { auth: "merchant" });
    deposit = await applyOxaPayment(env, payment);
  }
  const latest = await env.DB.prepare(`
    SELECT * FROM crypto_deposits
    WHERE uid = ? AND pay_address = ? AND status <> 'address_ready'
    ORDER BY updated_at DESC LIMIT 1
  `).bind(user.sub, deposit.pay_address).first();
  const response = depositResponse(deposit);
  if (latest) {
    response.status = latest.status;
    response.credited = Boolean(latest.credited);
    response.creditedAmount = assetUnitsToString(Number(latest.credit_units || 0), false);
  }
  return json(request, env, 200, { deposit: response });
}

async function handleDepositWebhook(request, env) {
  if (!env.OXAPAY_MERCHANT_API_KEY) throw httpError(503, "Payment notifications are not configured");
  const rawBody = await request.text();
  let body;
  try { body = JSON.parse(rawBody); } catch { throw httpError(400, "Request body must be valid JSON"); }
  const received = request.headers.get("HMAC") || "";
  const expected = await createRawHmacSignature(rawBody, env.OXAPAY_MERCHANT_API_KEY);
  if (!signaturesMatch(received, expected)) throw httpError(401, "Invalid signature");
  if (String(body.type || "").toLowerCase() !== "static_address") throw httpError(400, "Invalid payment type");
  await applyOxaPayment(env, body);
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handleCreateWithdrawal(request, env, user) {
  await enforceCooldown(env, user.sub, "withdrawal", 5);
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const requestedUnits = parseAssetUnits(body.amount);
  const asset = requireWalletAsset(normalizeCurrency(body.payoutCurrency));
  const payoutCurrency = asset.code;
  const address = normalizeAddress(body.address);
  const extraId = normalizeExtraId(body.extraId);
  if (asset.requiresExtraId && !extraId) throw httpError(400, "Enter the destination tag for this withdrawal");
  const id = `${user.sub}_${requestId}`;
  const existing = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ? AND uid = ?").bind(id, user.sub).first();
  if (existing) return json(request, env, 200, { withdrawal: withdrawalResponse(existing) });

  const preference = await ensureWalletPreference(env, user.sub);
  if (preference.selected_currency !== payoutCurrency) throw httpError(409, "Withdraw from the balance currently selected in your wallet");
  const rules = providerRules(await providerCurrencies(env), asset);
  if (!rules) throw httpError(409, "That currency and network are not currently available");
  const minimumUnits = providerAmountToUnits(rules.withdraw_min);
  if (minimumUnits > 0 && requestedUnits < minimumUnits) throw httpError(400, `Minimum withdrawal is ${rules.withdraw_min} ${asset.symbol}`);
  const payoutAmount = assetUnitsToString(requestedUnits);

  const timestamp = now();
  try {
    await env.DB.prepare(`
      INSERT INTO crypto_withdrawals(
        id, uid, request_id, status, hold_state, requested_units, payout_amount,
        payout_currency, address, masked_address, extra_id, created_at, updated_at
      ) VALUES(?, ?, ?, 'pending_review', 'held', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      user.sub,
      requestId,
      requestedUnits,
      payoutAmount,
      payoutCurrency,
      address,
      maskAddress(address),
      extraId || null,
      timestamp,
      timestamp,
    ).run();
  } catch (error) {
    if (String(error?.message || error).includes("INSUFFICIENT_FUNDS")) throw httpError(409, "Your available balance is too low");
    const duplicate = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ? AND uid = ?").bind(id, user.sub).first();
    if (duplicate) return json(request, env, 200, { withdrawal: withdrawalResponse(duplicate) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ?").bind(id).first();
  return json(request, env, 201, { withdrawal: withdrawalResponse(created) });
}

async function handleGetWithdrawal(request, env, user, withdrawalId) {
  let withdrawal = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ? AND uid = ?").bind(withdrawalId, user.sub).first();
  if (!withdrawal) throw httpError(404, "Withdrawal not found");
  if (withdrawal.provider_reference && withdrawal.status === "processing") {
    try {
      withdrawal = await applyOxaPayout(env, await oxaPay(env, `/payout/${encodeURIComponent(withdrawal.provider_reference)}`, { auth: "payout" }));
    } catch (error) {
      console.error("OxaPay payout reconciliation failed", {
        withdrawalId: withdrawal.id,
        providerReference: withdrawal.provider_reference,
        message: String(error?.message || error),
      });
    }
  }
  return json(request, env, 200, { withdrawal: withdrawalResponse(withdrawal) });
}

async function applyOxaPayout(env, payout) {
  const trackId = safeProviderId(payout?.track_id);
  if (!trackId) throw httpError(400, "Payout identifier is missing");
  let withdrawal = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE provider_reference = ?").bind(trackId).first();
  if (!withdrawal && String(payout.description || "").startsWith("GamRace withdrawal ")) {
    const describedId = String(payout.description).slice("GamRace withdrawal ".length).trim();
    withdrawal = await env.DB.prepare(`
      SELECT * FROM crypto_withdrawals
      WHERE id = ? AND status IN ('submitting', 'submission_unknown', 'processing')
    `).bind(describedId).first();
    if (withdrawal) {
      await env.DB.prepare(`
        UPDATE crypto_withdrawals SET provider_reference = ?, updated_at = ?
        WHERE id = ? AND provider_reference IS NULL
      `).bind(trackId, now(), withdrawal.id).run();
      withdrawal.provider_reference = trackId;
    }
  }
  if (!withdrawal) throw httpError(404, "Withdrawal not found");
  const asset = getWalletAssetByProvider(payout.currency, payout.network);
  if (payout.currency && (!asset || asset.code !== withdrawal.payout_currency)) throw httpError(409, "Payout currency or network mismatch");
  if (payout.address && String(payout.address).trim() !== String(withdrawal.address).trim()) throw httpError(409, "Payout address mismatch");
  const providerUnits = providerAmountToUnits(payout.amount);
  if (providerUnits && providerUnits !== Number(withdrawal.requested_units)) throw httpError(409, "Payout amount mismatch");
  const status = oxaPayoutStatus(payout.status);
  await env.DB.prepare(`
    UPDATE crypto_withdrawals SET status = ?, updated_at = ?
    WHERE id = ? AND hold_state = 'held'
  `).bind(status, now(), withdrawal.id).run();
  return env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ?").bind(withdrawal.id).first();
}

async function handlePayoutWebhook(request, env) {
  if (!env.OXAPAY_PAYOUT_API_KEY) throw httpError(503, "Payout notifications are not configured");
  const rawBody = await request.text();
  let body;
  try { body = JSON.parse(rawBody); } catch { throw httpError(400, "Request body must be valid JSON"); }
  const received = request.headers.get("HMAC") || "";
  const expected = await createRawHmacSignature(rawBody, env.OXAPAY_PAYOUT_API_KEY);
  if (!signaturesMatch(received, expected)) throw httpError(401, "Invalid signature");
  if (String(body.type || "").toLowerCase() !== "payout") throw httpError(400, "Invalid payout type");
  await applyOxaPayout(env, body);
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function adminAssetAmount(row, field = "amount_units") {
  try {
    return assetUnitsToString(Number(row?.[field] || 0), false);
  } catch {
    return "0.00000000";
  }
}

async function handleAdminOverview(request, env, user) {
  await requireAdminSession(request, env, user);
  const timestamp = now();
  const dayStart = timestamp - 24 * 60 * 60 * 1000;
  const weekStart = timestamp - 7 * 24 * 60 * 60 * 1000;
  const [summary, balances, recent, daily] = await Promise.all([
    env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM wallet_preferences) AS total_users,
        (SELECT COUNT(*) FROM crypto_deposits WHERE credited = 1) AS completed_deposits,
        (SELECT COUNT(*) FROM crypto_deposits WHERE credited = 1 AND updated_at >= ?) AS deposits_24h,
        (SELECT COUNT(*) FROM crypto_withdrawals WHERE created_at >= ?) AS withdrawals_24h,
        (SELECT COUNT(*) FROM crypto_withdrawals WHERE status IN ('pending_review', 'submitting', 'submission_unknown', 'processing')) AS pending_withdrawals,
        (SELECT COUNT(*) FROM crypto_withdrawals WHERE status IN ('failed', 'rejected') AND updated_at >= ?) AS flagged_24h
    `).bind(dayStart, dayStart, dayStart).first(),
    env.DB.prepare(`
      SELECT currency,
             SUM(available_units) AS available_units,
             SUM(held_units) AS held_units,
             SUM(lifetime_deposited_units) AS deposited_units,
             COUNT(*) AS holders
      FROM crypto_balances
      GROUP BY currency
      ORDER BY deposited_units DESC, currency ASC
    `).all(),
    env.DB.prepare(`
      SELECT * FROM (
        SELECT 'deposit' AS type, payment_id AS id, uid, pay_currency AS currency,
               pay_amount AS amount, status, updated_at AS occurred_at
        FROM crypto_deposits WHERE status <> 'address_ready'
        UNION ALL
        SELECT 'withdrawal' AS type, id, uid, payout_currency AS currency,
               payout_amount AS amount, status, updated_at AS occurred_at
        FROM crypto_withdrawals
      ) activity
      ORDER BY occurred_at DESC LIMIT 12
    `).all(),
    env.DB.prepare(`
      SELECT day, SUM(deposit_count) AS deposits, SUM(withdrawal_count) AS withdrawals FROM (
        SELECT strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') AS day,
               COUNT(*) AS deposit_count, 0 AS withdrawal_count
        FROM crypto_deposits WHERE updated_at >= ? AND status <> 'address_ready' GROUP BY day
        UNION ALL
        SELECT strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') AS day,
               0 AS deposit_count, COUNT(*) AS withdrawal_count
        FROM crypto_withdrawals WHERE updated_at >= ? GROUP BY day
      ) GROUP BY day ORDER BY day ASC
    `).bind(weekStart, weekStart).all(),
  ]);
  return json(request, env, 200, {
    generatedAt: new Date(timestamp).toISOString(),
    summary: {
      totalUsers: Number(summary?.total_users || 0),
      completedDeposits: Number(summary?.completed_deposits || 0),
      deposits24h: Number(summary?.deposits_24h || 0),
      withdrawals24h: Number(summary?.withdrawals_24h || 0),
      pendingWithdrawals: Number(summary?.pending_withdrawals || 0),
      flagged24h: Number(summary?.flagged_24h || 0),
    },
    balances: (balances.results || []).map((row) => ({
      currency: row.currency,
      available: adminAssetAmount(row, "available_units"),
      held: adminAssetAmount(row, "held_units"),
      lifetimeDeposited: adminAssetAmount(row, "deposited_units"),
      holders: Number(row.holders || 0),
    })),
    recentActivity: (recent.results || []).map((row) => ({
      type: row.type,
      id: row.id,
      uid: row.uid,
      currency: row.currency,
      amount: String(row.amount || "0"),
      status: row.status,
      occurredAt: new Date(Number(row.occurred_at)).toISOString(),
    })),
    dailyActivity: (daily.results || []).map((row) => ({
      day: row.day,
      deposits: Number(row.deposits || 0),
      withdrawals: Number(row.withdrawals || 0),
    })),
  });
}

async function handleAdminUsers(request, env, user) {
  await requireAdminSession(request, env, user);
  const url = new URL(request.url);
  const query = String(url.searchParams.get("query") || "").trim().slice(0, 64);
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
  const result = query
    ? await env.DB.prepare(`
        SELECT p.uid, p.selected_currency, p.updated_at,
               COALESCE(SUM(b.available_units), 0) AS available_units,
               COALESCE(SUM(b.held_units), 0) AS held_units,
               COUNT(b.currency) AS asset_count,
               MAX(b.updated_at) AS balance_updated_at
        FROM wallet_preferences p LEFT JOIN crypto_balances b ON b.uid = p.uid
        WHERE p.uid LIKE ? GROUP BY p.uid ORDER BY COALESCE(MAX(b.updated_at), p.updated_at) DESC LIMIT ?
      `).bind(`%${query}%`, limit).all()
    : await env.DB.prepare(`
        SELECT p.uid, p.selected_currency, p.updated_at,
               COALESCE(SUM(b.available_units), 0) AS available_units,
               COALESCE(SUM(b.held_units), 0) AS held_units,
               COUNT(b.currency) AS asset_count,
               MAX(b.updated_at) AS balance_updated_at
        FROM wallet_preferences p LEFT JOIN crypto_balances b ON b.uid = p.uid
        GROUP BY p.uid ORDER BY COALESCE(MAX(b.updated_at), p.updated_at) DESC LIMIT ?
      `).bind(limit).all();
  return json(request, env, 200, {
    users: (result.results || []).map((row) => ({
      uid: row.uid,
      selectedCurrency: row.selected_currency,
      assetCount: Number(row.asset_count || 0),
      lastWalletActivity: new Date(Number(row.balance_updated_at || row.updated_at || 0)).toISOString(),
    })),
  });
}

async function handleAdminDeposits(request, env, user) {
  await requireAdminSession(request, env, user);
  const url = new URL(request.url);
  const allowedStatuses = new Set(["all", "waiting", "confirming", "confirmed", "sending", "finished", "failed", "refunded", "expired"]);
  const status = allowedStatuses.has(url.searchParams.get("status")) ? url.searchParams.get("status") : "all";
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
  const result = status === "all"
    ? await env.DB.prepare(`
        SELECT payment_id, uid, status, requested_usd_cents, pay_amount, pay_currency,
               network, credited, created_at, updated_at FROM crypto_deposits
        WHERE status <> 'address_ready' ORDER BY created_at DESC LIMIT ?
      `).bind(limit).all()
    : await env.DB.prepare(`
        SELECT payment_id, uid, status, requested_usd_cents, pay_amount, pay_currency,
               network, credited, created_at, updated_at FROM crypto_deposits
        WHERE status = ? ORDER BY created_at DESC LIMIT ?
      `).bind(status, limit).all();
  return json(request, env, 200, {
    deposits: (result.results || []).map((row) => ({
      id: row.payment_id,
      uid: row.uid,
      status: row.status,
      requestedUsdCents: Number(row.requested_usd_cents || 0),
      payAmount: String(row.pay_amount || "0"),
      payCurrency: row.pay_currency,
      network: row.network || null,
      credited: Boolean(row.credited),
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
    })),
  });
}

async function handleAdminAudit(request, env, user) {
  await requireAdminSession(request, env, user);
  const result = await env.DB.prepare(`
    SELECT id, uid, event_type, target_id, detail, created_at
    FROM admin_audit_log ORDER BY created_at DESC LIMIT 100
  `).all();
  return json(request, env, 200, {
    events: (result.results || []).map((row) => ({
      id: row.id,
      uid: row.uid,
      type: row.event_type,
      targetId: row.target_id || null,
      detail: row.detail || null,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    })),
  });
}

async function handleAdminSystem(request, env, user) {
  const session = await requireAdminSession(request, env, user);
  return json(request, env, 200, {
    environment: "production",
    walletMode: "live",
    sessionExpiresAt: new Date(session.exp * 1000).toISOString(),
    services: [
      { id: "identity", label: "Firebase identity", status: env.FIREBASE_PROJECT_ID ? "operational" : "attention" },
      { id: "database", label: "Wallet database", status: env.DB ? "operational" : "attention" },
      { id: "payments", label: "OxaPay deposits", status: env.OXAPAY_MERCHANT_API_KEY ? "operational" : "paused" },
      { id: "payouts", label: "OxaPay payouts", status: env.OXAPAY_PAYOUT_API_KEY ? "operational" : "paused" },
      { id: "owner", label: "Owner access", status: env.OWNER_FIREBASE_UID ? "operational" : "attention" },
      { id: "admin-password", label: "Admin password", status: env.ADMIN_PANEL_PASSWORD ? "operational" : "attention" },
    ],
    capabilities: {
      deposits: Boolean(env.OXAPAY_MERCHANT_API_KEY),
      withdrawals: Boolean(env.OXAPAY_PAYOUT_API_KEY),
      withdrawalReview: true,
      multiAssetBalances: true,
      playerProfiles: false,
      gameManagement: false,
      promotions: false,
    },
  });
}

async function handleAdminWithdrawals(request, env, user) {
  await requireAdminSession(request, env, user);
  const result = await env.DB.prepare(`
    SELECT id, uid, status, hold_state, requested_units, payout_amount, payout_currency,
           address, extra_id, provider_reference, review_note, created_at, updated_at
    FROM crypto_withdrawals
    WHERE status IN ('pending_review', 'submitting', 'submission_unknown', 'processing')
    ORDER BY created_at ASC LIMIT 100
  `).all();
  return json(request, env, 200, {
    withdrawals: (result.results || []).map((row) => ({
      id: row.id,
      uid: row.uid,
      status: row.status,
      holdState: row.hold_state,
      requestedAmount: assetUnitsToString(Number(row.requested_units), false),
      payoutAmount: String(row.payout_amount),
      payoutCurrency: row.payout_currency,
      address: row.address,
      extraId: row.extra_id || null,
      providerReference: row.provider_reference || null,
      reviewNote: row.review_note || null,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    })),
  });
}

async function handleAdminWithdrawalDecision(request, env, user, withdrawalId, decision) {
  await requireAdminSession(request, env, user);
  const body = await requestJson(request);
  const current = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ?").bind(withdrawalId).first();
  if (!current) throw httpError(404, "Withdrawal not found");
  if (current.status !== "pending_review") throw httpError(409, "Withdrawal has already been reviewed");
  const timestamp = now();
  if (decision === "complete") {
    if (!env.OXAPAY_PAYOUT_API_KEY) throw httpError(503, "Wallet withdrawals are not configured yet");
    if (!env.PUBLIC_BASE_URL) throw httpError(503, "Wallet callback URL has not been configured");
    const claimed = await env.DB.prepare(`
      UPDATE crypto_withdrawals SET status = 'submitting', review_note = ?, updated_at = ?
      WHERE id = ? AND status = 'pending_review'
    `).bind(String(body.note || "").slice(0, 500) || null, timestamp, withdrawalId).run();
    if (Number(claimed.meta?.changes || 0) !== 1) throw httpError(409, "Withdrawal has already been reviewed");
    const asset = requireWalletAsset(current.payout_currency);
    try {
      const payout = await oxaPay(env, "/payout", {
        auth: "payout",
        method: "POST",
        body: {
          address: current.address,
          currency: asset.providerCurrency,
          amount: Number(current.payout_amount),
          network: asset.providerNetwork,
          callback_url: `${String(env.PUBLIC_BASE_URL).replace(/\/$/, "")}/webhooks/oxapay/payout`,
          memo: current.extra_id || undefined,
          description: `GamRace withdrawal ${current.id}`.slice(0, 160),
        },
      });
      const providerReference = safeProviderId(payout.track_id);
      if (!providerReference) throw httpError(502, "The payment service returned incomplete payout details");
      await env.DB.prepare(`
        UPDATE crypto_withdrawals
        SET status = ?, provider_reference = ?, updated_at = ?
        WHERE id = ? AND status = 'submitting'
      `).bind(oxaPayoutStatus(payout.status), providerReference, now(), withdrawalId).run();
    } catch (error) {
      const definitelyRejected = Number(error?.providerStatus || 0) > 0 && Number(error.providerStatus) < 500;
      await env.DB.prepare(`
        UPDATE crypto_withdrawals SET status = ?, updated_at = ?
        WHERE id = ? AND status = 'submitting'
      `).bind(definitelyRejected ? "pending_review" : "submission_unknown", now(), withdrawalId).run();
      throw error;
    }
  } else {
    const note = String(body.note || "").trim();
    if (note.length < 3 || note.length > 500) throw httpError(400, "Enter a brief rejection reason");
    await env.DB.prepare(`
      UPDATE crypto_withdrawals
      SET status = 'rejected', review_note = ?, updated_at = ?
      WHERE id = ? AND status = 'pending_review'
    `).bind(note, timestamp, withdrawalId).run();
  }
  const updated = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ?").bind(withdrawalId).first();
  await writeAdminAudit(env, user, `withdrawal.${decision === "complete" ? "approved" : "rejected"}`, withdrawalId, String(body.note || "") || null);
  return json(request, env, 200, { withdrawal: withdrawalResponse(updated) });
}

async function handleAdminCountryAccess(request, env, user) {
  await requireAdminSession(request, env, user);
  const result = await env.DB.prepare("SELECT country_code, allowed, updated_at FROM country_access ORDER BY country_code").all();
  return json(request, env, 200, {
    defaultAllowed: true,
    overrides: (result.results || []).map((row) => ({ countryCode: row.country_code, allowed: Boolean(row.allowed), updatedAt: new Date(Number(row.updated_at)).toISOString() })),
  });
}

async function handleAdminSetCountryAccess(request, env, user, countryCode) {
  await requireAdminSession(request, env, user);
  const normalized = String(countryCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw httpError(400, "Choose a valid country");
  const body = await requestJson(request);
  if (typeof body.allowed !== "boolean") throw httpError(400, "Allowed must be true or false");
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO country_access(country_code, allowed, updated_at, updated_by)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(country_code) DO UPDATE SET allowed = excluded.allowed, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).bind(normalized, body.allowed ? 1 : 0, timestamp, user.sub).run();
  await writeAdminAudit(env, user, body.allowed ? "country.allowed" : "country.blocked", normalized);
  return json(request, env, 200, { countryCode: normalized, allowed: body.allowed, updatedAt: new Date(timestamp).toISOString() });
}

function pathFrom(request) {
  return new URL(request.url).pathname.replace(/\/+$/, "") || "/";
}

async function route(request, env) {
  const path = pathFrom(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method === "GET" && path === "/health") return json(request, env, 200, { ok: true, provider: "oxapay", mode: "live" });
  if (request.method === "GET" && path === "/region-access") return handleRegionAccess(request, env);
  if (request.method === "POST" && path === "/webhooks/oxapay/deposit") return handleDepositWebhook(request, env);
  if (request.method === "POST" && path === "/webhooks/oxapay/payout") return handlePayoutWebhook(request, env);

  const user = await requireUser(request, env);
  if (request.method === "GET" && path === "/admin/access") return handleAdminAccess(request, env, user);
  if (request.method === "POST" && path === "/admin/session") return handleCreateAdminSession(request, env, user);
  if (request.method === "GET" && path === "/admin/session") return handleGetAdminSession(request, env, user);
  if (request.method === "GET" && path === "/admin/overview") return handleAdminOverview(request, env, user);
  if (request.method === "GET" && path === "/admin/users") return handleAdminUsers(request, env, user);
  if (request.method === "GET" && path === "/admin/deposits") return handleAdminDeposits(request, env, user);
  if (request.method === "GET" && path === "/admin/audit") return handleAdminAudit(request, env, user);
  if (request.method === "GET" && path === "/admin/system") return handleAdminSystem(request, env, user);
  if (request.method === "GET" && path === "/admin/country-access") return handleAdminCountryAccess(request, env, user);
  const countryAccessMatch = path.match(/^\/admin\/country-access\/([A-Za-z]{2})$/);
  if (request.method === "POST" && countryAccessMatch) return handleAdminSetCountryAccess(request, env, user, countryAccessMatch[1]);
  if (!path.startsWith("/admin/")) {
    const geo = await requireAllowedRegion(request, env);
    try { await touchUserSession(request, env, user, geo); }
    catch (error) { console.error("Session activity write failed", { message: error?.message }); }
  }
  if (request.method === "GET" && path === "/sessions") return handleSessions(request, env, user);
  if (request.method === "GET" && path === "/wallet") return handleGetWallet(request, env, user);
  if (request.method === "POST" && path === "/wallet/selection") return handleSelectCurrency(request, env, user);
  if (request.method === "GET" && path === "/currencies") return handleCurrencies(request, env);
  if (request.method === "GET" && path === "/deposit-addresses") return handleDepositAddresses(request, env, user);
  if (request.method === "POST" && path === "/deposits") return handleCreateDeposit(request, env, user);
  const depositMatch = path.match(/^\/deposits\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && depositMatch) return handleGetDeposit(request, env, user, depositMatch[1]);
  if (request.method === "POST" && path === "/withdrawals") return handleCreateWithdrawal(request, env, user);
  const withdrawalMatch = path.match(/^\/withdrawals\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && withdrawalMatch) return handleGetWithdrawal(request, env, user, withdrawalMatch[1]);
  if (request.method === "GET" && path === "/admin/withdrawals") return handleAdminWithdrawals(request, env, user);
  const completeMatch = path.match(/^\/admin\/withdrawals\/([A-Za-z0-9_-]+)\/complete$/);
  if (request.method === "POST" && completeMatch) return handleAdminWithdrawalDecision(request, env, user, completeMatch[1], "complete");
  const rejectMatch = path.match(/^\/admin\/withdrawals\/([A-Za-z0-9_-]+)\/reject$/);
  if (request.method === "POST" && rejectMatch) return handleAdminWithdrawalDecision(request, env, user, rejectMatch[1], "reject");
  return json(request, env, 404, { error: "Not found" });
}

function publicError(error) {
  const status = Number(error?.httpStatus || 500);
  if (error?.code === "ADMIN_NOT_CONFIGURED") return error.message;
  if (status >= 500) return "The wallet service could not complete that request";
  return error?.message || "The wallet service could not complete that request";
}

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin");
      if (origin && !allowedOrigins(env).has(origin)) return json(request, env, 403, { error: "Origin is not allowed" });
      return await route(request, env);
    } catch (error) {
      const status = Number(error?.httpStatus || 500);
      if (status >= 500) console.error("Wallet request failed", { path: pathFrom(request), message: error?.message, code: error?.code });
      return json(request, env, status, { error: publicError(error) });
    }
  },
};
