import {
  assetUnitsToString,
  blackjackHandValue,
  blackjackSideBetResults,
  coinflipMultiplierMicros,
  crashDurationMs,
  crashMultiplierMicros,
  crashPointMicros,
  createRawHmacSignature,
  dicePayout,
  hiloChoice,
  hiloWins,
  kenoPayout,
  limboPayout,
  limboResultMicros,
  maskAddress,
  minesMultiplierMicros,
  molesMultiplierMicros,
  STACK_LEVELS,
  STACK_SUCCESS_MICROS,
  stackMultiplierMicros,
  towersMultiplierMicros,
  normalizeAddress,
  normalizeCurrency,
  normalizeExtraId,
  normalizeRequestId,
  parseAssetUnits,
  parseNonNegativeAssetUnits,
  plinkoPayout,
  roulettePayout,
  wheelPayout,
  payoutFromMultiplier,
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
let gameEdgesCache;
let gameEdgesCacheExpiresAt = 0;
const countryAccessCache = new Map();
const sessionTouchCache = new Map();
const gameHistoryCache = new Map();

const COUNTRY_ACCESS_CACHE_MS = 5 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const GAME_EDGES_CACHE_MS = 30 * 1000;
const GAME_HISTORY_CACHE_MS = 15 * 1000;

function rememberWithLimit(cache, key, value, maximumEntries = 10_000) {
  if (cache.size >= maximumEntries && !cache.has(key)) cache.clear();
  cache.set(key, value);
}

const GAME_EDGE_DEFINITIONS = Object.freeze([
  { id: "mines", name: "Mines", editable: true },
  { id: "dice", name: "Dice", editable: true },
  { id: "wheel", name: "Wheel", editable: true },
  { id: "hi-lo", name: "Hi-Lo", editable: true },
  { id: "coinflip", name: "Coinflip", editable: true },
  { id: "crash", name: "Crash", editable: true },
  { id: "plinko", name: "Plinko", editable: true },
  { id: "keno", name: "Keno", editable: true },
  { id: "roulette", name: "Roulette", editable: false, fixedHouseEdgeBasisPoints: 1765, reason: "Determined by the live 17-tile distribution" },
  { id: "blackjack", name: "Blackjack", editable: false, fixedHouseEdgeBasisPoints: 50, reason: "Determined by six-deck, 3:2 blackjack rules and player decisions" },
  { id: "towers", name: "Towers", editable: true },
  { id: "moles", name: "Moles", editable: true },
  { id: "limbo", name: "Limbo", editable: true },
  { id: "stack", name: "Stack", editable: true },
]);

const NEW_GAME_BET_PATHS = Object.freeze({
  "/games/mines/rounds": "mines",
  "/games/dice/bets": "dice",
  "/games/wheel/bets": "wheel",
  "/games/hi-lo/rounds": "hi-lo",
  "/games/coinflip/rounds": "coinflip",
  "/games/crash/wagers": "crash",
  "/games/plinko/bets": "plinko",
  "/games/keno/bets": "keno",
  "/games/roulette/wagers": "roulette",
  "/games/blackjack/rounds": "blackjack",
  "/games/towers/rounds": "towers",
  "/games/moles/rounds": "moles",
  "/games/limbo/bets": "limbo",
  "/games/stack/rounds": "stack",
});

async function gameHouseEdgeBasisPoints(env, gameId) {
  const games = await readGameEdges(env);
  const game = games.find((entry) => entry.id === gameId);
  return Number.isInteger(Number(game?.houseEdgeBasisPoints)) ? Number(game.houseEdgeBasisPoints) : 100;
}

async function gameHouseFactorMicros(env, gameId) {
  return 1_000_000 - await gameHouseEdgeBasisPoints(env, gameId) * 100;
}

async function requireGameAvailable(env, gameId) {
  const setting = await env.DB.prepare("SELECT maintenance_mode FROM game_settings WHERE game_id = ?")
    .bind(gameId).first();
  if (Number(setting?.maintenance_mode || 0) === 1) {
    throw httpError(503, `${GAME_EDGE_DEFINITIONS.find((game) => game.id === gameId)?.name || "This game"} is under maintenance. New bets are temporarily paused.`, "GAME_MAINTENANCE");
  }
}

async function handleGameSettings(request, env) {
  const games = await readGameEdges(env);
  return json(request, env, 200, {
    games: Object.fromEntries(games.map((game) => [game.id, {
      houseEdgeBasisPoints: game.houseEdgeBasisPoints,
      houseEdgePercent: game.houseEdgePercent,
      houseFactorMicros: Math.round(game.rtpPercent * 10_000),
      rtpPercent: game.rtpPercent,
      maintenanceMode: game.maintenanceMode,
    }])),
  });
}

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

async function optionalUser(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID || "gamrace") : null;
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
  const cached = countryAccessCache.get(normalized);
  if (cached && cached.expiresAt > now()) return { allowed: cached.allowed, countryCode: normalized };
  const row = await env.DB.prepare("SELECT allowed FROM country_access WHERE country_code = ?").bind(normalized).first();
  const allowed = row ? Boolean(row.allowed) : true;
  rememberWithLimit(countryAccessCache, normalized, { allowed, expiresAt: now() + COUNTRY_ACCESS_CACHE_MS }, 300);
  return { allowed, countryCode: normalized };
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
  const cacheKey = `${user.sub}:${sessionId}`;
  const lastTouch = Number(sessionTouchCache.get(cacheKey) || 0);
  if (now() - lastTouch < SESSION_TOUCH_INTERVAL_MS) return;
  rememberWithLimit(sessionTouchCache, cacheKey, now());
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
  const result = await env.DB.prepare(`
    SELECT preference.selected_currency, balance.currency, balance.available_units, balance.held_units,
      balance.lifetime_deposited_units, balance.lifetime_withdrawn_units
    FROM wallet_preferences AS preference
    LEFT JOIN crypto_balances AS balance ON balance.uid = preference.uid
    WHERE preference.uid = ?
  `).bind(uid).all();
  let resultRows = result.results || [];
  if (!resultRows.length) {
    await ensureWalletPreference(env, uid);
    resultRows = [{ selected_currency: DEFAULT_WALLET_ASSET }];
  }
  const selectedCurrency = getWalletAsset(resultRows[0]?.selected_currency)?.code || DEFAULT_WALLET_ASSET;
  const rows = new Map(resultRows.filter((row) => row.currency).map((row) => [row.currency, row]));
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
  const [walletResult, diceResult, minesResult, plinkoResult, rouletteResult, kenoResult, wheelResult, hiloResult, blackjackResult, towersResult, molesResult, stackResult] = await Promise.all([
    env.DB.prepare(`
    SELECT payment_id AS id, 'deposit' AS type, status, pay_amount AS amount,
           pay_currency AS currency, created_at
    FROM crypto_deposits WHERE uid = ? AND status <> 'address_ready'
    UNION ALL
    SELECT id, 'withdrawal' AS type, status, payout_amount AS amount,
           payout_currency AS currency, created_at
    FROM crypto_withdrawals WHERE uid = ?
    ORDER BY created_at DESC LIMIT 50
  `).bind(uid, uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, created_at
      FROM dice_bets WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, status, created_at
      FROM mines_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, created_at
      FROM plinko_bets WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, created_at
      FROM roulette_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, status, created_at
      FROM keno_bets WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, status, created_at
      FROM wheel_bets WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, status, created_at
      FROM hilo_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, outcome, status, created_at
      FROM blackjack_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, status, created_at
      FROM towers_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, status, created_at
      FROM moles_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
    env.DB.prepare(`
      SELECT id, currency, wager_units, payout_units, multiplier_micros, status, created_at
      FROM stack_rounds WHERE uid = ? ORDER BY created_at DESC LIMIT 50
    `).bind(uid).all(),
  ]);
  const walletRows = (walletResult.results || []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    amount: String(row.amount || "0"),
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const diceRows = (diceResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Dice",
    status: row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const minesRows = (minesResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Mines",
    status: row.status === "lost" ? "loss" : row.status === "active" ? "open" : "win",
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const plinkoRows = (plinkoResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Plinko",
    status: row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const rouletteRows = (rouletteResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Roulette",
    status: row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const kenoRows = (kenoResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Keno",
    status: row.status === "revealing" ? "open" : row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const wheelRows = (wheelResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Wheel",
    status: row.status === "spinning" ? "open" : row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const hiloRows = (hiloResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Hi-Lo",
    status: row.status === "active" ? "open" : row.status === "cashed_out" ? "win" : "loss",
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const blackjackRows = (blackjackResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Blackjack",
    status: row.status === "active" ? "open" : row.outcome,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const towersRows = (towersResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Towers",
    status: row.status === "active" ? "open" : row.status === "lost" ? "loss" : "win",
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const molesRows = (molesResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Moles",
    status: row.status === "active" ? "open" : row.status === "lost" ? "loss" : "win",
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  const stackRows = (stackResult.results || []).map((row) => ({
    id: row.id,
    type: "bet",
    game: "Stack",
    status: row.status === "active" ? "open" : row.status === "lost" ? "loss" : "win",
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  return [...walletRows, ...diceRows, ...minesRows, ...plinkoRows, ...rouletteRows, ...kenoRows, ...wheelRows, ...hiloRows, ...blackjackRows, ...towersRows, ...molesRows, ...stackRows].sort((left, right) => right.createdAt - left.createdAt).slice(0, 50);
}

const PLAYER_BET_UNION_SQL_A = `
  SELECT 'Dice' AS game, id, currency, wager_units, payout_units, multiplier_micros,
    outcome AS status, created_at FROM dice_bets WHERE uid = ?
  UNION ALL SELECT 'Limbo', id, currency, wager_units, payout_units, multiplier_micros,
    outcome, created_at FROM limbo_bets WHERE uid = ?
  UNION ALL SELECT 'Mines', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM mines_rounds WHERE uid = ?
`;

const PLAYER_BET_UNION_SQL_B = `
  SELECT 'Plinko' AS game, id, currency, wager_units, payout_units, multiplier_micros,
    outcome AS status, created_at FROM plinko_bets WHERE uid = ?
`;

const PLAYER_BET_UNION_SQL_C = `
  SELECT 'Roulette' AS game, id, currency, wager_units, payout_units, multiplier_micros,
    outcome AS status, created_at FROM roulette_rounds WHERE uid = ?
  UNION ALL SELECT 'Keno', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'revealing' THEN 'open' ELSE outcome END, created_at FROM keno_bets WHERE uid = ?
  UNION ALL SELECT 'Wheel', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'spinning' THEN 'open' ELSE outcome END, created_at FROM wheel_bets WHERE uid = ?
`;

const PLAYER_BET_UNION_SQL_D = `
  SELECT 'Hi-Lo' AS game, id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END AS status, created_at FROM hilo_rounds WHERE uid = ?
  UNION ALL SELECT 'Coinflip', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM coinflip_rounds WHERE uid = ?
  UNION ALL SELECT 'Crash', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'open' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM crash_wagers WHERE uid = ?
`;

const PLAYER_BET_UNION_SQL_E = `
  SELECT 'Blackjack' AS game, id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' ELSE COALESCE(outcome, 'loss') END AS status, created_at FROM blackjack_rounds WHERE uid = ?
  UNION ALL SELECT 'Towers', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM towers_rounds WHERE uid = ?
  UNION ALL SELECT 'Moles', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM moles_rounds WHERE uid = ?
  UNION ALL SELECT 'Stack', id, currency, wager_units, payout_units, multiplier_micros,
    CASE WHEN status = 'active' THEN 'open' WHEN status = 'lost' THEN 'loss' ELSE 'win' END, created_at FROM stack_rounds WHERE uid = ?
`;

const PLAYER_BET_UNION_GROUPS = [
  { sql: PLAYER_BET_UNION_SQL_A, count: 3 },
  { sql: PLAYER_BET_UNION_SQL_B, count: 1 },
  { sql: PLAYER_BET_UNION_SQL_C, count: 3 },
  { sql: PLAYER_BET_UNION_SQL_D, count: 3 },
  { sql: PLAYER_BET_UNION_SQL_E, count: 4 },
];

function playerBetBindings(uid, count) {
  return Array.from({ length: count }, () => uid);
}

function stablecoinPrice(asset) {
  return ["USDT", "USDC"].includes(asset?.providerCurrency) ? 1 : 0;
}

function assetUnitsToUsdCents(units, asset, prices = {}) {
  const price = Number(prices?.[asset?.providerCurrency] || stablecoinPrice(asset));
  if (!Number.isFinite(price) || price <= 0) return null;
  const dollars = Number(assetUnitsToString(Math.max(0, Number(units || 0)), false)) * price;
  const cents = Math.round(dollars * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

async function usdCentsToAssetUnits(env, usdCents, asset) {
  if (usdCents === 0) return 0;
  const prices = await providerPrices(env);
  const price = Number(prices?.[asset.providerCurrency] || stablecoinPrice(asset));
  if (!Number.isFinite(price) || price <= 0) throw httpError(503, "A live USD price is not available for that coin right now");
  const units = Math.round((usdCents / 100 / price) * 100_000_000);
  if (!Number.isSafeInteger(units) || units <= 0) throw httpError(400, "That dollar balance is too small for the selected coin");
  return units;
}

async function liveAccountSnapshot(env, uid, { includeActivity = true } = {}) {
  const summarySql = (unionSql) => `
    SELECT currency,
      COUNT(*) AS total_bets,
      SUM(CASE WHEN status = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN status = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(wager_units) AS wager_units,
      SUM(payout_units - wager_units) AS net_units,
      MAX(payout_units) AS biggest_payout_units,
      MAX(multiplier_micros) AS highest_multiplier_micros
    FROM (${unionSql}) GROUP BY currency
  `;
  const favouriteSql = (unionSql) => `
    SELECT game, COUNT(*) AS plays FROM (${unionSql}) GROUP BY game
  `;
  const summaryQueries = PLAYER_BET_UNION_GROUPS.map(({ sql, count }) =>
    env.DB.prepare(summarySql(sql)).bind(...playerBetBindings(uid, count)));
  const favouriteQueries = PLAYER_BET_UNION_GROUPS.map(({ sql, count }) =>
    env.DB.prepare(favouriteSql(sql)).bind(...playerBetBindings(uid, count)));
  const activityQueries = includeActivity ? PLAYER_BET_UNION_GROUPS.map(({ sql, count }) => env.DB.prepare(`
    SELECT game, id, currency, wager_units, payout_units, multiplier_micros, status, created_at
    FROM (${sql}) ORDER BY created_at DESC LIMIT 100
  `).bind(...playerBetBindings(uid, count))) : [];
  const queries = [...summaryQueries, ...favouriteQueries, ...activityQueries];
  const results = await env.DB.batch(queries);
  const groupCount = PLAYER_BET_UNION_GROUPS.length;
  const summaryRows = results.slice(0, groupCount).flatMap((result) => result.results || []);
  const favouriteRows = results.slice(groupCount, groupCount * 2).flatMap((result) => result.results || []);
  const favouriteResult = favouriteRows.sort((left, right) => Number(right.plays || 0) - Number(left.plays || 0) || String(left.game).localeCompare(String(right.game)))[0];
  let prices = {};
  try { prices = await providerPrices(env); } catch { prices = {}; }
  let totalWagered = 0;
  let netProfitLoss = 0;
  let biggestWin = 0;
  let totalBets = 0;
  let wins = 0;
  let losses = 0;
  let highestMultiplier = 0;
  for (const row of summaryRows) {
    const asset = getWalletAsset(row.currency);
    if (!asset) continue;
    const price = Number(prices?.[asset.providerCurrency] || stablecoinPrice(asset));
    const toUsd = (units) => {
      const numericUnits = Number(units || 0);
      const sign = numericUnits < 0 ? -1 : 1;
      return Number(assetUnitsToString(Math.abs(numericUnits), false)) * price * sign;
    };
    totalWagered += toUsd(row.wager_units);
    netProfitLoss += toUsd(row.net_units);
    biggestWin = Math.max(biggestWin, toUsd(row.biggest_payout_units));
    totalBets += Number(row.total_bets || 0);
    wins += Number(row.wins || 0);
    losses += Number(row.losses || 0);
    highestMultiplier = Math.max(highestMultiplier, Number(row.highest_multiplier_micros || 0) / 1_000_000);
  }
  const settled = wins + losses;
  const summary = {
    totalWagered: Math.round(totalWagered * 100) / 100,
    lifetimeRawWager: Math.round(totalWagered * 100) / 100,
    lifetimeWeightedWager: Math.round(totalWagered * 100) / 100,
    totalBets,
    wins,
    losses,
    winRate: settled ? Math.round((wins / settled) * 10_000) / 100 : 0,
    netProfitLoss: Math.round(netProfitLoss * 100) / 100,
    biggestWin: Math.round(biggestWin * 100) / 100,
    highestMultiplier: Math.round(highestMultiplier * 100) / 100,
    favouriteGame: String(favouriteResult?.game || "—"),
    mostPlayedGame: String(favouriteResult?.game || "—"),
    pvpWins: 0,
    pvpLosses: 0,
    pvpWinRate: 0,
  };
  const activityRows = results.slice(groupCount * 2).flatMap((result) => result.results || [])
    .sort((left, right) => Number(right.created_at) - Number(left.created_at)).slice(0, 100);
  const activity = activityRows.map((row) => ({
    id: row.id,
    type: "bet",
    game: row.game,
    status: row.status,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros || 0) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  }));
  return { summary, activity };
}

function accountActivityResponse(row) {
  return {
    id: row.id,
    type: "bet",
    game: row.game,
    status: row.status,
    amount: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    multiplier: Number(row.multiplier_micros || 0) / 1_000_000,
    currency: row.currency,
    createdAt: Number(row.created_at),
  };
}

async function pagedAccountActivity(env, uid, pageValue = 1, pageSizeValue = 20) {
  const page = Math.max(1, Math.floor(Number(pageValue) || 1));
  const pageSize = Math.min(50, Math.max(10, Math.floor(Number(pageSizeValue) || 20)));
  const maximumRows = 5000;
  const required = Math.min(maximumRows, page * pageSize);
  const countQueries = PLAYER_BET_UNION_GROUPS.map(({ sql, count }) => env.DB.prepare(`
    SELECT COUNT(*) AS total FROM (${sql})
  `).bind(...playerBetBindings(uid, count)));
  const activityQueries = PLAYER_BET_UNION_GROUPS.map(({ sql, count }) => env.DB.prepare(`
    SELECT game, id, currency, wager_units, payout_units, multiplier_micros, status, created_at
    FROM (${sql}) ORDER BY created_at DESC LIMIT ?
  `).bind(...playerBetBindings(uid, count), required));
  const results = await env.DB.batch([...countQueries, ...activityQueries]);
  const groupCount = PLAYER_BET_UNION_GROUPS.length;
  const total = results.slice(0, groupCount).reduce((sum, result) => sum + Number(result.results?.[0]?.total || 0), 0);
  const offset = (page - 1) * pageSize;
  const items = results.slice(groupCount).flatMap((result) => result.results || [])
    .sort((left, right) => Number(right.created_at) - Number(left.created_at))
    .slice(offset, offset + pageSize)
    .map(accountActivityResponse);
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(Math.min(total, maximumRows) / pageSize)),
  };
}

function cleanAccountText(value, maximum, label, { required = false } = {}) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (required && !text) throw httpError(400, `${label} is required`);
  if (text.length > maximum) throw httpError(400, `${label} is too long`);
  return text;
}

function accountProfileResponse(row) {
  const details = {
    legalFirstName: String(row?.legal_first_name || ""),
    legalLastName: String(row?.legal_last_name || ""),
    dateOfBirth: String(row?.date_of_birth || ""),
    addressLine1: String(row?.address_line_1 || ""),
    addressLine2: String(row?.address_line_2 || ""),
    city: String(row?.city || ""),
    postalCode: String(row?.postal_code || ""),
    countryCode: String(row?.country_code || ""),
    language: String(row?.language || "en"),
    displayCurrency: String(row?.display_currency || "USD"),
    timezone: String(row?.timezone || "UTC"),
  };
  const complete = [details.legalFirstName, details.legalLastName, details.dateOfBirth, details.addressLine1, details.city, details.postalCode, details.countryCode].every(Boolean);
  return {
    details,
    verification: {
      currentLevel: complete ? 1 : 0,
      levels: [
        { level: 1, name: "Basic information", status: complete ? "Complete" : "Action required", detail: "Legal name, date of birth and residential address" },
        { level: 2, name: "Identity verification", status: "Unavailable", detail: "Requires a licensed identity-verification provider" },
        { level: 3, name: "Enhanced verification", status: "Locked", detail: "Available only after identity verification" },
      ],
      levelOneCompletedAt: row?.level_one_completed_at ? new Date(Number(row.level_one_completed_at)).toISOString() : null,
    },
  };
}

async function readAccountProfile(env, uid) {
  const row = await env.DB.prepare("SELECT * FROM account_profiles WHERE uid = ?").bind(uid).first();
  return accountProfileResponse(row);
}

async function handleAccountDetails(request, env, user) {
  const body = await requestJson(request);
  const legalFirstName = cleanAccountText(body.legalFirstName, 80, "First name", { required: true });
  const legalLastName = cleanAccountText(body.legalLastName, 80, "Last name", { required: true });
  const dateOfBirth = String(body.dateOfBirth || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw httpError(400, "Enter a valid date of birth");
  const birthDate = new Date(`${dateOfBirth}T00:00:00Z`);
  const minimumAdultDate = new Date();
  minimumAdultDate.setUTCFullYear(minimumAdultDate.getUTCFullYear() - 18);
  if (Number.isNaN(birthDate.valueOf()) || birthDate > minimumAdultDate) throw httpError(400, "You must be at least 18 years old");
  const addressLine1 = cleanAccountText(body.addressLine1, 120, "Address", { required: true });
  const addressLine2 = cleanAccountText(body.addressLine2, 120, "Address line 2");
  const city = cleanAccountText(body.city, 80, "City", { required: true });
  const postalCode = cleanAccountText(body.postalCode, 24, "Postal code", { required: true });
  const countryCode = String(body.countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw httpError(400, "Choose a valid country");
  const language = String(body.language || "en").trim().toLowerCase();
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(language)) throw httpError(400, "Choose a valid language");
  const displayCurrency = String(body.displayCurrency || "USD").trim().toUpperCase();
  if (!["USD", "GBP", "EUR"].includes(displayCurrency)) throw httpError(400, "Choose a valid display currency");
  const timezone = cleanAccountText(body.timezone, 80, "Timezone", { required: true });
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO account_profiles(uid, legal_first_name, legal_last_name, date_of_birth, address_line_1, address_line_2, city, postal_code, country_code, language, display_currency, timezone, level_one_completed_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET legal_first_name=excluded.legal_first_name, legal_last_name=excluded.legal_last_name,
      date_of_birth=excluded.date_of_birth, address_line_1=excluded.address_line_1, address_line_2=excluded.address_line_2,
      city=excluded.city, postal_code=excluded.postal_code, country_code=excluded.country_code,
      language=excluded.language, display_currency=excluded.display_currency, timezone=excluded.timezone,
      level_one_completed_at=COALESCE(account_profiles.level_one_completed_at, excluded.level_one_completed_at), updated_at=excluded.updated_at
  `).bind(user.sub, legalFirstName, legalLastName, dateOfBirth, addressLine1, addressLine2, city, postalCode, countryCode, language, displayCurrency, timezone, timestamp, timestamp).run();
  return json(request, env, 200, await readAccountProfile(env, user.sub));
}

async function handleAccountActivity(request, env, user) {
  const url = new URL(request.url);
  return json(request, env, 200, { pagination: await pagedAccountActivity(env, user.sub, url.searchParams.get("page"), url.searchParams.get("pageSize")) });
}

const ACCOUNT_PREFERENCE_KEYS = new Set([
  "profilePublic", "showUsername", "showWagers", "showProfit", "showFavorites",
  "showRank", "showOnline", "allowTips", "marketingConsent", "loginAlerts", "withdrawalConfirmation",
]);

function safeAccountPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    typeof entry === "boolean" && (ACCOUNT_PREFERENCE_KEYS.has(key) || /^notification-[a-z0-9-]{1,80}$/.test(key))));
}

async function readAccountPreferences(env, uid) {
  const row = await env.DB.prepare("SELECT preferences_json FROM player_preferences WHERE uid = ?").bind(uid).first();
  if (!row) return {};
  try { return safeAccountPreferences(JSON.parse(String(row.preferences_json || "{}"))); }
  catch { return {}; }
}

async function handleAccountSnapshot(request, env, user) {
  const compact = new URL(request.url).searchParams.get("compact") === "1";
  const [account, preferences, profile] = await Promise.all([
    liveAccountSnapshot(env, user.sub, { includeActivity: !compact }),
    readAccountPreferences(env, user.sub),
    readAccountProfile(env, user.sub),
  ]);
  return json(request, env, 200, {
    ...account,
    preferences,
    ...profile,
    security: {
      emailVerified: Boolean(user.email_verified),
      provider: String(user.firebase?.sign_in_provider || "unknown"),
      multiFactorAvailable: false,
      passkeysAvailable: false,
    },
  });
}

async function handleAccountPreferences(request, env, user) {
  const body = await requestJson(request);
  const next = safeAccountPreferences(body.preferences);
  const current = await readAccountPreferences(env, user.sub);
  const preferences = { ...current, ...next };
  await env.DB.prepare(`
    INSERT INTO player_preferences(uid, preferences_json, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET preferences_json = excluded.preferences_json, updated_at = excluded.updated_at
  `).bind(user.sub, JSON.stringify(preferences), now()).run();
  return json(request, env, 200, { preferences });
}

async function walletFundingActivity(env, uid) {
  const result = await env.DB.prepare(`
    SELECT payment_id AS id, 'deposit' AS type, status, pay_amount AS amount,
      pay_currency AS currency, created_at FROM crypto_deposits
    WHERE uid = ? AND status <> 'address_ready'
    UNION ALL
    SELECT id, 'withdrawal' AS type, status, payout_amount AS amount,
      payout_currency AS currency, created_at FROM crypto_withdrawals WHERE uid = ?
    UNION ALL
    SELECT id, 'promotion' AS type, 'credited' AS status,
      printf('%.8f', amount_units / 100000000.0) AS amount,
      currency, created_at FROM crypto_ledger WHERE uid = ? AND type = 'promo_reward'
    ORDER BY created_at DESC LIMIT 50
  `).bind(uid, uid, uid).all();
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
  const [wallet, account, funding] = await Promise.all([
    walletResponse(env, user.sub),
    liveAccountSnapshot(env, user.sub),
    walletFundingActivity(env, user.sub),
  ]);
  const activity = [...account.activity, ...funding].sort((left, right) => right.createdAt - left.createdAt).slice(0, 100);
  return json(request, env, 200, { wallet, activity });
}

async function handleSyncProfile(request, env, user) {
  const body = await requestJson(request);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const projectId = env.FIREBASE_PROJECT_ID || "gamrace";
  const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.sub)}`;
  const response = await fetch(profileUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) throw httpError(502, "Your username could not be synchronized");
  const profile = await response.json();
  const username = String(profile?.fields?.username?.stringValue || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) throw httpError(409, "Your profile username is not ready yet");
  const profilePublic = typeof body.profilePublic === "boolean" ? Number(body.profilePublic) : null;
  const showUsername = typeof body.showUsername === "boolean" ? Number(body.showUsername) : null;
  const showRank = typeof body.showRank === "boolean" ? Number(body.showRank) : null;
  await env.DB.prepare(`
    INSERT INTO player_profiles(uid, username, profile_public, show_username, show_rank, updated_at)
    VALUES(?, ?, COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), ?)
    ON CONFLICT(uid) DO UPDATE SET
      username = excluded.username,
      profile_public = COALESCE(?, player_profiles.profile_public),
      show_username = COALESCE(?, player_profiles.show_username),
      show_rank = COALESCE(?, player_profiles.show_rank),
      updated_at = excluded.updated_at
  `).bind(user.sub, username, profilePublic, showUsername, showRank, now(), profilePublic, showUsername, showRank).run();
  return json(request, env, 200, { profile: { username, profilePublic: profilePublic !== 0, showUsername: showUsername !== 0, showRank: showRank !== 0 } });
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

function secureRandomInt(maximum) {
  const max = Number(maximum);
  if (!Number.isInteger(max) || max <= 0) throw new Error("Invalid random range");
  const limit = Math.floor(0x100000000 / max) * max;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % max;
}

function secureRouletteResult() {
  const positions = [
    "blue", "cyan", "blue", "cyan", "blue", "cyan", "blue",
    "purple", "gold", "purple",
    "cyan", "blue", "cyan", "blue", "cyan", "blue", "cyan",
  ];
  return positions[secureRandomInt(positions.length)];
}

function shuffledTiles() {
  const tiles = Array.from({ length: 25 }, (_, index) => index);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const other = secureRandomInt(index + 1);
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  return tiles;
}

function shuffledKenoNumbers() {
  const numbers = Array.from({ length: 40 }, (_, index) => index + 1);
  for (let index = numbers.length - 1; index > 0; index -= 1) {
    const other = secureRandomInt(index + 1);
    [numbers[index], numbers[other]] = [numbers[other], numbers[index]];
  }
  return numbers;
}

async function gameWagerUnits(env, asset, wager, displayFiat) {
  if (!displayFiat) return parseAssetUnits(wager, { maximumUnits: 1_000_000_000_000_000 });
  const usdCents = Math.round(Number(wager) * 100);
  if (!Number.isSafeInteger(usdCents) || usdCents < 1 || usdCents > 100_000_000) throw httpError(400, "Enter a wager between $0.01 and $1,000,000.00");
  const prices = await providerPrices(env);
  const price = Number(prices?.[asset.providerCurrency] || 0);
  if (!Number.isFinite(price) || price <= 0) throw httpError(503, "A live price is not available for that coin right now");
  const units = Math.ceil((usdCents / 100 / price) * 100_000_000);
  if (!Number.isSafeInteger(units) || units <= 0) throw httpError(400, "That wager is too small for the selected coin");
  return units;
}

async function requireSelectedGameAsset(env, uid, currency) {
  const asset = requireWalletAsset(normalizeCurrency(currency));
  const preference = await ensureWalletPreference(env, uid);
  if (preference.selected_currency !== asset.code) throw httpError(409, "Select this coin from your balance menu before betting");
  return asset;
}

function diceBetResponse(row) {
  return {
    id: row.id,
    game: "dice",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    net: assetUnitsToString(Math.abs(Number(row.payout_units) - Number(row.wager_units)), false),
    netDirection: Number(row.payout_units) >= Number(row.wager_units) ? "credit" : "debit",
    target: Number(row.target_basis_points) / 100,
    direction: row.direction,
    roll: Number(row.roll_basis_points) / 100,
    chance: Number(row.chance_basis_points) / 100,
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleDiceBet(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM dice_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { bet: diceBetResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const targetBasisPoints = Math.round(Number(body.target) * 100);
  const direction = String(body.direction || "").toLowerCase();
  const rollBasisPoints = secureRandomInt(10_000) + 1;
  const houseFactorMicros = await gameHouseFactorMicros(env, "dice");
  let settlement;
  try { settlement = dicePayout(wagerUnits, targetBasisPoints, direction, rollBasisPoints, houseFactorMicros); }
  catch (error) { throw httpError(400, error.message); }
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
      INSERT INTO dice_bets(
        id, request_id, uid, currency, wager_units, payout_units,
        target_basis_points, direction, roll_basis_points, chance_basis_points,
        multiplier_micros, outcome, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM crypto_balances
      WHERE uid = ? AND currency = ? AND available_units >= ?
    `).bind(
      id, requestId, user.sub, asset.code, wagerUnits, settlement.payoutUnits,
      targetBasisPoints, direction, rollBasisPoints, settlement.chanceBasisPoints,
      settlement.multiplierMicros, settlement.won ? "win" : "loss", timestamp,
      user.sub, asset.code, wagerUnits,
    ),
      env.DB.prepare(`
        UPDATE crypto_balances
        SET available_units = available_units - ? + ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM dice_bets WHERE id = ?)
      `).bind(wagerUnits, settlement.payoutUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'dice_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM dice_bets WHERE id = ?
      `).bind(id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'dice_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at
        FROM dice_bets WHERE id = ? AND payout_units > 0
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM dice_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { bet: diceBetResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM dice_bets WHERE id = ?").bind(id).first();
  return json(request, env, 201, { bet: diceBetResponse(created), wallet: await walletResponse(env, user.sub) });
}

function limboBetResponse(row) {
  return {
    id: row.id,
    game: "limbo",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    net: assetUnitsToString(Math.abs(Number(row.payout_units) - Number(row.wager_units)), false),
    netDirection: Number(row.payout_units) >= Number(row.wager_units) ? "credit" : "debit",
    targetMultiplier: Number(row.target_multiplier_micros) / 1_000_000,
    resultMultiplier: Number(row.result_multiplier_micros) / 1_000_000,
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleLimboBet(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM limbo_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { bet: limboBetResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const targetMultiplierMicros = Math.round(Number(body.targetMultiplier) * 1_000_000);
  const houseFactorMicros = await gameHouseFactorMicros(env, "limbo");
  const resultMultiplierMicros = limboResultMicros(secureRandomInt(100_000_000) + 1, houseFactorMicros);
  let settlement;
  try { settlement = limboPayout(wagerUnits, targetMultiplierMicros, resultMultiplierMicros); }
  catch (error) { throw httpError(400, error.message); }
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO limbo_bets(
          id, request_id, uid, currency, wager_units, payout_units,
          target_multiplier_micros, result_multiplier_micros, multiplier_micros,
          outcome, house_factor_micros, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
      `).bind(
        id, requestId, user.sub, asset.code, wagerUnits, settlement.payoutUnits,
        targetMultiplierMicros, resultMultiplierMicros, settlement.multiplierMicros,
        settlement.won ? "win" : "loss", houseFactorMicros, timestamp,
        user.sub, asset.code, wagerUnits,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances
        SET available_units = available_units - ? + ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM limbo_bets WHERE id = ?)
      `).bind(wagerUnits, settlement.payoutUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'limbo_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM limbo_bets WHERE id = ?
      `).bind(id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'limbo_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at
        FROM limbo_bets WHERE id = ? AND payout_units > 0
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM limbo_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { bet: limboBetResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM limbo_bets WHERE id = ?").bind(id).first();
  return json(request, env, 201, { bet: limboBetResponse(created), wallet: await walletResponse(env, user.sub) });
}

function plinkoBetResponse(row) {
  let path = [];
  try { path = JSON.parse(String(row.path || "[]")); } catch { path = []; }
  return {
    id: row.id,
    game: "plinko",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    net: assetUnitsToString(Math.abs(Number(row.payout_units) - Number(row.wager_units)), false),
    netDirection: Number(row.payout_units) >= Number(row.wager_units) ? "credit" : "debit",
    risk: row.risk,
    rows: Number(row.rows),
    path: Array.isArray(path) ? path.map((step) => step === 1 ? 1 : 0) : [],
    bucket: Number(row.bucket),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handlePlinkoBet(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM plinko_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { bet: plinkoBetResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const rows = Number(body.rows);
  const risk = String(body.risk || "").toLowerCase();
  if (!Number.isInteger(rows) || rows < 8 || rows > 16) throw httpError(400, "Choose between 8 and 16 Plinko rows");
  if (!["low", "medium", "high"].includes(risk)) throw httpError(400, "Choose a valid Plinko risk level");
  const path = Array.from({ length: rows }, () => secureRandomInt(2));
  const bucket = path.reduce((total, step) => total + step, 0);
  let settlement;
  const houseFactorMicros = await gameHouseFactorMicros(env, "plinko");
  try { settlement = plinkoPayout(wagerUnits, rows, risk, bucket, houseFactorMicros); }
  catch (error) { throw httpError(400, error.message); }
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO plinko_bets(
          id, request_id, uid, currency, wager_units, payout_units, risk,
          rows, path, bucket, multiplier_micros, outcome, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
      `).bind(
        id, requestId, user.sub, asset.code, wagerUnits, settlement.payoutUnits, risk,
        rows, JSON.stringify(path), bucket, settlement.multiplierMicros, settlement.outcome, timestamp,
        user.sub, asset.code, wagerUnits,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances
        SET available_units = available_units - ? + ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM plinko_bets WHERE id = ?)
      `).bind(wagerUnits, settlement.payoutUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'plinko_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM plinko_bets WHERE id = ?
      `).bind(id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'plinko_payout_' || id, uid, currency, 'game_payout', payout_units, id, created_at
        FROM plinko_bets WHERE id = ? AND payout_units > 0
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM plinko_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { bet: plinkoBetResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM plinko_bets WHERE id = ?").bind(id).first();
  return json(request, env, 201, { bet: plinkoBetResponse(created), wallet: await walletResponse(env, user.sub) });
}

function wheelBetResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    game: "wheel",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    risk: row.risk,
    segments: Number(row.segments),
    resultIndex: Number(row.result_index),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleGetActiveWheelBet(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM wheel_bets
    WHERE uid = ? AND currency = ? AND status = 'spinning'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { bet: wheelBetResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartWheelBet(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM wheel_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { bet: wheelBetResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare(`
    SELECT * FROM wheel_bets WHERE uid = ? AND currency = ? AND status = 'spinning'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { bet: wheelBetResponse(active), wallet: await walletResponse(env, user.sub) });
  const segments = Number(body.segments);
  const risk = String(body.risk || "medium").toLowerCase();
  if (![10, 20, 30, 40, 50].includes(segments)) throw httpError(400, "Choose a valid Wheel segment count");
  if (!["low", "medium", "high"].includes(risk)) throw httpError(400, "Choose a valid Wheel risk level");
  const resultIndex = secureRandomInt(segments);
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "wheel");
  let settlement;
  try { settlement = wheelPayout(wagerUnits, segments, risk, resultIndex, houseFactorMicros); }
  catch (error) { throw httpError(400, error.message); }
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO wheel_bets(
          id, request_id, uid, currency, wager_units, payout_units, risk,
          segments, result_index, multiplier_micros, outcome, status, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spinning', ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
      `).bind(
        id, requestId, user.sub, asset.code, wagerUnits, settlement.payoutUnits,
        risk, segments, resultIndex, settlement.multiplierMicros, settlement.outcome, timestamp,
        user.sub, asset.code, wagerUnits,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM wheel_bets WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'wheel_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM wheel_bets WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM wheel_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { bet: wheelBetResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM wheel_bets WHERE id = ?").bind(id).first();
  return json(request, env, 201, { bet: wheelBetResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function handleSettleWheelBet(request, env, user, betIdValue) {
  const betId = String(betIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(betId)) throw httpError(400, "Invalid Wheel bet");
  let row = await env.DB.prepare("SELECT * FROM wheel_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
  if (!row) throw httpError(404, "That Wheel bet was not found");
  if (row.status === "settled") return json(request, env, 200, { bet: wheelBetResponse(row), wallet: await walletResponse(env, user.sub) });
  const timestamp = now();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE wheel_bets SET status = 'settled', settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'spinning'
    `).bind(timestamp, betId, user.sub),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ?
        AND EXISTS(SELECT 1 FROM wheel_bets WHERE id = ? AND uid = ? AND status = 'settled' AND settled_at = ?)
    `).bind(Number(row.payout_units), timestamp, user.sub, row.currency, betId, user.sub, timestamp),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'wheel_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM wheel_bets WHERE id = ? AND uid = ? AND status = 'settled' AND settled_at = ? AND payout_units > 0
    `).bind(timestamp, betId, user.sub, timestamp),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare("SELECT * FROM wheel_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
    if (row?.status !== "settled") throw httpError(409, "That Wheel bet could not be settled");
  }
  row = await env.DB.prepare("SELECT * FROM wheel_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
  return json(request, env, 200, { bet: wheelBetResponse(row), wallet: await walletResponse(env, user.sub) });
}

function parseKenoNumbers(value, label = "Keno numbers") {
  const numbers = Array.isArray(value) ? value.map(Number) : [];
  if (numbers.length < 1 || numbers.length > 10 || numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 40)) {
    throw httpError(400, `${label} must contain between 1 and 10 unique numbers from 1 to 40`);
  }
  const unique = [...new Set(numbers)];
  if (unique.length !== numbers.length) throw httpError(400, `${label} cannot contain duplicates`);
  return unique.sort((left, right) => left - right);
}

function kenoStoredNumbers(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter((number) => Number.isInteger(number) && number >= 1 && number <= 40) : [];
  } catch {
    return [];
  }
}

function kenoBetResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    game: "keno",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    selectedNumbers: kenoStoredNumbers(row.selected_numbers),
    drawnNumbers: kenoStoredNumbers(row.drawn_numbers),
    hits: Number(row.hits),
    selectedCount: Number(row.selected_count),
    risk: row.risk,
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleGetActiveKenoBet(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM keno_bets
    WHERE uid = ? AND currency = ? AND status = 'revealing'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { bet: kenoBetResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartKenoBet(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM keno_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { bet: kenoBetResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare(`
    SELECT * FROM keno_bets WHERE uid = ? AND currency = ? AND status = 'revealing'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { bet: kenoBetResponse(active), wallet: await walletResponse(env, user.sub) });
  const selectedNumbers = parseKenoNumbers(body.selectedNumbers);
  const risk = String(body.risk || "medium").toLowerCase();
  if (!["easy", "medium", "hard", "extreme"].includes(risk)) throw httpError(400, "Choose a valid Keno risk level");
  const drawnNumbers = shuffledKenoNumbers().slice(0, 10);
  const selected = new Set(selectedNumbers);
  const hits = drawnNumbers.reduce((total, number) => total + (selected.has(number) ? 1 : 0), 0);
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  let settlement;
  const houseFactorMicros = await gameHouseFactorMicros(env, "keno");
  try { settlement = kenoPayout(wagerUnits, selectedNumbers.length, hits, risk, houseFactorMicros); }
  catch (error) { throw httpError(400, error.message); }
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO keno_bets(
          id, request_id, uid, currency, wager_units, payout_units, selected_numbers,
          drawn_numbers, selected_count, risk, hits, multiplier_micros, outcome, status, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'revealing', ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
      `).bind(
        id, requestId, user.sub, asset.code, wagerUnits, settlement.payoutUnits,
        JSON.stringify(selectedNumbers), JSON.stringify(drawnNumbers), selectedNumbers.length,
        risk, hits, settlement.multiplierMicros, settlement.outcome, timestamp,
        user.sub, asset.code, wagerUnits,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM keno_bets WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'keno_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM keno_bets WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM keno_bets WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { bet: kenoBetResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM keno_bets WHERE id = ?").bind(id).first();
  return json(request, env, 201, { bet: kenoBetResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function handleSettleKenoBet(request, env, user, betIdValue) {
  const betId = String(betIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(betId)) throw httpError(400, "Invalid Keno bet");
  let row = await env.DB.prepare("SELECT * FROM keno_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
  if (!row) throw httpError(404, "That Keno bet was not found");
  if (row.status === "settled") return json(request, env, 200, { bet: kenoBetResponse(row), wallet: await walletResponse(env, user.sub) });
  const timestamp = now();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE keno_bets SET status = 'settled', settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'revealing'
    `).bind(timestamp, betId, user.sub),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ?
        AND EXISTS(SELECT 1 FROM keno_bets WHERE id = ? AND uid = ? AND status = 'settled' AND settled_at = ?)
    `).bind(Number(row.payout_units), timestamp, user.sub, row.currency, betId, user.sub, timestamp),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'keno_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM keno_bets WHERE id = ? AND uid = ? AND status = 'settled' AND settled_at = ? AND payout_units > 0
    `).bind(timestamp, betId, user.sub, timestamp),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare("SELECT * FROM keno_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
    if (row?.status !== "settled") throw httpError(409, "That Keno bet could not be settled");
  }
  row = await env.DB.prepare("SELECT * FROM keno_bets WHERE id = ? AND uid = ?").bind(betId, user.sub).first();
  return json(request, env, 200, { bet: kenoBetResponse(row), wallet: await walletResponse(env, user.sub) });
}

function hiloCards(row) {
  try {
    const parsed = JSON.parse(String(row?.card_history || "[]"));
    return Array.isArray(parsed) ? parsed.filter((card) => Number(card?.rank) >= 1 && Number(card?.rank) <= 13 && Number(card?.suit) >= 0 && Number(card?.suit) <= 3) : [];
  } catch { return []; }
}

function hiloRoundResponse(row) {
  if (!row) return null;
  const currentRank = Number(row.current_rank);
  const houseFactorMicros = Number(row.house_factor_micros || 990_000);
  const higher = hiloChoice(currentRank, "higher", houseFactorMicros);
  const lower = hiloChoice(currentRank, "lower", houseFactorMicros);
  return {
    id: row.id,
    game: "hi-lo",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    currentCard: { rank: currentRank, suit: Number(row.current_suit) },
    cards: hiloCards(row),
    guesses: Number(row.guesses),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    choices: {
      higher: { chance: higher.chanceBasisPoints / 100, multiplier: higher.multiplierMicros / 1_000_000, available: higher.available },
      lower: { chance: lower.chanceBasisPoints / 100, multiplier: lower.multiplierMicros / 1_000_000, available: lower.available },
    },
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleGetActiveHiloRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM hilo_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: hiloRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartHiloRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: hiloRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: hiloRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "hi-lo");
  const rank = secureRandomInt(13) + 1;
  const suit = secureRandomInt(4);
  const timestamp = now();
  const id = crypto.randomUUID();
  const history = JSON.stringify([{ rank, suit }]);
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO hilo_rounds(
          id, request_id, uid, currency, wager_units, payout_units,
          current_rank, current_suit, card_history, guesses, multiplier_micros,
          status, created_at, updated_at, house_factor_micros
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1000000, 'active', ?, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
          AND NOT EXISTS(SELECT 1 FROM hilo_rounds WHERE uid = ? AND currency = ? AND status = 'active')
      `).bind(id, requestId, user.sub, asset.code, wagerUnits, wagerUnits, rank, suit, history, timestamp, timestamp, houseFactorMicros, user.sub, asset.code, wagerUnits, user.sub, asset.code),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM hilo_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'hilo_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM hilo_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      const current = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
      if (current) return json(request, env, 200, { round: hiloRoundResponse(current), wallet: await walletResponse(env, user.sub) });
      throw httpError(409, "Your available balance is too low");
    }
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: hiloRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const current = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
    if (current) return json(request, env, 200, { round: hiloRoundResponse(current), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: hiloRoundResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function handleHiloGuess(request, env, user, roundIdValue) {
  const roundId = String(roundIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(roundId)) throw httpError(400, "Invalid Hi-Lo round");
  const body = await requestJson(request);
  const direction = String(body.direction || "").toLowerCase();
  if (!['higher', 'lower'].includes(direction)) throw httpError(400, "Choose higher or lower");
  const row = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (!row) throw httpError(404, "That Hi-Lo round was not found");
  if (row.status !== "active") return json(request, env, 200, { round: hiloRoundResponse(row), wallet: await walletResponse(env, user.sub) });
  const nextRank = secureRandomInt(13) + 1;
  const nextSuit = secureRandomInt(4);
  const currentRank = Number(row.current_rank);
  const choice = hiloChoice(currentRank, direction, Number(row.house_factor_micros || 990_000));
  if (!choice.available) throw httpError(400, "That prediction is unavailable because its payout would be below 1×");
  const won = hiloWins(currentRank, nextRank, direction);
  const stepMicros = choice.multiplierMicros;
  const cumulativeMicros = Number((BigInt(Number(row.multiplier_micros)) * BigInt(stepMicros)) / 1_000_000n);
  const cappedMicros = Math.min(cumulativeMicros, 1_000_000_000_000);
  const payoutUnits = won ? Number((BigInt(Number(row.wager_units)) * BigInt(cappedMicros) / 1_000_000n) > 1_000_000_000_000_000n ? 1_000_000_000_000_000n : (BigInt(Number(row.wager_units)) * BigInt(cappedMicros) / 1_000_000n)) : 0;
  const cards = hiloCards(row);
  cards.push({ rank: nextRank, suit: nextSuit, direction, won });
  const timestamp = now();
  const result = await env.DB.prepare(`
    UPDATE hilo_rounds SET current_rank = ?, current_suit = ?, card_history = ?, guesses = guesses + 1,
      multiplier_micros = ?, payout_units = ?, status = ?, updated_at = ?, settled_at = ?
    WHERE id = ? AND uid = ? AND status = 'active' AND updated_at = ?
  `).bind(nextRank, nextSuit, JSON.stringify(cards), won ? cappedMicros : Number(row.multiplier_micros), payoutUnits, won ? "active" : "lost", timestamp, won ? null : timestamp, roundId, user.sub, Number(row.updated_at)).run();
  const updated = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (Number(result.meta?.changes || 0) !== 1 && updated?.status === "active") throw httpError(409, "That card has already been played");
  return json(request, env, 200, { round: hiloRoundResponse(updated), wallet: await walletResponse(env, user.sub) });
}

async function handleHiloCashout(request, env, user, roundIdValue) {
  const roundId = String(roundIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(roundId)) throw httpError(400, "Invalid Hi-Lo round");
  let row = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (!row) throw httpError(404, "That Hi-Lo round was not found");
  if (row.status === "cashed_out") return json(request, env, 200, { round: hiloRoundResponse(row), wallet: await walletResponse(env, user.sub) });
  if (row.status !== "active" || Number(row.guesses) < 1) throw httpError(409, "Win at least one prediction before cashing out");
  const timestamp = now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE hilo_rounds SET status = 'cashed_out', updated_at = ?, settled_at = ? WHERE id = ? AND uid = ? AND status = 'active'").bind(timestamp, timestamp, roundId, user.sub),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM hilo_rounds WHERE id = ? AND uid = ? AND status = 'cashed_out' AND settled_at = ?)
    `).bind(Number(row.payout_units), timestamp, user.sub, row.currency, roundId, user.sub, timestamp),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'hilo_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM hilo_rounds WHERE id = ? AND uid = ? AND status = 'cashed_out' AND settled_at = ? AND payout_units > 0
    `).bind(timestamp, roundId, user.sub, timestamp),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
    if (row?.status !== "cashed_out") throw httpError(409, "That Hi-Lo round could not be cashed out");
  }
  row = await env.DB.prepare("SELECT * FROM hilo_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  return json(request, env, 200, { round: hiloRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

const BLACKJACK_SUITS = Object.freeze(["spades", "hearts", "diamonds", "clubs"]);
const BLACKJACK_RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

function blackjackShoe() {
  const cards = Array.from({ length: 6 * 52 }, (_, index) => index);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = secureRandomInt(index + 1);
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }
  return cards;
}

function blackjackCard(cardId) {
  const rankIndex = Number(cardId) % 13;
  const suitIndex = Math.floor(Number(cardId) / 13) % 4;
  return {
    id: Number(cardId),
    rank: BLACKJACK_RANKS[rankIndex],
    suit: BLACKJACK_SUITS[suitIndex],
    code: `${BLACKJACK_RANKS[rankIndex]}${["S", "H", "D", "C"][suitIndex]}`,
  };
}

function blackjackState(row) {
  try {
    const shoe = JSON.parse(String(row?.shoe_json || "[]"));
    const dealer = JSON.parse(String(row?.dealer_cards_json || "[]"));
    const hands = JSON.parse(String(row?.player_hands_json || "[]"));
    if (!Array.isArray(shoe) || !Array.isArray(dealer) || !Array.isArray(hands)) throw new Error("Invalid state");
    return { shoe, dealer, hands };
  } catch { throw httpError(500, "That Blackjack round has invalid card data"); }
}

function blackjackAvailableActions(row, hands) {
  if (!row || row.status !== "active") return [];
  const hand = hands[Number(row.active_hand)];
  if (!hand || hand.status !== "playing") return [];
  const actions = ["hit", "stand"];
  if (hand.cards.length === 2 && !hand.doubled) actions.push("double");
  if (!Number(row.split_hand) && hand.cards.length === 2 && Number(hand.cards[0]) % 13 === Number(hand.cards[1]) % 13) actions.push("split");
  return actions;
}

function blackjackSideState(row) {
  try {
    const value = JSON.parse(String(row?.side_bets_json || "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { throw httpError(500, "That Blackjack round has invalid side-bet data"); }
}

function blackjackSideResponse(row) {
  const state = blackjackSideState(row);
  return Object.fromEntries(["perfectPairs", "twentyOnePlusThree"].map((key) => {
    const bet = state[key] || {};
    return [key, {
      wagerPerHand: assetUnitsToString(Number(bet.wagerPerHand || 0), false),
      wager: assetUnitsToString(Number(bet.wagerUnits || 0), false),
      payout: assetUnitsToString(Number(bet.payoutUnits || 0), false),
      results: Array.isArray(bet.results) ? bet.results.map((result) => ({
        result: String(result.result || "none"),
        multiplier: Number(result.multiplierMicros || 0) / 1_000_000,
        payout: assetUnitsToString(Number(result.payoutUnits || 0), false),
      })) : [],
    }];
  }));
}

function blackjackSideStateForHands(hands, dealerUpCard, perfectPairsWager, twentyOnePlusThreeWager) {
  const state = {};
  for (const [key, wagerPerHand] of Object.entries({ perfectPairs: perfectPairsWager, twentyOnePlusThree: twentyOnePlusThreeWager })) {
    const results = hands.map((hand) => {
      const result = blackjackSideBetResults(hand.cards, dealerUpCard)[key];
      const payoutUnits = wagerPerHand > 0 && result.multiplierMicros > 0 ? payoutFromMultiplier(wagerPerHand, result.multiplierMicros) : 0;
      return { ...result, payoutUnits };
    });
    state[key] = {
      wagerPerHand,
      wagerUnits: wagerPerHand * hands.length,
      payoutUnits: results.reduce((total, result) => total + result.payoutUnits, 0),
      results,
    };
  }
  return state;
}

function blackjackRoundResponse(row) {
  if (!row) return null;
  const { dealer, hands } = blackjackState(row);
  const settled = row.status === "settled";
  const visibleDealer = dealer.map((cardId, index) => !settled && index === 1 ? { hidden: true } : blackjackCard(cardId));
  const dealerValue = settled ? blackjackHandValue(dealer) : blackjackHandValue(dealer.slice(0, 1));
  return {
    id: row.id,
    game: "blackjack",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    baseWager: assetUnitsToString(Number(row.base_wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    handCount: Number(row.hand_count || 1),
    sideWager: assetUnitsToString(Number(row.side_wager_units || 0), false),
    sidePayout: assetUnitsToString(Number(row.side_payout_units || 0), false),
    sideBets: blackjackSideResponse(row),
    multiplier: Number(row.multiplier_micros || 0) / 1_000_000,
    status: row.status,
    outcome: row.outcome || null,
    activeHand: Number(row.active_hand),
    dealer: { cards: visibleDealer, total: dealerValue.total, soft: dealerValue.soft },
    hands: hands.map((hand, index) => {
      const value = blackjackHandValue(hand.cards);
      return {
        index,
        seat: Number.isInteger(Number(hand.seat)) ? Number(hand.seat) : index,
        cards: hand.cards.map(blackjackCard),
        total: value.total,
        soft: value.soft,
        blackjack: value.blackjack,
        bust: value.bust,
        doubled: Boolean(hand.doubled),
        status: hand.status,
        wager: assetUnitsToString(Number(hand.wagerUnits), false),
        payout: assetUnitsToString(Number(hand.payoutUnits || 0), false),
      };
    }),
    actions: blackjackAvailableActions(row, hands),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

async function settleBlackjackRound(env, row, state, timestamp = now(), forced = null) {
  if (!row || row.status !== "active") return row;
  const { shoe, dealer, hands } = state;
  let shoePosition = Number(row.shoe_position);
  let payoutUnits = Number(row.side_payout_units || 0);
  let outcome = "loss";

  if (!forced && hands.some((hand) => hand.status === "playing")) return row;

  if (forced === "dealer") {
    if (hands.some((hand) => !["bust", "blackjack", "loss"].includes(hand.status))) {
      while (true) {
        const value = blackjackHandValue(dealer);
        if (value.total >= 17) break;
        dealer.push(shoe[shoePosition]);
        shoePosition += 1;
      }
    }
    const dealerValue = blackjackHandValue(dealer);
    for (const hand of hands) {
      if (hand.status === "blackjack") { payoutUnits += Number(hand.payoutUnits || 0); continue; }
      const value = blackjackHandValue(hand.cards);
      let handPayout = 0;
      if (value.bust) hand.status = "loss";
      else if (dealerValue.bust || value.total > dealerValue.total) { hand.status = "win"; handPayout = Number(hand.wagerUnits) * 2; }
      else if (value.total === dealerValue.total) { hand.status = "push"; handPayout = Number(hand.wagerUnits); }
      else hand.status = "loss";
      hand.payoutUnits = handPayout;
      payoutUnits += handPayout;
    }
  } else {
    payoutUnits += hands.reduce((total, hand) => total + Number(hand.payoutUnits || 0), 0);
  }

  if (payoutUnits > Number(row.wager_units)) outcome = "win";
  else if (payoutUnits === Number(row.wager_units)) outcome = "push";
  const multiplierMicros = Number(row.wager_units) > 0 ? Math.floor(payoutUnits * 1_000_000 / Number(row.wager_units)) : 0;
  const token = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE blackjack_rounds SET shoe_json = ?, shoe_position = ?, dealer_cards_json = ?, player_hands_json = ?,
        payout_units = ?, multiplier_micros = ?, outcome = ?, status = 'settled', settlement_token = ?, updated_at = ?, settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'active'
    `).bind(JSON.stringify(shoe), shoePosition, JSON.stringify(dealer), JSON.stringify(hands), payoutUnits, multiplierMicros, outcome, token, timestamp, timestamp, row.id, row.uid),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(
        SELECT 1 FROM blackjack_rounds WHERE id = ? AND settlement_token = ? AND status = 'settled'
      )
    `).bind(payoutUnits, timestamp, row.uid, row.currency, row.id, token),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'blackjack_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM blackjack_rounds WHERE id = ? AND settlement_token = ? AND status = 'settled' AND payout_units > 0
    `).bind(timestamp, row.id, token),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) return env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ?").bind(row.id).first();
  return env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ?").bind(row.id).first();
}

async function handleGetActiveBlackjackRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  let row = await env.DB.prepare(`
    SELECT * FROM blackjack_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  if (row) row = await settleBlackjackRound(env, row, blackjackState(row));
  return json(request, env, 200, { round: blackjackRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartBlackjackRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: blackjackRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: blackjackRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const displayFiat = body.displayFiat === true;
  const handCount = Number(body.handCount || 1);
  if (!Number.isInteger(handCount) || handCount < 1 || handCount > 3) throw httpError(400, "Choose one, two, or three Blackjack hands");
  const baseWagerUnits = await gameWagerUnits(env, asset, body.wager, displayFiat);
  const sideInput = body.sideBets && typeof body.sideBets === "object" && !Array.isArray(body.sideBets) ? body.sideBets : {};
  const sideWagerUnits = async (value) => {
    if (value === undefined || value === null || String(value).trim() === "" || Number(value) === 0) return 0;
    return gameWagerUnits(env, asset, value, displayFiat);
  };
  const perfectPairsWager = await sideWagerUnits(sideInput.perfectPairs);
  const twentyOnePlusThreeWager = await sideWagerUnits(sideInput.twentyOnePlusThree);
  const shoe = blackjackShoe();
  let shoePosition = 0;
  const hands = Array.from({ length: handCount }, (_, seat) => ({ seat, cards: [shoe[shoePosition++]], status: "playing", doubled: false, wagerUnits: baseWagerUnits, payoutUnits: 0 }));
  const dealerCards = [shoe[shoePosition++]];
  hands.forEach((hand) => hand.cards.push(shoe[shoePosition++]));
  dealerCards.push(shoe[shoePosition++]);
  const dealerNatural = blackjackHandValue(dealerCards).blackjack;
  hands.forEach((hand) => {
    const natural = blackjackHandValue(hand.cards).blackjack;
    if (dealerNatural) {
      hand.status = natural ? "push" : "loss";
      hand.payoutUnits = natural ? baseWagerUnits : 0;
    } else if (natural) {
      hand.status = "blackjack";
      hand.payoutUnits = payoutFromMultiplier(baseWagerUnits, 2_500_000);
    }
  });
  let sideState;
  let totalSideWager;
  let totalSidePayout;
  let wagerUnits;
  try {
    sideState = blackjackSideStateForHands(hands, dealerCards[0], perfectPairsWager, twentyOnePlusThreeWager);
    totalSideWager = Object.values(sideState).reduce((total, bet) => total + bet.wagerUnits, 0);
    totalSidePayout = Object.values(sideState).reduce((total, bet) => total + bet.payoutUnits, 0);
    wagerUnits = baseWagerUnits * handCount + totalSideWager;
    const maximumMainPayout = payoutFromMultiplier(baseWagerUnits * handCount, 2_500_000);
    if (![wagerUnits, totalSidePayout, maximumMainPayout + totalSidePayout].every(Number.isSafeInteger)) throw new Error("That Blackjack wager is too large");
  } catch (error) { throw httpError(400, error.message || "That Blackjack wager is too large"); }
  const activeHand = hands.findIndex((hand) => hand.status === "playing");
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO blackjack_rounds(
        id, request_id, uid, currency, base_wager_units, wager_units, hand_count, side_wager_units,
        side_payout_units, side_bets_json, shoe_json, shoe_position, dealer_cards_json,
        player_hands_json, active_hand, split_hand, status, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?
      FROM crypto_balances WHERE uid = ? AND currency = ? AND available_units >= ?
        AND NOT EXISTS(SELECT 1 FROM blackjack_rounds WHERE uid = ? AND currency = ? AND status = 'active')
    `).bind(id, requestId, user.sub, asset.code, baseWagerUnits, wagerUnits, handCount, totalSideWager, totalSidePayout, JSON.stringify(sideState), JSON.stringify(shoe), shoePosition, JSON.stringify(dealerCards), JSON.stringify(hands), Math.max(0, activeHand), timestamp, timestamp, user.sub, asset.code, wagerUnits, user.sub, asset.code),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM blackjack_rounds WHERE id = ?)
    `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
    env.DB.prepare(`
      INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'blackjack_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
      FROM blackjack_rounds WHERE id = ?
    `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Finish your active Blackjack hand or check your available balance");
    let row = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ?").bind(id).first();
    if (dealerNatural || activeHand < 0) row = await settleBlackjackRound(env, row, blackjackState(row), timestamp, "initial");
    return json(request, env, 201, { round: blackjackRoundResponse(row), wallet: await walletResponse(env, user.sub) });
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: blackjackRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const current = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
    if (current) return json(request, env, 200, { round: blackjackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
}

async function handleBlackjackAction(request, env, user, roundIdValue) {
  const roundId = String(roundIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(roundId)) throw httpError(400, "Invalid Blackjack round");
  const body = await requestJson(request);
  const actionId = normalizeRequestId(body.requestId);
  const action = String(body.action || "").toLowerCase();
  if (!["hit", "stand", "double", "split"].includes(action)) throw httpError(400, "Choose a valid Blackjack action");
  let row = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (!row) throw httpError(404, "That Blackjack round was not found");
  if (row.status !== "active" || row.last_action_id === actionId) return json(request, env, 200, { round: blackjackRoundResponse(row), wallet: await walletResponse(env, user.sub) });

  const state = blackjackState(row);
  const handIndex = Number(row.active_hand);
  const hand = state.hands[handIndex];
  const allowed = blackjackAvailableActions(row, state.hands);
  if (!allowed.includes(action)) throw httpError(409, "That action is not available for this hand");
  let shoePosition = Number(row.shoe_position);
  let activeHand = handIndex;
  let extraWager = 0;

  if (action === "hit") {
    hand.cards.push(state.shoe[shoePosition]);
    shoePosition += 1;
    const value = blackjackHandValue(hand.cards);
    if (value.bust) hand.status = "bust";
    else if (value.total === 21) hand.status = "stood";
  } else if (action === "stand") hand.status = "stood";
  else if (action === "double") {
    extraWager = Number(hand.wagerUnits);
    hand.wagerUnits += extraWager;
    hand.doubled = true;
    hand.cards.push(state.shoe[shoePosition]);
    shoePosition += 1;
    hand.status = blackjackHandValue(hand.cards).bust ? "bust" : "stood";
  } else {
    extraWager = Number(hand.wagerUnits);
    const first = hand.cards[0];
    const second = hand.cards[1];
    const splitAces = Number(first) % 13 === 0;
    const seat = Number.isInteger(Number(hand.seat)) ? Number(hand.seat) : activeHand;
    state.hands.splice(activeHand, 1,
      { seat, cards: [first, state.shoe[shoePosition]], status: splitAces ? "stood" : "playing", doubled: false, wagerUnits: extraWager, payoutUnits: 0 },
      { seat, cards: [second, state.shoe[shoePosition + 1]], status: splitAces ? "stood" : "playing", doubled: false, wagerUnits: extraWager, payoutUnits: 0 },
    );
    shoePosition += 2;
  }

  if (state.hands[activeHand]?.status !== "playing") {
    const next = state.hands.findIndex((candidate, index) => index > activeHand && candidate.status === "playing");
    activeHand = next >= 0 ? next : state.hands.length;
  }
  const timestamp = now();
  const nextWager = Number(row.wager_units) + extraWager;
  const statements = [env.DB.prepare(`
    UPDATE blackjack_rounds SET shoe_position = ?, dealer_cards_json = ?, player_hands_json = ?, active_hand = ?,
      split_hand = ?, wager_units = ?, last_action_id = ?, updated_at = ?
    WHERE id = ? AND uid = ? AND status = 'active' AND updated_at = ?
      AND (? = 0 OR EXISTS(SELECT 1 FROM crypto_balances WHERE uid = ? AND currency = ? AND available_units >= ?))
  `).bind(shoePosition, JSON.stringify(state.dealer), JSON.stringify(state.hands), activeHand, state.hands.length > 1 ? 1 : Number(row.split_hand), nextWager, actionId, timestamp, roundId, user.sub, Number(row.updated_at), extraWager, user.sub, row.currency, extraWager)];
  if (extraWager > 0) {
    statements.push(env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(
        SELECT 1 FROM blackjack_rounds WHERE id = ? AND uid = ? AND last_action_id = ? AND updated_at = ?
      )
    `).bind(extraWager, timestamp, user.sub, row.currency, roundId, user.sub, actionId, timestamp));
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'blackjack_extra_' || ?, uid, currency, 'game_wager', ?, id, ?
      FROM blackjack_rounds WHERE id = ? AND uid = ? AND last_action_id = ? AND updated_at = ?
    `).bind(actionId, -extraWager, timestamp, roundId, user.sub, actionId, timestamp));
  }
  const results = await env.DB.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
    if (row?.last_action_id !== actionId) throw httpError(409, extraWager > 0 ? "Your available balance is too low for that action" : "That hand has already changed");
  } else row = await env.DB.prepare("SELECT * FROM blackjack_rounds WHERE id = ?").bind(roundId).first();

  if (row.status === "active" && Number(row.active_hand) >= blackjackState(row).hands.length) {
    row = await settleBlackjackRound(env, row, blackjackState(row), timestamp, "dealer");
  }
  return json(request, env, 200, { round: blackjackRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

function coinflipHistory(row) {
  try {
    const parsed = JSON.parse(String(row?.flip_history || "[]"));
    return Array.isArray(parsed) ? parsed.filter((flip) => ["heads", "tails"].includes(flip?.choice) && ["heads", "tails"].includes(flip?.result)) : [];
  } catch { return []; }
}

function coinflipRoundResponse(row) {
  if (!row) return null;
  const canFlip = Number(row.streak) < 20;
  const nextMultiplierMicros = canFlip ? coinflipMultiplierMicros(Number(row.streak) + 1, Number(row.house_factor_micros || 990_000)) : Number(row.multiplier_micros);
  return {
    id: row.id,
    game: "coinflip",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    streak: Number(row.streak),
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    nextMultiplier: nextMultiplierMicros / 1_000_000,
    canFlip,
    lastResult: row.last_result || null,
    flips: coinflipHistory(row),
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleGetActiveCoinflipRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM coinflip_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: coinflipRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartCoinflipRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: coinflipRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: coinflipRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "coinflip");
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO coinflip_rounds(
          id, request_id, uid, currency, wager_units, payout_units, streak,
          multiplier_micros, house_factor_micros, flip_history, status, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, 0, 0, 1000000, ?, '[]', 'active', ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
          AND NOT EXISTS(SELECT 1 FROM coinflip_rounds WHERE uid = ? AND currency = ? AND status = 'active')
      `).bind(id, requestId, user.sub, asset.code, wagerUnits, houseFactorMicros, timestamp, timestamp, user.sub, asset.code, wagerUnits, user.sub, asset.code),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM coinflip_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'coinflip_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM coinflip_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      const current = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
      if (current) return json(request, env, 200, { round: coinflipRoundResponse(current), wallet: await walletResponse(env, user.sub) });
      throw httpError(409, "Your available balance is too low");
    }
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: coinflipRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: coinflipRoundResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function handleCoinflipGuess(request, env, user, roundIdValue) {
  const roundId = String(roundIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(roundId)) throw httpError(400, "Invalid Coinflip round");
  const body = await requestJson(request);
  const choice = String(body.choice || "").toLowerCase();
  if (!["heads", "tails"].includes(choice)) throw httpError(400, "Choose heads or tails");
  const row = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (!row) throw httpError(404, "That Coinflip round was not found");
  if (row.status !== "active") return json(request, env, 200, { round: coinflipRoundResponse(row), wallet: await walletResponse(env, user.sub) });
  if (Number(row.streak) >= 20) throw httpError(409, "Cash out this maximum streak");
  const resultSide = secureRandomInt(2) === 0 ? "heads" : "tails";
  const won = choice === resultSide;
  const nextStreak = won ? Number(row.streak) + 1 : Number(row.streak);
  const multiplierMicros = won ? coinflipMultiplierMicros(nextStreak, Number(row.house_factor_micros || 990_000)) : Number(row.multiplier_micros);
  const payoutUnits = won ? payoutFromMultiplier(Number(row.wager_units), multiplierMicros) : 0;
  const flips = coinflipHistory(row);
  flips.push({ choice, result: resultSide, won });
  const timestamp = now();
  const update = await env.DB.prepare(`
    UPDATE coinflip_rounds SET streak = ?, multiplier_micros = ?, payout_units = ?, last_result = ?,
      flip_history = ?, status = ?, updated_at = ?, settled_at = ?
    WHERE id = ? AND uid = ? AND status = 'active' AND updated_at = ?
  `).bind(nextStreak, multiplierMicros, payoutUnits, resultSide, JSON.stringify(flips), won ? "active" : "lost", timestamp, won ? null : timestamp, roundId, user.sub, Number(row.updated_at)).run();
  const updated = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (Number(update.meta?.changes || 0) !== 1 && updated?.status === "active") throw httpError(409, "That coin has already been flipped");
  return json(request, env, 200, { round: coinflipRoundResponse(updated), wallet: await walletResponse(env, user.sub) });
}

async function handleCoinflipCashout(request, env, user, roundIdValue) {
  const roundId = String(roundIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(roundId)) throw httpError(400, "Invalid Coinflip round");
  let row = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  if (!row) throw httpError(404, "That Coinflip round was not found");
  if (row.status === "cashed_out") return json(request, env, 200, { round: coinflipRoundResponse(row), wallet: await walletResponse(env, user.sub) });
  if (row.status !== "active" || Number(row.streak) < 1) throw httpError(409, "Win at least one flip before cashing out");
  const timestamp = now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE coinflip_rounds SET status = 'cashed_out', updated_at = ?, settled_at = ? WHERE id = ? AND uid = ? AND status = 'active'").bind(timestamp, timestamp, roundId, user.sub),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM coinflip_rounds WHERE id = ? AND uid = ? AND status = 'cashed_out' AND settled_at = ?)
    `).bind(Number(row.payout_units), timestamp, user.sub, row.currency, roundId, user.sub, timestamp),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'coinflip_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM coinflip_rounds WHERE id = ? AND uid = ? AND status = 'cashed_out' AND settled_at = ? AND payout_units > 0
    `).bind(timestamp, roundId, user.sub, timestamp),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    row = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
    if (row?.status !== "cashed_out") throw httpError(409, "That Coinflip round could not be cashed out");
  }
  row = await env.DB.prepare("SELECT * FROM coinflip_rounds WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  return json(request, env, 200, { round: coinflipRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

const CRASH_BETTING_MS = 8_000;
const CRASH_POST_CRASH_MS = 3_000;
const CRASH_ROUND_BUCKET_MS = 5_000;
const CRASH_MAX_CATCHUP_ROUNDS = 24;
const CRASH_MAX_IDLE_CATCHUP_MS = 5 * 60 * 1000;

function crashRoundId(startsAt) {
  return `crash_${startsAt}`;
}

function crashPhase(row, timestamp = now()) {
  if (timestamp < Number(row.launches_at)) return "betting";
  if (timestamp < Number(row.crashes_at)) return "flying";
  return "crashed";
}

function crashCurrentMultiplier(row, timestamp = now()) {
  if (timestamp < Number(row.launches_at)) return 1_000_000;
  return Math.min(Number(row.crash_multiplier_micros), crashMultiplierMicros(timestamp - Number(row.launches_at)));
}

async function createCrashRound(env, startsAt, createdAt = now(), settleBefore = 0) {
  const houseFactorMicros = await gameHouseFactorMicros(env, "crash");
  const crashMultiplierMicrosValue = crashPointMicros(secureRandomInt(1_000_000) + 1, houseFactorMicros);
  const launchesAt = startsAt + CRASH_BETTING_MS;
  const crashesAt = launchesAt + crashDurationMs(crashMultiplierMicrosValue);
  const endsAt = crashesAt + CRASH_POST_CRASH_MS;
  const settled = settleBefore > 0 && endsAt <= settleBefore;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO crash_live_rounds(
      id, starts_at, launches_at, crashes_at, ends_at, crash_multiplier_micros,
      house_factor_micros, status, created_at, settled_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crashRoundId(startsAt), startsAt, launchesAt, crashesAt, endsAt,
    crashMultiplierMicrosValue, houseFactorMicros, settled ? "settled" : "open", createdAt,
    settled ? endsAt : null,
  ).run();
  return env.DB.prepare("SELECT * FROM crash_live_rounds WHERE starts_at = ?").bind(startsAt).first();
}

async function ensureCrashRound(env, timestamp = now()) {
  let row = await env.DB.prepare(`
    SELECT * FROM crash_live_rounds
    WHERE starts_at <= ? AND ends_at > ?
    ORDER BY starts_at DESC LIMIT 1
  `).bind(timestamp, timestamp).first();
  if (row) return row;

  let latest = await env.DB.prepare("SELECT * FROM crash_live_rounds ORDER BY starts_at DESC LIMIT 1").first();
  const bucketStart = Math.floor(timestamp / CRASH_ROUND_BUCKET_MS) * CRASH_ROUND_BUCKET_MS;
  let startsAt = latest ? Number(latest.ends_at) : bucketStart;

  // A deployment can inherit an arbitrarily old final round. Do not make clients
  // replay days of empty flights; anchor the first maintained flight to real time.
  if (latest && timestamp - startsAt > CRASH_MAX_IDLE_CATCHUP_MS) startsAt = bucketStart;

  for (let index = 0; index < CRASH_MAX_CATCHUP_ROUNDS; index += 1) {
    row = await createCrashRound(env, startsAt, timestamp, timestamp);
    if (!row) break;
    if (Number(row.starts_at) <= timestamp && Number(row.ends_at) > timestamp) return row;
    startsAt = Number(row.ends_at);
  }

  // Safety valve for an unusually long Worker outage. Future scheduled runs keep
  // the chain continuous; this branch only prevents a stale response today.
  row = await createCrashRound(env, bucketStart, timestamp, 0);
  if (!row) throw httpError(503, "The Crash round could not be opened");
  return row;
}

async function settleCrashAutomaticWagers(env, row, multiplierMicros, timestamp = now()) {
  const automatic = await env.DB.prepare(`
    SELECT * FROM crash_wagers
    WHERE round_id = ? AND status = 'open' AND auto_cashout_micros IS NOT NULL
      AND auto_cashout_micros <= ?
    ORDER BY created_at ASC LIMIT 200
  `).bind(row.id, multiplierMicros).all();
  for (const wager of automatic.results || []) {
    await settleCrashWager(env, wager, Number(wager.auto_cashout_micros), timestamp);
  }
}

async function settleCrashWager(env, wager, multiplierMicros, timestamp = now()) {
  if (!wager || wager.status !== "open") return wager;
  const payoutUnits = payoutFromMultiplier(Number(wager.wager_units), Number(multiplierMicros));
  const token = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE crash_wagers SET status = 'cashed_out', payout_units = ?, multiplier_micros = ?,
        settlement_token = ?, settled_at = ?
      WHERE id = ? AND status = 'open'
    `).bind(payoutUnits, multiplierMicros, token, timestamp, wager.id),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND EXISTS(
        SELECT 1 FROM crash_wagers WHERE id = ? AND settlement_token = ? AND status = 'cashed_out'
      )
    `).bind(payoutUnits, timestamp, wager.uid, wager.currency, wager.id, token),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'crash_payout_' || id, uid, currency, 'game_payout', payout_units, round_id, ?
      FROM crash_wagers WHERE id = ? AND settlement_token = ? AND status = 'cashed_out'
    `).bind(timestamp, wager.id, token),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) return env.DB.prepare("SELECT * FROM crash_wagers WHERE id = ?").bind(wager.id).first();
  return env.DB.prepare("SELECT * FROM crash_wagers WHERE id = ?").bind(wager.id).first();
}

async function settleCrashRoundIfDue(env, row, timestamp = now()) {
  if (!row || timestamp < Number(row.crashes_at) || row.status === "settled") return row;
  await settleCrashAutomaticWagers(env, row, Number(row.crash_multiplier_micros), timestamp);
  const token = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE crash_live_rounds SET status = 'settling', settlement_token = ?, settled_at = ?
      WHERE id = ? AND status = 'open'
    `).bind(token, timestamp, row.id),
    env.DB.prepare(`
      UPDATE crash_wagers SET status = 'lost', payout_units = 0, multiplier_micros = 0, settled_at = ?
      WHERE round_id = ? AND status = 'open'
    `).bind(timestamp, row.id),
    env.DB.prepare(`
      UPDATE crash_live_rounds SET status = 'settled'
      WHERE id = ? AND status IN ('open', 'settling')
    `).bind(row.id),
  ]);
  return env.DB.prepare("SELECT * FROM crash_live_rounds WHERE id = ?").bind(row.id).first();
}

async function settleDueCrashRounds(env, timestamp = now()) {
  const due = await env.DB.prepare(`
    SELECT * FROM crash_live_rounds
    WHERE status <> 'settled' AND crashes_at <= ?
    ORDER BY crashes_at ASC LIMIT 100
  `).bind(timestamp).all();
  for (const round of due.results || []) await settleCrashRoundIfDue(env, round, timestamp);
}

async function maintainCrashTimeline(env, timestamp = now()) {
  await settleDueCrashRounds(env, timestamp);
  const round = await ensureCrashRound(env, timestamp);
  if (crashPhase(round, timestamp) === "flying") {
    await settleCrashAutomaticWagers(env, round, crashCurrentMultiplier(round, timestamp), timestamp);
  }
  return settleCrashRoundIfDue(env, round, timestamp);
}

function crashWagerResponse(row) {
  return {
    id: row.id,
    slot: Number(row.slot),
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    autoCashout: row.auto_cashout_micros == null ? null : Number(row.auto_cashout_micros) / 1_000_000,
    multiplier: Number(row.multiplier_micros || 0) / 1_000_000,
    status: row.status,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function crashRecent(env) {
  const cached = gameHistoryCache.get("crash:recent");
  if (cached && cached.expiresAt > now()) return cached.value;
  const result = await env.DB.prepare(`
    SELECT crash_multiplier_micros FROM crash_live_rounds
    WHERE status = 'settled' ORDER BY starts_at DESC LIMIT 10
  `).all();
  const value = (result.results || []).map((entry) => Number(entry.crash_multiplier_micros) / 1_000_000);
  rememberWithLimit(gameHistoryCache, "crash:recent", { value, expiresAt: now() + 2_000 }, 100);
  return value;
}

async function crashRoundResponse(env, row, user, currency, timestamp = now()) {
  if (!row) return null;
  const phase = crashPhase(row, timestamp);
  const wagerResult = currency ? await env.DB.prepare(`
    SELECT * FROM crash_wagers WHERE round_id = ? AND uid = ? AND currency = ? ORDER BY slot ASC
  `).bind(row.id, user.sub, currency).all() : { results: [] };
  return {
    id: row.id,
    game: "crash",
    phase,
    startsAtMs: Number(row.starts_at),
    launchesAtMs: Number(row.launches_at),
    crashesAtMs: phase === "crashed" ? Number(row.crashes_at) : null,
    endsAtMs: phase === "crashed" ? Number(row.ends_at) : null,
    currentMultiplier: crashCurrentMultiplier(row, timestamp) / 1_000_000,
    crashMultiplier: phase === "crashed" ? Number(row.crash_multiplier_micros) / 1_000_000 : null,
    wagers: (wagerResult.results || []).map(crashWagerResponse),
  };
}

async function handleCrashLive(request, env, user) {
  const timestamp = now();
  const currencyValue = new URL(request.url).searchParams.get("currency");
  const currency = currencyValue ? normalizeCurrency(currencyValue) : "";
  const round = await maintainCrashTimeline(env, timestamp);
  return json(request, env, 200, {
    serverNow: timestamp,
    round: await crashRoundResponse(env, round, user, currency, timestamp),
    recent: await crashRecent(env),
  });
}

async function handleCrashWager(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) throw httpError(400, "Choose a valid Crash bet slot");
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const existing = await env.DB.prepare("SELECT * FROM crash_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  const timestamp = now();
  if (existing) {
    const storedRound = await env.DB.prepare("SELECT * FROM crash_live_rounds WHERE id = ?").bind(existing.round_id).first();
    return json(request, env, 200, { serverNow: timestamp, round: await crashRoundResponse(env, storedRound, user, asset.code, timestamp), wallet: await walletResponse(env, user.sub) });
  }
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  if (wagerUnits > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) throw httpError(400, "That Crash wager is too large for the 1,000× maximum payout");
  let autoCashoutMicros = null;
  if (body.autoCashout !== null && body.autoCashout !== undefined && String(body.autoCashout).trim() !== "") {
    const value = Number(body.autoCashout);
    autoCashoutMicros = Math.round(value * 1_000_000);
    if (!Number.isInteger(autoCashoutMicros) || autoCashoutMicros < 1_010_000 || autoCashoutMicros > 1_000_000_000) throw httpError(400, "Auto cash out must be between 1.01× and 1,000×");
  }
  const round = await ensureCrashRound(env, timestamp);
  if (timestamp >= Number(round.launches_at) - 200) throw httpError(409, "Betting has closed for this flight");
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO crash_wagers(
          id, request_id, round_id, uid, currency, slot, wager_units, auto_cashout_micros, status, created_at
        )
        SELECT ?, ?, flight.id, ?, ?, ?, ?, ?, 'open', ?
        FROM crash_live_rounds AS flight
        JOIN crypto_balances AS balance ON balance.uid = ? AND balance.currency = ?
        WHERE flight.id = ? AND flight.status = 'open' AND flight.launches_at > ?
          AND balance.available_units >= ?
      `).bind(id, requestId, user.sub, asset.code, slot, wagerUnits, autoCashoutMicros, timestamp, user.sub, asset.code, round.id, timestamp, wagerUnits),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM crash_wagers WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'crash_wager_' || id, uid, currency, 'game_wager', -wager_units, round_id, created_at
        FROM crash_wagers WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "That slot is already placed, betting has closed, or your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM crash_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (!duplicate) throw error;
  }
  return json(request, env, 201, {
    serverNow: timestamp,
    round: await crashRoundResponse(env, round, user, asset.code, timestamp),
    wallet: await walletResponse(env, user.sub),
  });
}

async function handleCrashCashout(request, env, user, wagerIdValue) {
  const wagerId = String(wagerIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{12,80}$/.test(wagerId)) throw httpError(400, "Invalid Crash wager");
  let wager = await env.DB.prepare("SELECT * FROM crash_wagers WHERE id = ? AND uid = ?").bind(wagerId, user.sub).first();
  if (!wager) throw httpError(404, "That Crash wager was not found");
  if (wager.status === "cashed_out") return json(request, env, 200, { wager: crashWagerResponse(wager), wallet: await walletResponse(env, user.sub) });
  if (wager.status !== "open") throw httpError(409, "That rocket has already crashed");
  const round = await env.DB.prepare("SELECT * FROM crash_live_rounds WHERE id = ?").bind(wager.round_id).first();
  const timestamp = now();
  if (!round || crashPhase(round, timestamp) !== "flying") throw httpError(409, "Cash out is only available while the rocket is flying");
  const multiplierMicros = crashCurrentMultiplier(round, timestamp);
  wager = await settleCrashWager(env, wager, multiplierMicros, timestamp);
  return json(request, env, 200, {
    serverNow: timestamp,
    wager: crashWagerResponse(wager),
    round: await crashRoundResponse(env, round, user, wager.currency, timestamp),
    wallet: await walletResponse(env, user.sub),
  });
}

async function handleGameHistory(request, env, user) {
  const url = new URL(request.url);
  const game = String(url.searchParams.get("game") || "").toLowerCase();
  const view = url.searchParams.get("view") === "lucky" ? "lucky" : "top";
  const period = ["30d", "90d"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "lifetime";
  const games = {
    dice: { table: "dice_bets", where: "1 = 1" },
    mines: { table: "mines_rounds", where: "b.status <> 'active'" },
    plinko: { table: "plinko_bets", where: "1 = 1" },
    roulette: { table: "roulette_rounds", where: "1 = 1" },
    keno: { table: "keno_bets", where: "b.status = 'settled'" },
    wheel: { table: "wheel_bets", where: "b.status = 'settled'" },
    "hi-lo": { table: "hilo_rounds", where: "b.status = 'cashed_out'" },
    coinflip: { table: "coinflip_rounds", where: "b.status = 'cashed_out'" },
    crash: { table: "crash_wagers", where: "b.status = 'cashed_out'" },
    blackjack: { table: "blackjack_rounds", where: "b.status = 'settled'" },
    towers: { table: "towers_rounds", where: "b.status IN ('cashed_out', 'won')" },
    moles: { table: "moles_rounds", where: "b.status IN ('cashed_out', 'won')" },
    limbo: { table: "limbo_bets", where: "1 = 1" },
    stack: { table: "stack_rounds", where: "b.status IN ('cashed_out', 'won')" },
  };
  const config = games[game];
  if (!config) throw httpError(400, "Choose a valid game history");
  const cutoff = period === "30d" ? now() - 30 * 86_400_000 : period === "90d" ? now() - 90 * 86_400_000 : 0;
  const order = view === "lucky" ? "b.multiplier_micros DESC, b.payout_units DESC, b.created_at DESC" : "b.payout_units DESC, b.multiplier_micros DESC, b.created_at DESC";
  const cacheKey = `history:${game}:${view}:${period}`;
  const cached = gameHistoryCache.get(cacheKey);
  let rows = cached?.expiresAt > now() ? cached.value : null;
  if (!rows) {
    const result = await env.DB.prepare(`
      SELECT b.id, b.uid, COALESCE(NULLIF(p.username, ''), 'Player') AS username,
        COALESCE(p.profile_public, 1) AS profile_public,
        COALESCE(p.show_username, 1) AS show_username,
        COALESCE(p.show_rank, 1) AS show_rank,
        b.currency, b.wager_units, b.payout_units, b.multiplier_micros, b.created_at
      FROM ${config.table} AS b
      LEFT JOIN player_profiles AS p ON p.uid = b.uid
      WHERE ${config.where} AND b.created_at >= ?
        AND b.payout_units > b.wager_units AND b.multiplier_micros > 1000000
      ORDER BY ${order} LIMIT 3
    `).bind(cutoff).all();
    rows = result.results || [];
    rememberWithLimit(gameHistoryCache, cacheKey, { value: rows, expiresAt: now() + GAME_HISTORY_CACHE_MS }, 100);
  }
  const entries = rows.map((row, index) => {
    const isYou = row.uid === user.sub;
    const profileVisible = isYou || Boolean(row.profile_public);
    const usernameVisible = isYou || (profileVisible && Boolean(row.show_username));
    const rankVisible = isYou || (profileVisible && Boolean(row.show_rank));
    return {
      rank: index + 1,
      username: usernameVisible ? row.username : "Hidden Player",
      usernameHidden: !usernameVisible,
      profileVisible: profileVisible && usernameVisible,
      isYou,
      playerRank: rankVisible ? { id: "rookie-i", label: "Rookie I", badgePath: "/ranks/rookie-i.webp" } : null,
      currency: row.currency,
      wager: assetUnitsToString(Number(row.wager_units), false),
      payout: assetUnitsToString(Number(row.payout_units), false),
      multiplier: Number(row.multiplier_micros) / 1_000_000,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    };
  });
  return json(request, env, 200, { game, view, period, entries, refreshedAt: new Date(now()).toISOString() });
}

function rouletteBetResponse(row) {
  let bets = {};
  try {
    const parsed = JSON.parse(String(row.bets_json || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      bets = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, assetUnitsToString(Number(value), false)]));
    }
  } catch { bets = {}; }
  return {
    id: row.id,
    game: "roulette",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units), false),
    net: assetUnitsToString(Math.abs(Number(row.payout_units) - Number(row.wager_units)), false),
    netDirection: Number(row.payout_units) >= Number(row.wager_units) ? "credit" : "debit",
    bets,
    result: row.result,
    multiplier: Number(row.multiplier_micros) / 1_000_000,
    winningMultiplier: Number(row.winning_multiplier_micros) / 1_000_000,
    outcome: row.outcome,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

const ROULETTE_BETTING_MS = 12_000;
const ROULETTE_ANIMATION_MS = 8_000;
const ROULETTE_CYCLE_MS = ROULETTE_BETTING_MS + ROULETTE_ANIMATION_MS;
const ROULETTE_MAX_CATCHUP_ROUNDS = 10;

async function rouletteRecent(env) {
  const cached = gameHistoryCache.get("roulette:recent");
  if (cached && cached.expiresAt > now()) return cached.value;
  const result = await env.DB.prepare(`
    SELECT result FROM roulette_live_rounds
    WHERE status = 'settled'
    ORDER BY settled_at DESC LIMIT 100
  `).all();
  const results = (result.results || []).map((row) => String(row.result || "")).filter((value) => ["blue", "cyan", "purple", "gold"].includes(value));
  const counts = { blue: 0, cyan: 0, purple: 0, gold: 0 };
  results.forEach((value) => { counts[value] += 1; });
  const value = { counts, results: results.slice(0, 10), total: results.length };
  rememberWithLimit(gameHistoryCache, "roulette:recent", { value, expiresAt: now() + 2_000 }, 100);
  return value;
}

async function ensureSharedRouletteRound(env, timestamp = now()) {
  const startsAt = Math.floor(timestamp / ROULETTE_CYCLE_MS) * ROULETTE_CYCLE_MS;
  return createSharedRouletteRound(env, startsAt, timestamp, false);
}

async function createSharedRouletteRound(env, startsAt, createdAt = now(), settled = false) {
  const closesAt = startsAt + ROULETTE_BETTING_MS;
  const endsAt = startsAt + ROULETTE_CYCLE_MS;
  const id = `roulette_${startsAt}`;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO roulette_live_rounds(
      id, starts_at, closes_at, ends_at, result, landing_basis_points, status, created_at, settled_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, startsAt, closesAt, endsAt, secureRouletteResult(), secureRandomInt(6401) - 3200,
    settled ? "settled" : "open", createdAt, settled ? endsAt : null,
  ).run();
  return env.DB.prepare("SELECT * FROM roulette_live_rounds WHERE id = ?").bind(id).first();
}

async function backfillSharedRouletteRounds(env, timestamp = now()) {
  const currentStartsAt = Math.floor(timestamp / ROULETTE_CYCLE_MS) * ROULETTE_CYCLE_MS;
  const latest = await env.DB.prepare("SELECT starts_at FROM roulette_live_rounds ORDER BY starts_at DESC LIMIT 1").first();
  let startsAt = latest ? Number(latest.starts_at) + ROULETTE_CYCLE_MS : currentStartsAt;
  const earliest = currentStartsAt - (ROULETTE_MAX_CATCHUP_ROUNDS - 1) * ROULETTE_CYCLE_MS;
  if (startsAt < earliest) startsAt = earliest;
  for (; startsAt <= currentStartsAt; startsAt += ROULETTE_CYCLE_MS) {
    await createSharedRouletteRound(env, startsAt, timestamp, startsAt < currentStartsAt);
  }
  return ensureSharedRouletteRound(env, timestamp);
}

async function settleSharedRouletteRound(env, round, timestamp = now()) {
  if (!round || timestamp < Number(round.closes_at) || round.status === "settled") return round;
  const token = crypto.randomUUID();
  const multiplierMicros = round.result === "gold" ? 14_000_000 : round.result === "purple" ? 7_000_000 : 2_000_000;
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE roulette_live_rounds
      SET status = 'settling', settlement_token = ?, settled_at = ?
      WHERE id = ? AND status = 'open' AND closes_at <= ?
    `).bind(token, timestamp, round.id, timestamp),
    env.DB.prepare(`
      UPDATE roulette_wagers
      SET status = 'settled',
          payout_units = CASE WHEN selection = ? THEN CAST(wager_units * ? / 1000000 AS INTEGER) ELSE 0 END,
          settled_at = ?
      WHERE spin_id = ? AND status = 'open'
        AND EXISTS(
          SELECT 1 FROM roulette_live_rounds
          WHERE id = ? AND status = 'settling' AND settlement_token = ?
        )
    `).bind(round.result, multiplierMicros, timestamp, round.id, round.id, token),
    env.DB.prepare(`
      WITH lane_totals AS (
        SELECT spin_id, uid, currency, selection,
          SUM(wager_units) AS wager_units, SUM(payout_units) AS payout_units
        FROM roulette_wagers
        WHERE spin_id = ? AND status = 'settled'
        GROUP BY spin_id, uid, currency, selection
      ), user_totals AS (
        SELECT spin_id, uid, currency,
          SUM(wager_units) AS wager_units,
          SUM(payout_units) AS payout_units,
          json_group_object(selection, wager_units) AS bets_json
        FROM lane_totals GROUP BY spin_id, uid, currency
      )
      INSERT OR IGNORE INTO roulette_rounds(
        id, request_id, uid, currency, wager_units, payout_units, bets_json, result,
        winning_multiplier_micros, multiplier_micros, outcome, created_at
      )
      SELECT spin_id || '_' || uid || '_' || currency,
        spin_id || '_' || currency,
        uid, currency, wager_units, payout_units, bets_json, ?, ?,
        CAST(payout_units * 1000000 / wager_units AS INTEGER),
        CASE WHEN payout_units >= wager_units THEN 'win' ELSE 'loss' END, ?
      FROM user_totals
      WHERE EXISTS(
        SELECT 1 FROM roulette_live_rounds
        WHERE id = ? AND status = 'settling' AND settlement_token = ?
      )
    `).bind(round.id, round.result, multiplierMicros, timestamp, round.id, token),
    env.DB.prepare(`
      UPDATE crypto_balances AS balance
      SET available_units = available_units + (
        SELECT COALESCE(SUM(wager.payout_units), 0)
        FROM roulette_wagers AS wager
        WHERE wager.spin_id = ? AND wager.uid = balance.uid
          AND wager.currency = balance.currency AND wager.status = 'settled'
      ), updated_at = ?
      WHERE EXISTS(
        SELECT 1 FROM roulette_wagers AS wager
        WHERE wager.spin_id = ? AND wager.uid = balance.uid
          AND wager.currency = balance.currency AND wager.status = 'settled' AND wager.payout_units > 0
      ) AND EXISTS(
        SELECT 1 FROM roulette_live_rounds
        WHERE id = ? AND status = 'settling' AND settlement_token = ?
      )
    `).bind(round.id, timestamp, round.id, round.id, token),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'roulette_live_payout_' || spin_id || '_' || uid || '_' || currency,
        uid, currency, 'game_payout', SUM(payout_units), spin_id, ?
      FROM roulette_wagers
      WHERE spin_id = ? AND status = 'settled' AND payout_units > 0
        AND EXISTS(
          SELECT 1 FROM roulette_live_rounds
          WHERE id = ? AND status = 'settling' AND settlement_token = ?
        )
      GROUP BY spin_id, uid, currency
    `).bind(timestamp, round.id, round.id, token),
    env.DB.prepare(`
      UPDATE roulette_live_rounds
      SET status = 'settled'
      WHERE id = ? AND status = 'settling' AND settlement_token = ?
    `).bind(round.id, token),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    return env.DB.prepare("SELECT * FROM roulette_live_rounds WHERE id = ?").bind(round.id).first();
  }
  return env.DB.prepare("SELECT * FROM roulette_live_rounds WHERE id = ?").bind(round.id).first();
}

async function settleDueSharedRouletteRounds(env, timestamp = now()) {
  const due = await env.DB.prepare(`
    SELECT * FROM roulette_live_rounds
    WHERE status <> 'settled' AND closes_at <= ?
    ORDER BY closes_at ASC LIMIT 12
  `).bind(timestamp).all();
  for (const round of due.results || []) await settleSharedRouletteRound(env, round, timestamp);
}

async function sharedRouletteRoundResponse(env, row, user, currency, timestamp = now()) {
  if (!row) return null;
  const wagerResult = currency ? await env.DB.prepare(`
    SELECT selection, SUM(wager_units) AS wager_units
    FROM roulette_wagers
    WHERE spin_id = ? AND uid = ? AND currency = ?
    GROUP BY selection
  `).bind(row.id, user.sub, currency).all() : { results: [] };
  const bets = { blue: 0, cyan: 0, purple: 0, gold: 0 };
  for (const wager of wagerResult.results || []) bets[wager.selection] = Number(wager.wager_units || 0);
  const twoXSelection = bets.blue > 0 ? "blue" : bets.cyan > 0 ? "cyan" : null;
  const spinning = timestamp >= Number(row.closes_at);
  return {
    id: row.id,
    game: "roulette",
    phase: spinning ? "spinning" : "betting",
    startsAtMs: Number(row.starts_at),
    closesAtMs: Number(row.closes_at),
    endsAtMs: Number(row.ends_at),
    result: spinning ? row.result : null,
    landingBasisPoints: spinning ? Number(row.landing_basis_points) : null,
    twoXSelection,
    bets: Object.fromEntries(Object.entries(bets).map(([selection, units]) => [selection, assetUnitsToString(units, false)])),
  };
}

async function handleSharedRouletteRound(request, env, user) {
  const timestamp = now();
  const currencyValue = new URL(request.url).searchParams.get("currency");
  const currency = currencyValue ? normalizeCurrency(currencyValue) : "";
  await settleDueSharedRouletteRounds(env, timestamp);
  let round = await backfillSharedRouletteRounds(env, timestamp);
  if (timestamp >= Number(round.closes_at)) round = await settleSharedRouletteRound(env, round, timestamp);
  return json(request, env, 200, {
    serverNow: timestamp,
    round: await sharedRouletteRoundResponse(env, round, user, currency, timestamp),
    recent: await rouletteRecent(env),
  });
}

async function maintainLiveGameTimelines(env, timestamp = now()) {
  await backfillSharedRouletteRounds(env, timestamp);
  await settleDueSharedRouletteRounds(env, timestamp);
  await maintainCrashTimeline(env, timestamp);
}

async function handleSharedRouletteWager(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM roulette_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const timestamp = now();
  await settleDueSharedRouletteRounds(env, timestamp);
  if (existing) {
    const storedRound = await env.DB.prepare("SELECT * FROM roulette_live_rounds WHERE id = ?").bind(existing.spin_id).first();
    return json(request, env, 200, {
      serverNow: timestamp,
      round: await sharedRouletteRoundResponse(env, storedRound, user, asset.code, timestamp),
      wallet: await walletResponse(env, user.sub),
    });
  }
  const selection = String(body.selection || "").toLowerCase();
  if (!["blue", "cyan", "purple", "gold"].includes(selection)) throw httpError(400, "Choose a valid Roulette tile");
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const round = await ensureSharedRouletteRound(env, timestamp);
  if (timestamp >= Number(round.closes_at) - 250) throw httpError(409, "Betting has closed for this spin");
  const id = crypto.randomUUID();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO roulette_wagers(id, request_id, spin_id, uid, currency, selection, wager_units, status, created_at)
        SELECT ?, ?, spin.id, ?, ?, ?, ?, 'open', ?
        FROM roulette_live_rounds AS spin
        JOIN crypto_balances AS balance ON balance.uid = ? AND balance.currency = ?
        WHERE spin.id = ? AND spin.status = 'open' AND spin.closes_at > ?
          AND balance.available_units >= ?
          AND (
            ? NOT IN ('blue', 'cyan') OR NOT EXISTS(
              SELECT 1 FROM roulette_wagers AS other
              WHERE other.spin_id = spin.id AND other.uid = ?
                AND other.selection IN ('blue', 'cyan') AND other.selection <> ?
            )
          )
      `).bind(
        id, requestId, user.sub, asset.code, selection, wagerUnits, timestamp,
        user.sub, asset.code, round.id, timestamp, wagerUnits,
        selection, user.sub, selection,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM roulette_wagers WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'roulette_wager_' || id, uid, currency, 'game_wager', -wager_units, spin_id, created_at
        FROM roulette_wagers WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      const opposite = await env.DB.prepare(`
        SELECT selection FROM roulette_wagers
        WHERE spin_id = ? AND uid = ? AND selection IN ('blue', 'cyan') LIMIT 1
      `).bind(round.id, user.sub).first();
      if (["blue", "cyan"].includes(selection) && opposite?.selection && opposite.selection !== selection) throw httpError(409, "You already backed the other 2× tile this spin");
      throw httpError(409, "Betting has closed or your available balance is too low");
    }
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM roulette_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (!duplicate) throw error;
  }
  const current = await env.DB.prepare("SELECT * FROM roulette_live_rounds WHERE id = ?").bind(round.id).first();
  return json(request, env, 201, {
    serverNow: timestamp,
    round: await sharedRouletteRoundResponse(env, current, user, asset.code, timestamp),
    wallet: await walletResponse(env, user.sub),
  });
}

async function rouletteSpinResponse(env, row) {
  if (!row) return null;
  const wagerResult = await env.DB.prepare(`
    SELECT selection, wager_units, payout_units, status, created_at
    FROM roulette_wagers WHERE spin_id = ? AND uid = ? ORDER BY created_at ASC
  `).bind(row.id, row.uid).all();
  const wagers = (wagerResult.results || []).map((wager) => ({
    selection: wager.selection,
    wager: assetUnitsToString(Number(wager.wager_units), false),
    payout: assetUnitsToString(Number(wager.payout_units || 0), false),
    status: wager.status,
  }));
  const bets = { blue: 0, cyan: 0, purple: 0, gold: 0 };
  for (const wager of wagerResult.results || []) bets[wager.selection] += Number(wager.wager_units || 0);
  return {
    id: row.id,
    game: "roulette",
    currency: row.currency,
    closesAt: new Date(Number(row.closes_at)).toISOString(),
    closesAtMs: Number(row.closes_at),
    twoXSelection: row.two_x_selection || null,
    result: row.result || null,
    landingBasisPoints: Number(row.landing_basis_points || 0),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    status: row.status,
    bets: Object.fromEntries(Object.entries(bets).map(([selection, units]) => [selection, assetUnitsToString(units, false)])),
    wagers,
  };
}

async function handleRouletteRecent(request, env, user) {
  return json(request, env, 200, { recent: await rouletteRecent(env, user.sub) });
}

async function handleRouletteActiveRound(request, env, user) {
  const row = await env.DB.prepare(`
    SELECT * FROM roulette_spins
    WHERE uid = ? AND status IN ('open', 'settling')
      AND EXISTS(SELECT 1 FROM roulette_wagers WHERE spin_id = roulette_spins.id AND uid = ?)
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, user.sub).first();
  return json(request, env, 200, { round: await rouletteSpinResponse(env, row) });
}

async function handleRouletteWager(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const roundId = normalizeRequestId(body.roundId);
  const existing = await env.DB.prepare("SELECT * FROM roulette_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) {
    const round = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(existing.spin_id, user.sub).first();
    return json(request, env, 200, { round: await rouletteSpinResponse(env, round), wallet: await walletResponse(env, user.sub) });
  }
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const selection = String(body.selection || "").toLowerCase();
  if (!["blue", "cyan", "purple", "gold"].includes(selection)) throw httpError(400, "Choose a valid Roulette tile");
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const timestamp = now();
  const closesAt = Number(body.closesAt);
  if (!Number.isSafeInteger(closesAt) || closesAt <= timestamp + 250 || closesAt > timestamp + 15_000) throw httpError(409, "Betting has closed for this spin");
  const id = crypto.randomUUID();
  try {
    const statements = [
      env.DB.prepare(`
        INSERT OR IGNORE INTO roulette_spins(id, uid, currency, closes_at, status, created_at)
        VALUES(?, ?, ?, ?, 'open', ?)
      `).bind(roundId, user.sub, asset.code, closesAt, timestamp),
    ];
    if (selection === "blue" || selection === "cyan") {
      statements.push(env.DB.prepare(`
        UPDATE roulette_spins SET two_x_selection = COALESCE(two_x_selection, ?)
        WHERE id = ? AND uid = ? AND currency = ? AND status = 'open' AND closes_at > ?
          AND (two_x_selection IS NULL OR two_x_selection = ?)
      `).bind(selection, roundId, user.sub, asset.code, timestamp, selection));
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO roulette_wagers(id, request_id, spin_id, uid, currency, selection, wager_units, status, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?
        FROM crypto_balances AS balance
        JOIN roulette_spins AS spin ON spin.uid = balance.uid AND spin.currency = balance.currency
        WHERE balance.uid = ? AND balance.currency = ? AND balance.available_units >= ?
          AND spin.id = ? AND spin.status = 'open' AND spin.closes_at > ?
          AND (? NOT IN ('blue', 'cyan') OR spin.two_x_selection = ?)
      `).bind(
        id, requestId, roundId, user.sub, asset.code, selection, wagerUnits, timestamp,
        user.sub, asset.code, wagerUnits, roundId, timestamp, selection, selection,
      ),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM roulette_wagers WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'roulette_wager_' || id, uid, currency, 'game_wager', -wager_units, spin_id, created_at
        FROM roulette_wagers WHERE id = ?
      `).bind(id),
    );
    const results = await env.DB.batch(statements);
    const wagerResult = results[selection === "blue" || selection === "cyan" ? 2 : 1];
    if (Number(wagerResult?.meta?.changes || 0) !== 1) {
      const spin = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
      if (spin && ["blue", "cyan"].includes(selection) && spin.two_x_selection && spin.two_x_selection !== selection) throw httpError(409, "You already backed the other 2× tile this spin");
      if (!spin || spin.status !== "open" || Number(spin.closes_at) <= timestamp) throw httpError(409, "Betting has closed for this spin");
      throw httpError(409, "Your available balance is too low");
    }
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM roulette_wagers WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) {
      const round = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(duplicate.spin_id, user.sub).first();
      return json(request, env, 200, { round: await rouletteSpinResponse(env, round), wallet: await walletResponse(env, user.sub) });
    }
    throw error;
  }
  const round = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  return json(request, env, 201, { round: await rouletteSpinResponse(env, round), wallet: await walletResponse(env, user.sub) });
}

async function handleRouletteSettle(request, env, user, roundIdValue) {
  const roundId = normalizeRequestId(roundIdValue);
  const body = await requestJson(request);
  let spin = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  const timestamp = now();
  if (!spin) {
    const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
    const closesAt = Number(body.closesAt);
    if (!Number.isSafeInteger(closesAt) || closesAt > timestamp + 1_000 || closesAt < timestamp - 60_000) throw httpError(400, "That Roulette spin is no longer available");
    await env.DB.prepare(`
      INSERT OR IGNORE INTO roulette_spins(id, uid, currency, closes_at, status, created_at)
      VALUES(?, ?, ?, ?, 'open', ?)
    `).bind(roundId, user.sub, asset.code, closesAt, Math.min(closesAt - 12_000, timestamp)).run();
    spin = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  }
  if (!spin) throw httpError(404, "That Roulette spin was not found");
  if (spin.status === "settled") return json(request, env, 200, { round: await rouletteSpinResponse(env, spin), recent: await rouletteRecent(env, user.sub), wallet: await walletResponse(env, user.sub) });
  if (Number(spin.closes_at) > timestamp) throw httpError(409, "Betting is still open for this spin");

  const wagerResult = await env.DB.prepare(`
    SELECT selection, SUM(wager_units) AS wager_units FROM roulette_wagers
    WHERE spin_id = ? AND uid = ? AND status = 'open' GROUP BY selection
  `).bind(roundId, user.sub).all();
  const bets = Object.fromEntries((wagerResult.results || []).map((row) => [row.selection, Number(row.wager_units)]));
  const result = secureRouletteResult();
  const landingBasisPoints = secureRandomInt(6401) - 3200;
  const winningMultiplierMicros = result === "gold" ? 14_000_000 : result === "purple" ? 7_000_000 : 2_000_000;
  const settlement = Object.keys(bets).length ? roulettePayout(bets, result) : { won: false, multiplierMicros: 0, payoutUnits: 0, totalWagerUnits: 0, winningMultiplierMicros };
  const statements = [
    env.DB.prepare(`
      UPDATE roulette_spins
      SET status = 'settling', result = ?, landing_basis_points = ?, payout_units = ?, settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'open' AND closes_at <= ?
    `).bind(result, landingBasisPoints, settlement.payoutUnits, timestamp, roundId, user.sub, timestamp),
    env.DB.prepare(`
      UPDATE roulette_wagers
      SET status = 'settled', payout_units = CASE WHEN selection = ? THEN CAST(wager_units * ? / 1000000 AS INTEGER) ELSE 0 END, settled_at = ?
      WHERE spin_id = ? AND uid = ? AND status = 'open'
        AND EXISTS(SELECT 1 FROM roulette_spins WHERE id = ? AND uid = ? AND status = 'settling' AND result = ?)
    `).bind(result, winningMultiplierMicros, timestamp, roundId, user.sub, roundId, user.sub, result),
  ];
  if (settlement.totalWagerUnits > 0) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO roulette_rounds(
        id, request_id, uid, currency, wager_units, payout_units, bets_json, result,
        winning_multiplier_micros, multiplier_micros, outcome, created_at
      ) SELECT id, id, uid, currency, ?, ?, ?, result, ?, ?, ?, ?
        FROM roulette_spins WHERE id = ? AND uid = ? AND status = 'settling' AND result = ?
    `).bind(settlement.totalWagerUnits, settlement.payoutUnits, JSON.stringify(bets), winningMultiplierMicros, settlement.multiplierMicros, settlement.won ? "win" : "loss", timestamp, roundId, user.sub, result));
  }
  if (settlement.payoutUnits > 0) {
    statements.push(
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM roulette_spins WHERE id = ? AND uid = ? AND status = 'settling' AND result = ?)
      `).bind(settlement.payoutUnits, timestamp, user.sub, spin.currency, roundId, user.sub, result),
      env.DB.prepare(`
        INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'roulette_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
        FROM roulette_spins WHERE id = ? AND uid = ? AND status = 'settling' AND result = ? AND payout_units > 0
      `).bind(timestamp, roundId, user.sub, result),
    );
  }
  statements.push(env.DB.prepare(`
    UPDATE roulette_spins SET status = 'settled'
    WHERE id = ? AND uid = ? AND status = 'settling' AND result = ?
  `).bind(roundId, user.sub, result));
  const results = await env.DB.batch(statements);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    spin = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
    if (spin?.status === "settled") return json(request, env, 200, { round: await rouletteSpinResponse(env, spin), recent: await rouletteRecent(env, user.sub), wallet: await walletResponse(env, user.sub) });
    throw httpError(409, "That Roulette spin is already being settled");
  }
  spin = await env.DB.prepare("SELECT * FROM roulette_spins WHERE id = ? AND uid = ?").bind(roundId, user.sub).first();
  return json(request, env, 200, { round: await rouletteSpinResponse(env, spin), recent: await rouletteRecent(env, user.sub), wallet: await walletResponse(env, user.sub) });
}

function integerArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((item) => Number.isInteger(item) && item >= 0 && item < 25) : [];
  } catch {
    return [];
  }
}

function minesRoundResponse(row, revealMines = false) {
  const terminal = row.status !== "active";
  return {
    id: row.id,
    game: "mines",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    mineCount: Number(row.mine_count),
    revealed: integerArray(row.revealed_positions),
    minePositions: revealMines || terminal ? integerArray(row.mine_positions) : undefined,
    status: row.status,
    outcome: row.status === "active" ? "open" : row.status === "lost" ? "loss" : "win",
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    multiplier: Number(row.multiplier_micros || 0) / 1_000_000,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function restorableMinesRound(env, row) {
  if (!row) return null;
  const round = minesRoundResponse(row);
  try {
    const asset = requireWalletAsset(row.currency);
    const prices = await providerPrices(env);
    const price = Number(prices?.[asset.providerCurrency] || 0);
    if (Number.isFinite(price) && price > 0) {
      round.wagerUsdCents = Math.max(1, Math.round(Number(round.wager) * price * 100));
    }
  } catch { /* Coin values remain sufficient when live pricing is unavailable. */ }
  return round;
}

async function handleGetActiveMinesRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const current = await env.DB.prepare(`
    SELECT * FROM mines_rounds
    WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: await restorableMinesRound(env, current), wallet: await walletResponse(env, user.sub) });
}

async function handleStartMinesRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM mines_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: minesRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare(`
    SELECT * FROM mines_rounds
    WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: await restorableMinesRound(env, active), wallet: await walletResponse(env, user.sub) });
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const mineCount = Number(body.mineCount);
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) throw httpError(400, "Choose between 1 and 24 mines");
  const timestamp = now();
  const id = crypto.randomUUID();
  const minePositions = shuffledTiles().slice(0, mineCount).sort((left, right) => left - right);
  const houseFactorMicros = await gameHouseFactorMicros(env, "mines");
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
      INSERT INTO mines_rounds(
        id, request_id, uid, currency, wager_units, mine_count, mine_positions,
        revealed_positions, status, payout_units, multiplier_micros, settled, created_at, updated_at, house_factor_micros
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, '[]', 'active', 0, 1000000, 0, ?, ?, ?
      FROM crypto_balances
      WHERE uid = ? AND currency = ? AND available_units >= ?
        AND NOT EXISTS(
          SELECT 1 FROM mines_rounds
          WHERE uid = ? AND currency = ? AND status = 'active'
        )
    `).bind(
      id, requestId, user.sub, asset.code, wagerUnits, mineCount, JSON.stringify(minePositions), timestamp, timestamp, houseFactorMicros,
      user.sub, asset.code, wagerUnits, user.sub, asset.code,
    ),
      env.DB.prepare(`
        UPDATE crypto_balances
        SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ?
          AND EXISTS(SELECT 1 FROM mines_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'mines_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM mines_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM mines_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: minesRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const active = await env.DB.prepare(`
      SELECT * FROM mines_rounds
      WHERE uid = ? AND currency = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).bind(user.sub, asset.code).first();
    if (active) return json(request, env, 200, { round: await restorableMinesRound(env, active), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM mines_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: await restorableMinesRound(env, created), wallet: await walletResponse(env, user.sub) });
}

async function ownedMinesRound(env, uid, id) {
  const row = await env.DB.prepare("SELECT * FROM mines_rounds WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (!row) throw httpError(404, "That Mines round was not found");
  return row;
}

async function settleMinesRound(env, current, { revealedPositions, status, payoutUnits, multiplierMicros, timestamp }) {
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE mines_rounds
      SET revealed_positions = ?, status = ?, payout_units = ?, multiplier_micros = ?, updated_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND revealed_positions = ?
    `).bind(revealedPositions, status, payoutUnits, multiplierMicros, timestamp, current.id, current.uid, current.revealed_positions),
    env.DB.prepare(`
      UPDATE crypto_balances
      SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND ? > 0
        AND EXISTS(
          SELECT 1 FROM mines_rounds
          WHERE id = ? AND uid = ? AND status = ? AND settled = 0 AND payout_units = ?
        )
    `).bind(payoutUnits, timestamp, current.uid, current.currency, payoutUnits, current.id, current.uid, status, payoutUnits),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'mines_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM mines_rounds
      WHERE id = ? AND uid = ? AND status = ? AND settled = 0 AND payout_units > 0
    `).bind(timestamp, current.id, current.uid, status),
    env.DB.prepare(`
      UPDATE mines_rounds SET settled = 1
      WHERE id = ? AND uid = ? AND status = ? AND settled = 0
    `).bind(current.id, current.uid, status),
  ]);
  return Number(results[0]?.meta?.changes || 0) === 1;
}

async function handleRevealMinesTile(request, env, user, roundId) {
  const body = await requestJson(request);
  const tile = Number(body.tile);
  if (!Number.isInteger(tile) || tile < 0 || tile > 24) throw httpError(400, "Choose a valid tile");
  const current = await ownedMinesRound(env, user.sub, roundId);
  if (current.status !== "active") return json(request, env, 200, { round: minesRoundResponse(current), hitMine: current.status === "lost", wallet: await walletResponse(env, user.sub) });
  const revealed = integerArray(current.revealed_positions);
  if (revealed.includes(tile)) return json(request, env, 200, { round: minesRoundResponse(current), hitMine: false, wallet: await walletResponse(env, user.sub) });
  const mines = integerArray(current.mine_positions);
  const hitMine = mines.includes(tile);
  const nextRevealed = [...revealed, tile].sort((left, right) => left - right);
  let status = hitMine ? "lost" : "active";
  let multiplierMicros = hitMine
    ? minesMultiplierMicros(Number(current.mine_count), revealed.length, Number(current.house_factor_micros || 990_000))
    : minesMultiplierMicros(Number(current.mine_count), nextRevealed.length, Number(current.house_factor_micros || 990_000));
  let payoutUnits = 0;
  if (!hitMine && nextRevealed.length === 25 - Number(current.mine_count)) {
    status = "won";
    payoutUnits = payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
  }
  const timestamp = now();
  if (status === "active") {
    await env.DB.prepare(`
      UPDATE mines_rounds
      SET revealed_positions = ?, multiplier_micros = ?, updated_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND revealed_positions = ?
    `).bind(JSON.stringify(nextRevealed), multiplierMicros, timestamp, roundId, user.sub, current.revealed_positions).run();
  } else {
    await settleMinesRound(env, current, {
      revealedPositions: JSON.stringify(nextRevealed), status, payoutUnits, multiplierMicros, timestamp,
    });
  }
  const updated = await ownedMinesRound(env, user.sub, roundId);
  return json(request, env, 200, { round: minesRoundResponse(updated), hitMine: updated.status === "lost", wallet: await walletResponse(env, user.sub) });
}

async function handleCashoutMinesRound(request, env, user, roundId) {
  const current = await ownedMinesRound(env, user.sub, roundId);
  if (current.status !== "active") return json(request, env, 200, { round: minesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  const revealed = integerArray(current.revealed_positions);
  if (!revealed.length) throw httpError(409, "Reveal at least one safe tile before cashing out");
  const multiplierMicros = minesMultiplierMicros(Number(current.mine_count), revealed.length, Number(current.house_factor_micros || 990_000));
  const payoutUnits = payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
  await settleMinesRound(env, current, {
    revealedPositions: current.revealed_positions,
    status: "cashed_out",
    payoutUnits,
    multiplierMicros,
    timestamp: now(),
  });
  const updated = await ownedMinesRound(env, user.sub, roundId);
  return json(request, env, 200, { round: minesRoundResponse(updated), wallet: await walletResponse(env, user.sub) });
}

const TOWERS_ROWS = 8;
const TOWERS_DIFFICULTIES = Object.freeze({
  easy: { columns: 4, traps: 1 },
  medium: { columns: 3, traps: 1 },
  hard: { columns: 2, traps: 1 },
  extreme: { columns: 3, traps: 2 },
});

function towersJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function towersLayout(columns, traps) {
  return Array.from({ length: TOWERS_ROWS }, () => {
    const positions = Array.from({ length: columns }, (_, index) => index);
    for (let index = positions.length - 1; index > 0; index -= 1) {
      const other = secureRandomInt(index + 1);
      [positions[index], positions[other]] = [positions[other], positions[index]];
    }
    return positions.slice(0, traps).sort((left, right) => left - right);
  });
}

function towersRoundResponse(row) {
  if (!row) return null;
  const layout = towersJsonArray(row.tower_json);
  const picks = towersJsonArray(row.picks_json).map(Number);
  const columns = Number(row.columns);
  const traps = Number(row.traps_per_row);
  const houseFactorMicros = Number(row.house_factor_micros || 990_000);
  return {
    id: row.id,
    game: "towers",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    difficulty: row.difficulty,
    rows: Number(row.rows),
    columns,
    trapsPerRow: traps,
    clearedRows: Number(row.cleared_rows),
    picks,
    revealedTraps: Object.fromEntries(layout.flatMap((positions, index) => index < picks.length ? [[String(index), positions]] : [])),
    levelMultipliers: Array.from({ length: TOWERS_ROWS }, (_, index) => towersMultiplierMicros(columns, traps, index + 1, houseFactorMicros) / 1_000_000),
    multiplier: Number(row.multiplier_micros || 1_000_000) / 1_000_000,
    status: row.status,
    outcome: row.status === "lost" ? "loss" : terminal ? "win" : "open",
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

async function handleGetActiveTowersRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM towers_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: towersRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartTowersRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM towers_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: towersRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM towers_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: towersRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const difficulty = String(body.difficulty || "medium").toLowerCase();
  const config = TOWERS_DIFFICULTIES[difficulty];
  if (!config) throw httpError(400, "Choose a valid Towers difficulty");
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "towers");
  const id = crypto.randomUUID();
  const timestamp = now();
  const layout = JSON.stringify(towersLayout(config.columns, config.traps));
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO towers_rounds(
          id, request_id, uid, currency, wager_units, difficulty, rows, columns, traps_per_row,
          tower_json, picks_json, cleared_rows, multiplier_micros, house_factor_micros,
          status, settled, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 1000000, ?, 'active', 0, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
          AND NOT EXISTS(SELECT 1 FROM towers_rounds WHERE uid = ? AND currency = ? AND status = 'active')
      `).bind(id, requestId, user.sub, asset.code, wagerUnits, difficulty, TOWERS_ROWS, config.columns, config.traps, layout, houseFactorMicros, timestamp, timestamp, user.sub, asset.code, wagerUnits, user.sub, asset.code),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM towers_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'towers_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM towers_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM towers_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: towersRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const current = await env.DB.prepare("SELECT * FROM towers_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
    if (current) return json(request, env, 200, { round: towersRoundResponse(current), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM towers_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: towersRoundResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function ownedTowersRound(env, uid, id) {
  const row = await env.DB.prepare("SELECT * FROM towers_rounds WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (!row) throw httpError(404, "That Towers round was not found");
  return row;
}

async function settleTowersRound(env, current, { status, picks, clearedRows, multiplierMicros, payoutUnits, actionId, timestamp }) {
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE towers_rounds SET picks_json = ?, cleared_rows = ?, multiplier_micros = ?, payout_units = ?,
        status = ?, last_action_id = ?, updated_at = ?, settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND picks_json = ?
    `).bind(JSON.stringify(picks), clearedRows, multiplierMicros, payoutUnits, status, actionId, timestamp, timestamp, current.id, current.uid, current.picks_json),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND ? > 0
        AND EXISTS(SELECT 1 FROM towers_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0)
    `).bind(payoutUnits, timestamp, current.uid, current.currency, payoutUnits, current.id, current.uid, status),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'towers_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM towers_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0 AND payout_units > 0
    `).bind(timestamp, current.id, current.uid, status),
    env.DB.prepare("UPDATE towers_rounds SET settled = 1 WHERE id = ? AND uid = ? AND status = ? AND settled = 0").bind(current.id, current.uid, status),
  ]);
  return Number(results[0]?.meta?.changes || 0) === 1;
}

async function handleChooseTowersTile(request, env, user, roundId) {
  const body = await requestJson(request);
  const column = Number(body.column);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedTowersRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: towersRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  if (!Number.isInteger(column) || column < 0 || column >= Number(current.columns)) throw httpError(400, "Choose a valid Towers tile");
  const picks = towersJsonArray(current.picks_json).map(Number);
  const rowIndex = picks.length;
  if (rowIndex >= TOWERS_ROWS) throw httpError(409, "That Towers round is complete");
  const layout = towersJsonArray(current.tower_json);
  const hitTrap = Array.isArray(layout[rowIndex]) && layout[rowIndex].includes(column);
  const nextPicks = [...picks, column];
  const nextCleared = hitTrap ? Number(current.cleared_rows) : rowIndex + 1;
  const multiplierMicros = hitTrap ? Number(current.multiplier_micros) : towersMultiplierMicros(Number(current.columns), Number(current.traps_per_row), nextCleared, Number(current.house_factor_micros));
  const timestamp = now();
  if (hitTrap || nextCleared === TOWERS_ROWS) {
    const status = hitTrap ? "lost" : "won";
    const payoutUnits = hitTrap ? 0 : payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
    await settleTowersRound(env, current, { status, picks: nextPicks, clearedRows: nextCleared, multiplierMicros, payoutUnits, actionId, timestamp });
  } else {
    await env.DB.prepare(`
      UPDATE towers_rounds SET picks_json = ?, cleared_rows = ?, multiplier_micros = ?, last_action_id = ?, updated_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND picks_json = ?
    `).bind(JSON.stringify(nextPicks), nextCleared, multiplierMicros, actionId, timestamp, roundId, user.sub, current.picks_json).run();
  }
  current = await ownedTowersRound(env, user.sub, roundId);
  return json(request, env, 200, { round: towersRoundResponse(current), wallet: await walletResponse(env, user.sub) });
}

async function handleCashoutTowersRound(request, env, user, roundId) {
  const body = await requestJson(request);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedTowersRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: towersRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  const picks = towersJsonArray(current.picks_json).map(Number);
  const clearedRows = Number(current.cleared_rows);
  if (clearedRows < 1) throw httpError(409, "Clear one row before cashing out");
  const multiplierMicros = towersMultiplierMicros(Number(current.columns), Number(current.traps_per_row), clearedRows, Number(current.house_factor_micros));
  const payoutUnits = payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
  await settleTowersRound(env, current, { status: "cashed_out", picks, clearedRows, multiplierMicros, payoutUnits, actionId, timestamp: now() });
  current = await ownedTowersRound(env, user.sub, roundId);
  return json(request, env, 200, { round: towersRoundResponse(current), wallet: await walletResponse(env, user.sub) });
}

const MOLES_HOLES = 7;
const MOLES_MAX_HITS = 8;

function molesJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function shuffledMolesPositions(moleCount) {
  const holes = Array.from({ length: MOLES_HOLES }, (_, index) => index);
  for (let index = holes.length - 1; index > 0; index -= 1) {
    const other = secureRandomInt(index + 1);
    [holes[index], holes[other]] = [holes[other], holes[index]];
  }
  return holes.slice(0, moleCount).sort((left, right) => left - right);
}

function molesLayouts(moleCount) {
  return Array.from({ length: MOLES_MAX_HITS }, () => shuffledMolesPositions(moleCount));
}

function molesRoundResponse(row) {
  if (!row) return null;
  const picks = molesJsonArray(row.picks_json).map(Number);
  const layouts = molesJsonArray(row.hole_layouts_json);
  const moleCount = Number(row.mole_count);
  const houseFactorMicros = Number(row.house_factor_micros || 980_000);
  const lastStage = picks.length - 1;
  const lastPositions = lastStage >= 0 && Array.isArray(layouts[lastStage]) ? layouts[lastStage].map(Number) : [];
  const terminal = row.status !== "active";
  return {
    id: row.id,
    game: "moles",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    moleCount,
    maxHits: Number(row.max_hits),
    hits: Number(row.hit_count),
    picks,
    multiplier: Number(row.multiplier_micros || 1_000_000) / 1_000_000,
    stepMultipliers: Array.from({ length: MOLES_MAX_HITS }, (_, index) => molesMultiplierMicros(moleCount, index + 1, houseFactorMicros) / 1_000_000),
    lastReveal: lastStage >= 0 ? {
      stage: lastStage,
      selectedHole: picks[lastStage],
      molePositions: lastPositions,
      hit: lastPositions.includes(picks[lastStage]),
    } : null,
    status: row.status,
    outcome: row.status === "lost" ? "loss" : terminal ? "win" : "open",
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

async function handleGetActiveMolesRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM moles_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: molesRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartMolesRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM moles_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: molesRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM moles_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: molesRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const moleCount = Number(body.moleCount);
  if (!Number.isInteger(moleCount) || moleCount < 1 || moleCount > 6) throw httpError(400, "Choose between 1 and 6 moles");
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "moles");
  const maxMultiplierMicros = molesMultiplierMicros(moleCount, MOLES_MAX_HITS, houseFactorMicros);
  const maximumSafeWager = Number(BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n / BigInt(maxMultiplierMicros));
  if (wagerUnits > maximumSafeWager) throw httpError(400, "Lower the wager for that Moles risk level");
  const id = crypto.randomUUID();
  const timestamp = now();
  const layouts = JSON.stringify(molesLayouts(moleCount));
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO moles_rounds(
          id, request_id, uid, currency, wager_units, mole_count, max_hits, hole_layouts_json,
          picks_json, hit_count, multiplier_micros, house_factor_micros, status, settled, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 1000000, ?, 'active', 0, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
          AND NOT EXISTS(SELECT 1 FROM moles_rounds WHERE uid = ? AND currency = ? AND status = 'active')
      `).bind(id, requestId, user.sub, asset.code, wagerUnits, moleCount, MOLES_MAX_HITS, layouts, houseFactorMicros, timestamp, timestamp, user.sub, asset.code, wagerUnits, user.sub, asset.code),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM moles_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'moles_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM moles_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM moles_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: molesRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const current = await env.DB.prepare("SELECT * FROM moles_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
    if (current) return json(request, env, 200, { round: molesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM moles_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: molesRoundResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function ownedMolesRound(env, uid, id) {
  const row = await env.DB.prepare("SELECT * FROM moles_rounds WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (!row) throw httpError(404, "That Moles round was not found");
  return row;
}

async function settleMolesRound(env, current, { status, picks, hits, multiplierMicros, payoutUnits, actionId, timestamp }) {
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE moles_rounds SET picks_json = ?, hit_count = ?, multiplier_micros = ?, payout_units = ?,
        status = ?, last_action_id = ?, updated_at = ?, settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND picks_json = ?
    `).bind(JSON.stringify(picks), hits, multiplierMicros, payoutUnits, status, actionId, timestamp, timestamp, current.id, current.uid, current.picks_json),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND ? > 0
        AND EXISTS(SELECT 1 FROM moles_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0)
    `).bind(payoutUnits, timestamp, current.uid, current.currency, payoutUnits, current.id, current.uid, status),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'moles_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM moles_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0 AND payout_units > 0
    `).bind(timestamp, current.id, current.uid, status),
    env.DB.prepare("UPDATE moles_rounds SET settled = 1 WHERE id = ? AND uid = ? AND status = ? AND settled = 0").bind(current.id, current.uid, status),
  ]);
  return Number(results[0]?.meta?.changes || 0) === 1;
}

async function handleChooseMolesHole(request, env, user, roundId) {
  const body = await requestJson(request);
  const hole = Number(body.hole);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedMolesRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: molesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  if (!Number.isInteger(hole) || hole < 0 || hole >= MOLES_HOLES) throw httpError(400, "Choose a valid Moles hole");
  const picks = molesJsonArray(current.picks_json).map(Number);
  const stage = picks.length;
  if (stage >= MOLES_MAX_HITS) throw httpError(409, "That Moles round is complete");
  const layouts = molesJsonArray(current.hole_layouts_json);
  const positions = Array.isArray(layouts[stage]) ? layouts[stage].map(Number) : [];
  const hit = positions.includes(hole);
  const nextPicks = [...picks, hole];
  const nextHits = hit ? Number(current.hit_count) + 1 : Number(current.hit_count);
  const multiplierMicros = hit ? molesMultiplierMicros(Number(current.mole_count), nextHits, Number(current.house_factor_micros)) : Number(current.multiplier_micros);
  const timestamp = now();
  if (!hit || nextHits === MOLES_MAX_HITS) {
    const status = hit ? "won" : "lost";
    const payoutUnits = hit ? payoutFromMultiplier(Number(current.wager_units), multiplierMicros) : 0;
    await settleMolesRound(env, current, { status, picks: nextPicks, hits: nextHits, multiplierMicros, payoutUnits, actionId, timestamp });
  } else {
    await env.DB.prepare(`
      UPDATE moles_rounds SET picks_json = ?, hit_count = ?, multiplier_micros = ?, last_action_id = ?, updated_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND picks_json = ?
    `).bind(JSON.stringify(nextPicks), nextHits, multiplierMicros, actionId, timestamp, roundId, user.sub, current.picks_json).run();
  }
  current = await ownedMolesRound(env, user.sub, roundId);
  return json(request, env, 200, { round: molesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
}

async function handleCashoutMolesRound(request, env, user, roundId) {
  const body = await requestJson(request);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedMolesRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: molesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  const hits = Number(current.hit_count);
  if (hits < 1) throw httpError(409, "Hit one mole before cashing out");
  const picks = molesJsonArray(current.picks_json).map(Number);
  const multiplierMicros = molesMultiplierMicros(Number(current.mole_count), hits, Number(current.house_factor_micros));
  const payoutUnits = payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
  await settleMolesRound(env, current, { status: "cashed_out", picks, hits, multiplierMicros, payoutUnits, actionId, timestamp: now() });
  current = await ownedMolesRound(env, user.sub, roundId);
  return json(request, env, 200, { round: molesRoundResponse(current), wallet: await walletResponse(env, user.sub) });
}

function stackJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function stackRoundPlan(difficulty) {
  const successMicros = STACK_SUCCESS_MICROS[difficulty];
  const outcomes = Array.from({ length: STACK_LEVELS }, () => secureRandomInt(1_000_000) < successMicros);
  return {
    outcomes,
    offsets: outcomes.map((landed) => {
      const direction = secureRandomInt(2) ? 1 : -1;
      return landed ? direction * secureRandomInt(31) : direction * (110 + secureRandomInt(41));
    }),
  };
}

function stackRoundResponse(row) {
  if (!row) return null;
  const difficulty = String(row.difficulty || "medium");
  const completedLevels = Number(row.completed_levels || 0);
  const houseFactorMicros = Number(row.house_factor_micros || 990_000);
  const drops = stackJsonArray(row.drops_json).map((drop) => ({
    level: Number(drop.level),
    landed: Boolean(drop.landed),
    offset: Number(drop.offset || 0),
  }));
  const terminal = row.status !== "active";
  return {
    id: row.id,
    game: "stack",
    currency: row.currency,
    wager: assetUnitsToString(Number(row.wager_units), false),
    payout: assetUnitsToString(Number(row.payout_units || 0), false),
    difficulty,
    maxLevels: Number(row.max_levels || STACK_LEVELS),
    completedLevels,
    drops,
    lastDrop: drops.at(-1) || null,
    multiplier: Number(row.multiplier_micros || 1_000_000) / 1_000_000,
    levelMultipliers: Array.from({ length: STACK_LEVELS }, (_, index) => stackMultiplierMicros(difficulty, index + 1, houseFactorMicros) / 1_000_000),
    status: row.status,
    outcome: row.status === "lost" ? "loss" : terminal ? "win" : "open",
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

async function handleGetActiveStackRound(request, env, user) {
  const currency = normalizeCurrency(new URL(request.url).searchParams.get("currency"));
  const row = await env.DB.prepare(`
    SELECT * FROM stack_rounds WHERE uid = ? AND currency = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(user.sub, currency).first();
  return json(request, env, 200, { round: stackRoundResponse(row), wallet: await walletResponse(env, user.sub) });
}

async function handleStartStackRound(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const existing = await env.DB.prepare("SELECT * FROM stack_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
  if (existing) return json(request, env, 200, { round: stackRoundResponse(existing), wallet: await walletResponse(env, user.sub) });
  const asset = await requireSelectedGameAsset(env, user.sub, body.currency);
  const active = await env.DB.prepare("SELECT * FROM stack_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
  if (active) return json(request, env, 200, { round: stackRoundResponse(active), wallet: await walletResponse(env, user.sub) });
  const difficulty = String(body.difficulty || "").toLowerCase();
  if (!STACK_SUCCESS_MICROS[difficulty]) throw httpError(400, "Choose a valid Stack difficulty");
  const wagerUnits = await gameWagerUnits(env, asset, body.wager, body.displayFiat === true);
  const houseFactorMicros = await gameHouseFactorMicros(env, "stack");
  const maxMultiplierMicros = stackMultiplierMicros(difficulty, STACK_LEVELS, houseFactorMicros);
  const maximumSafeWager = Number(BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n / BigInt(maxMultiplierMicros));
  if (wagerUnits > maximumSafeWager) throw httpError(400, "Lower the wager for that Stack difficulty");
  const plan = stackRoundPlan(difficulty);
  const id = crypto.randomUUID();
  const timestamp = now();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO stack_rounds(
          id, request_id, uid, currency, wager_units, difficulty, max_levels, outcomes_json,
          offsets_json, drops_json, completed_levels, multiplier_micros, house_factor_micros,
          status, settled, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 1000000, ?, 'active', 0, ?, ?
        FROM crypto_balances
        WHERE uid = ? AND currency = ? AND available_units >= ?
          AND NOT EXISTS(SELECT 1 FROM stack_rounds WHERE uid = ? AND currency = ? AND status = 'active')
      `).bind(id, requestId, user.sub, asset.code, wagerUnits, difficulty, STACK_LEVELS, JSON.stringify(plan.outcomes), JSON.stringify(plan.offsets), houseFactorMicros, timestamp, timestamp, user.sub, asset.code, wagerUnits, user.sub, asset.code),
      env.DB.prepare(`
        UPDATE crypto_balances SET available_units = available_units - ?, updated_at = ?
        WHERE uid = ? AND currency = ? AND EXISTS(SELECT 1 FROM stack_rounds WHERE id = ?)
      `).bind(wagerUnits, timestamp, user.sub, asset.code, id),
      env.DB.prepare(`
        INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
        SELECT 'stack_wager_' || id, uid, currency, 'game_wager', -wager_units, id, created_at
        FROM stack_rounds WHERE id = ?
      `).bind(id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) throw httpError(409, "Your available balance is too low");
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT * FROM stack_rounds WHERE uid = ? AND request_id = ?").bind(user.sub, requestId).first();
    if (duplicate) return json(request, env, 200, { round: stackRoundResponse(duplicate), wallet: await walletResponse(env, user.sub) });
    const current = await env.DB.prepare("SELECT * FROM stack_rounds WHERE uid = ? AND currency = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").bind(user.sub, asset.code).first();
    if (current) return json(request, env, 200, { round: stackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
    throw error;
  }
  const created = await env.DB.prepare("SELECT * FROM stack_rounds WHERE id = ?").bind(id).first();
  return json(request, env, 201, { round: stackRoundResponse(created), wallet: await walletResponse(env, user.sub) });
}

async function ownedStackRound(env, uid, id) {
  const row = await env.DB.prepare("SELECT * FROM stack_rounds WHERE id = ? AND uid = ?").bind(id, uid).first();
  if (!row) throw httpError(404, "That Stack round was not found");
  return row;
}

async function settleStackRound(env, current, { status, drops, completedLevels, multiplierMicros, payoutUnits, actionId, timestamp }) {
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE stack_rounds SET drops_json = ?, completed_levels = ?, multiplier_micros = ?, payout_units = ?,
        status = ?, last_action_id = ?, updated_at = ?, settled_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND drops_json = ?
    `).bind(JSON.stringify(drops), completedLevels, multiplierMicros, payoutUnits, status, actionId, timestamp, timestamp, current.id, current.uid, current.drops_json),
    env.DB.prepare(`
      UPDATE crypto_balances SET available_units = available_units + ?, updated_at = ?
      WHERE uid = ? AND currency = ? AND ? > 0
        AND EXISTS(SELECT 1 FROM stack_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0)
    `).bind(payoutUnits, timestamp, current.uid, current.currency, payoutUnits, current.id, current.uid, status),
    env.DB.prepare(`
      INSERT OR IGNORE INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      SELECT 'stack_payout_' || id, uid, currency, 'game_payout', payout_units, id, ?
      FROM stack_rounds WHERE id = ? AND uid = ? AND status = ? AND settled = 0 AND payout_units > 0
    `).bind(timestamp, current.id, current.uid, status),
    env.DB.prepare("UPDATE stack_rounds SET settled = 1 WHERE id = ? AND uid = ? AND status = ? AND settled = 0").bind(current.id, current.uid, status),
  ]);
  return Number(results[0]?.meta?.changes || 0) === 1;
}

async function handleDropStackLevel(request, env, user, roundId) {
  const body = await requestJson(request);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedStackRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: stackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  const drops = stackJsonArray(current.drops_json);
  const level = drops.length;
  if (level >= STACK_LEVELS) throw httpError(409, "That Stack round is complete");
  const outcomes = stackJsonArray(current.outcomes_json);
  const offsets = stackJsonArray(current.offsets_json);
  const landed = outcomes[level] === true;
  const drop = { level: level + 1, landed, offset: Number(offsets[level] || 120) };
  const nextDrops = [...drops, drop];
  const nextCompleted = landed ? Number(current.completed_levels) + 1 : Number(current.completed_levels);
  const multiplierMicros = landed ? stackMultiplierMicros(current.difficulty, nextCompleted, Number(current.house_factor_micros)) : Number(current.multiplier_micros);
  const timestamp = now();
  if (!landed || nextCompleted === STACK_LEVELS) {
    const status = landed ? "won" : "lost";
    const payoutUnits = landed ? payoutFromMultiplier(Number(current.wager_units), multiplierMicros) : 0;
    await settleStackRound(env, current, { status, drops: nextDrops, completedLevels: nextCompleted, multiplierMicros, payoutUnits, actionId, timestamp });
  } else {
    await env.DB.prepare(`
      UPDATE stack_rounds SET drops_json = ?, completed_levels = ?, multiplier_micros = ?, last_action_id = ?, updated_at = ?
      WHERE id = ? AND uid = ? AND status = 'active' AND drops_json = ?
    `).bind(JSON.stringify(nextDrops), nextCompleted, multiplierMicros, actionId, timestamp, roundId, user.sub, current.drops_json).run();
  }
  current = await ownedStackRound(env, user.sub, roundId);
  return json(request, env, 200, { round: stackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
}

async function handleCashoutStackRound(request, env, user, roundId) {
  const body = await requestJson(request);
  const actionId = normalizeRequestId(body.actionId);
  let current = await ownedStackRound(env, user.sub, roundId);
  if (current.status !== "active" || current.last_action_id === actionId) return json(request, env, 200, { round: stackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
  const completedLevels = Number(current.completed_levels);
  if (completedLevels < 1) throw httpError(409, "Land one platform before cashing out");
  const drops = stackJsonArray(current.drops_json);
  const multiplierMicros = stackMultiplierMicros(current.difficulty, completedLevels, Number(current.house_factor_micros));
  const payoutUnits = payoutFromMultiplier(Number(current.wager_units), multiplierMicros);
  await settleStackRound(env, current, { status: "cashed_out", drops, completedLevels, multiplierMicros, payoutUnits, actionId, timestamp: now() });
  current = await ownedStackRound(env, user.sub, roundId);
  return json(request, env, 200, { round: stackRoundResponse(current), wallet: await walletResponse(env, user.sub) });
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
    SELECT * FROM crypto_deposits
    WHERE uid = ? AND status = 'address_ready' AND pay_address <> ''
    ORDER BY created_at DESC
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

const LEADERBOARD_CADENCES = ["daily", "weekly", "biweekly", "monthly"];

function parsePrizeUsdCents(value) {
  return parseUsdCents(value, "Prize amount", { allowZero: false });
}

function parseUsdCents(value, label = "Amount", { allowZero = true } = {}) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw httpError(400, `Enter a valid ${label.toLowerCase()} in USD`);
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(cents) || cents < minimum || cents > 10_000_000_000) {
    throw httpError(400, `${label} must be between ${allowZero ? "$0.00" : "$0.01"} and $100,000,000`);
  }
  return cents;
}

function leaderboardResponse(row, cadence) {
  if (!row) return { cadence, prizeUsdCents: 0, prizePlaces: 10, status: "scheduled", startsAt: null, endsAt: null, durationSeconds: 0, standings: [] };
  const ended = Number(row.ends_at) <= now();
  return {
    cadence,
    prizeUsdCents: Number(row.prize_usd_cents),
    prizePlaces: Math.max(1, Math.min(50, Number(row.prize_places || 10))),
    status: ended ? "ended" : row.status,
    startsAt: new Date(Number(row.starts_at)).toISOString(),
    endsAt: new Date(Number(row.ends_at)).toISOString(),
    durationSeconds: Number(row.duration_seconds),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
  };
}

function leaderboardRank(totalWagered) {
  const index = playerRankIndex(totalWagered);
  const [stageId] = PROMOTION_RANKS[Math.floor(index / 3)] || PROMOTION_RANKS[0];
  const tierIndex = index % 3;
  const stageName = stageId.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const tier = ["I", "II", "III"][tierIndex];
  const badgeTier = ["i", "ii", "iii"][tierIndex];
  return {
    id: `${stageId}-${tierIndex + 1}`,
    label: `${stageName} ${tier}`,
    badgePath: `/ranks/${stageId}-${badgeTier}.webp`,
  };
}

async function leaderboardStandings(env, campaign, prizePlaces, viewer) {
  if (!campaign) {
    if (!viewer) return { standings: [], currentPlayer: null };
    const profile = await env.DB.prepare("SELECT username FROM player_profiles WHERE uid = ?").bind(viewer.sub).first();
    return {
      standings: [],
      currentPlayer: {
        position: null,
        username: String(profile?.username || viewer.name || "You"),
        wagerUsdCents: 0,
        playerRank: leaderboardRank(0),
      },
    };
  }
  const startsAt = Number(campaign.starts_at);
  const endsAt = Math.min(Number(campaign.ends_at), now());
  const rows = await env.DB.prepare(`
    SELECT uid, currency,
      SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN -amount_units ELSE 0 END) AS campaign_units,
      SUM(-amount_units) AS lifetime_units
    FROM crypto_ledger
    WHERE type IN ('game_wager', 'game_bet') AND created_at <= ?
    GROUP BY uid, currency
  `).bind(startsAt, endsAt, endsAt).all();
  let prices = {};
  try { prices = await providerPrices(env); } catch { prices = {}; }
  const racers = new Map();
  for (const row of rows.results || []) {
    const asset = getWalletAsset(row.currency);
    if (!asset) continue;
    const price = Number(prices?.[asset.providerCurrency] || stablecoinPrice(asset));
    if (!Number.isFinite(price) || price <= 0) continue;
    const campaignUsdCents = Math.max(0, Math.round(Number(assetUnitsToString(Number(row.campaign_units || 0), false)) * price * 100));
    const lifetimeUsd = Math.max(0, Number(assetUnitsToString(Number(row.lifetime_units || 0), false)) * price);
    const current = racers.get(row.uid) || { uid: row.uid, wagerUsdCents: 0, lifetimeWagered: 0 };
    current.wagerUsdCents += campaignUsdCents;
    current.lifetimeWagered += lifetimeUsd;
    racers.set(row.uid, current);
  }
  const allRacers = [...racers.values()].sort((left, right) => right.wagerUsdCents - left.wagerUsdCents || left.uid.localeCompare(right.uid));
  const qualifyingRacers = allRacers.filter((racer) => racer.wagerUsdCents > 0);
  const leaders = qualifyingRacers.slice(0, prizePlaces);
  const viewerRacer = viewer ? allRacers.find((racer) => racer.uid === viewer.sub) || { uid: viewer.sub, wagerUsdCents: 0, lifetimeWagered: 0 } : null;
  const profileUids = [...new Set([...leaders.map((racer) => racer.uid), ...(viewerRacer ? [viewerRacer.uid] : [])])];
  if (!profileUids.length) return { standings: [], currentPlayer: null };
  const placeholders = profileUids.map(() => "?").join(", ");
  const profiles = await env.DB.prepare(`
    SELECT uid, username, profile_public, show_username, show_rank
    FROM player_profiles WHERE uid IN (${placeholders})
  `).bind(...profileUids).all();
  const profilesByUid = new Map((profiles.results || []).map((profile) => [profile.uid, profile]));
  const entryFor = (racer, position, isViewer = false) => {
    const profile = profilesByUid.get(racer.uid) || {};
    const profileVisible = isViewer || Boolean(profile.profile_public ?? 1);
    const usernameVisible = isViewer || (profileVisible && Boolean(profile.show_username ?? 1));
    const rankVisible = isViewer || (profileVisible && Boolean(profile.show_rank ?? 1));
    return {
      position,
      username: usernameVisible ? String(profile.username || (isViewer ? viewer?.name : "Racer") || "Racer") : "Hidden Racer",
      profileVisible: usernameVisible,
      wagerUsdCents: racer.wagerUsdCents,
      playerRank: rankVisible ? leaderboardRank(racer.lifetimeWagered) : null,
    };
  };
  const viewerIndex = viewerRacer ? qualifyingRacers.findIndex((racer) => racer.uid === viewerRacer.uid) : -1;
  return {
    standings: leaders.map((racer, index) => entryFor(racer, index + 1, racer.uid === viewer?.sub)),
    currentPlayer: viewerRacer ? entryFor(viewerRacer, viewerIndex >= 0 ? viewerIndex + 1 : null, true) : null,
  };
}

async function readLeaderboards(env, viewer = null) {
  const result = await env.DB.prepare(`
    SELECT cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at
    FROM leaderboard_campaigns WHERE cadence IN ('daily', 'weekly', 'biweekly', 'monthly')
  `).all();
  const rows = new Map((result.results || []).map((row) => [row.cadence, row]));
  return Promise.all(LEADERBOARD_CADENCES.map(async (cadence) => {
    const row = rows.get(cadence);
    const campaign = leaderboardResponse(row, cadence);
    const result = await leaderboardStandings(env, row, campaign.prizePlaces, viewer);
    return { ...campaign, ...result };
  }));
}

async function handleLeaderboards(request, env, viewer = null) {
  return json(request, env, 200, { leaderboards: await readLeaderboards(env, viewer), generatedAt: new Date(now()).toISOString() });
}

async function handleAdminLeaderboards(request, env, user) {
  await requireAdminSession(request, env, user);
  return handleLeaderboards(request, env, user);
}

const PROMOTION_RANKS = Object.freeze([
  ["rookie", [0, 1_000, 2_500]], ["street", [5_000, 10_000, 20_000]],
  ["circuit", [35_000, 50_000, 75_000]], ["turbo", [100_000, 150_000, 225_000]],
  ["velocity", [350_000, 500_000, 750_000]], ["hyper", [1_000_000, 1_500_000, 2_500_000]],
  ["apex", [4_000_000, 6_000_000, 10_000_000]], ["pole", [15_000_000, 25_000_000, 40_000_000]],
  ["champion", [60_000_000, 100_000_000, 175_000_000]], ["hall-of-fame", [250_000_000, 500_000_000, 1_000_000_000]],
]);

function promotionRankIndex(stage, tier) {
  const stageIndex = PROMOTION_RANKS.findIndex(([id]) => id === String(stage || "rookie"));
  return Math.max(0, stageIndex) * 3 + Math.min(3, Math.max(1, Number(tier) || 1)) - 1;
}

function playerRankIndex(totalWagered) {
  let index = 0;
  PROMOTION_RANKS.forEach(([, thresholds], stageIndex) => thresholds.forEach((threshold, tierIndex) => {
    if (Number(totalWagered || 0) >= threshold) index = stageIndex * 3 + tierIndex;
  }));
  return index;
}

function promotionResponse(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || "",
    rewardCurrency: row.reward_currency,
    rewardAmount: assetUnitsToString(Number(row.reward_units), true),
    minimumRankStage: row.minimum_rank_stage,
    minimumRankTier: Number(row.minimum_rank_tier),
    minimumDepositUsd: (Number(row.minimum_deposit_usd_cents || 0) / 100).toFixed(2),
    depositLookbackDays: Number(row.deposit_lookback_days),
    maxClaims: Number(row.max_claims),
    claimCount: Number(row.claim_count),
    startsAt: row.starts_at ? new Date(Number(row.starts_at)).toISOString() : null,
    endsAt: row.ends_at ? new Date(Number(row.ends_at)).toISOString() : null,
    enabled: Boolean(row.enabled),
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function handleAdminPromotions(request, env, user) {
  await requireAdminSession(request, env, user);
  const result = await env.DB.prepare("SELECT * FROM promotion_codes WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 100").all();
  return json(request, env, 200, { promotions: (result.results || []).map(promotionResponse) });
}

async function handleAdminRemovePromotion(request, env, user, promotionIdValue) {
  await requireAdminSession(request, env, user);
  const promotionId = String(promotionIdValue || "").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(promotionId)) throw httpError(400, "Choose a valid promotion");
  const current = await env.DB.prepare("SELECT id, code, archived_at FROM promotion_codes WHERE id = ?").bind(promotionId).first();
  if (!current || current.archived_at) throw httpError(404, "That promotion was not found");
  const timestamp = now();
  const result = await env.DB.prepare(`
    UPDATE promotion_codes SET enabled = 0, archived_at = ?, updated_at = ?
    WHERE id = ? AND archived_at IS NULL
  `).bind(timestamp, timestamp, promotionId).run();
  if (Number(result.meta?.changes || 0) !== 1) throw httpError(409, "That promotion has already been removed");
  await writeAdminAudit(env, user, "promotion.removed", promotionId, JSON.stringify({ code: current.code }));
  return json(request, env, 200, { removed: true, id: promotionId });
}

async function handleAdminCreatePromotion(request, env, user) {
  await requireAdminSession(request, env, user);
  const body = await requestJson(request);
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw httpError(400, "Use 3–32 letters, numbers, dashes or underscores for the code");
  const title = cleanAccountText(body.title, 80, "Promotion title", { required: true });
  const description = cleanAccountText(body.description, 240, "Description");
  const rewardCurrency = requireWalletAsset(body.rewardCurrency).code;
  const rewardUnits = parseAssetUnits(body.rewardAmount, { maximumUnits: 100_000_000_000_000 });
  const minimumRankStage = String(body.minimumRankStage || "rookie").toLowerCase();
  if (!PROMOTION_RANKS.some(([id]) => id === minimumRankStage)) throw httpError(400, "Choose a valid minimum rank");
  const minimumRankTier = Number(body.minimumRankTier || 1);
  if (![1, 2, 3].includes(minimumRankTier)) throw httpError(400, "Choose a valid rank tier");
  const minimumDepositUsdCents = parseUsdCents(body.minimumDepositUsd || "0", "Minimum deposit");
  const depositLookbackDays = Math.floor(Number(body.depositLookbackDays || 0));
  if (!Number.isInteger(depositLookbackDays) || depositLookbackDays < 0 || depositLookbackDays > 3650) throw httpError(400, "Deposit lookback must be between 0 and 3650 days");
  const maxClaims = Math.floor(Number(body.maxClaims || 0));
  if (!Number.isInteger(maxClaims) || maxClaims < 0 || maxClaims > 10_000_000) throw httpError(400, "Maximum claims must be 0 or a positive number");
  const parseOptionalDate = (value, label) => {
    if (!value) return null;
    const date = Date.parse(value);
    if (!Number.isFinite(date)) throw httpError(400, `Enter a valid ${label}`);
    return date;
  };
  const startsAt = parseOptionalDate(body.startsAt, "start date");
  const endsAt = parseOptionalDate(body.endsAt, "end date");
  if (startsAt && endsAt && endsAt <= startsAt) throw httpError(400, "End date must be after the start date");
  const timestamp = now();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO promotion_codes(id, code, title, description, reward_currency, reward_units, minimum_rank_stage,
        minimum_rank_tier, minimum_deposit_currency, minimum_deposit_units, minimum_deposit_usd_cents,
        deposit_lookback_days, max_claims,
        claim_count, starts_at, ends_at, enabled, created_at, updated_at, created_by)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).bind(id, code, title, description, rewardCurrency, rewardUnits, minimumRankStage, minimumRankTier,
      rewardCurrency, minimumDepositUsdCents, depositLookbackDays, maxClaims, startsAt, endsAt,
      body.enabled === false ? 0 : 1, timestamp, timestamp, user.sub).run();
  } catch (error) {
    if (/unique/i.test(String(error?.message))) throw httpError(409, "That promotion code already exists");
    throw error;
  }
  await writeAdminAudit(env, user, "promotion.created", id, JSON.stringify({ code, rewardCurrency, rewardUnits }));
  const row = await env.DB.prepare("SELECT * FROM promotion_codes WHERE id = ?").bind(id).first();
  return json(request, env, 201, { promotion: promotionResponse(row) });
}

async function handlePromotionClaim(request, env, user) {
  const body = await requestJson(request);
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw httpError(400, "Enter a valid promotion code");
  const promo = await env.DB.prepare("SELECT * FROM promotion_codes WHERE code = ? COLLATE NOCASE").bind(code).first();
  if (!promo) throw httpError(404, "That promotion code was not found");
  const timestamp = now();
  if (promo.archived_at || !promo.enabled || (promo.starts_at && Number(promo.starts_at) > timestamp) || (promo.ends_at && Number(promo.ends_at) <= timestamp) || (promo.max_claims && Number(promo.claim_count) >= Number(promo.max_claims))) {
    throw httpError(409, "That promotion is not currently available");
  }
  const previous = await env.DB.prepare("SELECT id FROM promotion_redemptions WHERE promotion_id = ? AND uid = ?").bind(promo.id, user.sub).first();
  if (previous) throw httpError(409, "You have already claimed this promotion");
  const account = await liveAccountSnapshot(env, user.sub, { includeActivity: false });
  if (playerRankIndex(account.summary.totalWagered) < promotionRankIndex(promo.minimum_rank_stage, promo.minimum_rank_tier)) {
    throw httpError(403, "Your GamRace rank does not meet this promotion's requirement");
  }
  if (Number(promo.minimum_deposit_usd_cents) > 0) {
    const cutoff = Number(promo.deposit_lookback_days) > 0 ? timestamp - Number(promo.deposit_lookback_days) * 86_400_000 : 0;
    const deposit = await env.DB.prepare(`
      SELECT COALESCE(SUM(requested_usd_cents), 0) AS total_usd_cents FROM crypto_deposits
      WHERE uid = ? AND credited = 1 AND updated_at >= ?
    `).bind(user.sub, cutoff).first();
    if (Number(deposit?.total_usd_cents || 0) < Number(promo.minimum_deposit_usd_cents)) {
      const period = Number(promo.deposit_lookback_days) > 0 ? ` in the last ${promo.deposit_lookback_days} days` : "";
      throw httpError(403, `Deposit at least $${(Number(promo.minimum_deposit_usd_cents) / 100).toFixed(2)} across any supported crypto${period} to claim this code`);
    }
  }
  const redemptionId = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO promotion_redemptions(id, promotion_id, uid, reward_currency, reward_units, created_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).bind(redemptionId, promo.id, user.sub, promo.reward_currency, promo.reward_units, timestamp).run();
  } catch (error) {
    const message = String(error?.message || "");
    if (/unique/i.test(message)) throw httpError(409, "You have already claimed this promotion");
    if (/PROMOTION_UNAVAILABLE/.test(message)) throw httpError(409, "That promotion is no longer available");
    throw error;
  }
  return json(request, env, 201, {
    reward: { currency: promo.reward_currency, amount: assetUnitsToString(Number(promo.reward_units), true), title: promo.title },
    wallet: await walletResponse(env, user.sub),
  });
}

async function readGameEdges(env) {
  if (gameEdgesCache && gameEdgesCacheExpiresAt > now()) return gameEdgesCache;
  const result = await env.DB.prepare("SELECT game_id, house_edge_basis_points, maintenance_mode, updated_at FROM game_settings").all();
  const settings = new Map((result.results || []).map((row) => [row.game_id, row]));
  gameEdgesCache = GAME_EDGE_DEFINITIONS.map((definition) => {
    const row = settings.get(definition.id);
    const houseEdgeBasisPoints = Number.isInteger(definition.fixedHouseEdgeBasisPoints)
      ? definition.fixedHouseEdgeBasisPoints
      : Number(row?.house_edge_basis_points ?? 100);
    return {
      ...definition,
      houseEdgeBasisPoints,
      houseEdgePercent: houseEdgeBasisPoints / 100,
      rtpPercent: 100 - houseEdgeBasisPoints / 100,
      maintenanceMode: Boolean(row?.maintenance_mode),
      updatedAt: row?.updated_at ? new Date(Number(row.updated_at)).toISOString() : null,
    };
  });
  gameEdgesCacheExpiresAt = now() + GAME_EDGES_CACHE_MS;
  return gameEdgesCache;
}

async function handleAdminGameEdges(request, env, user) {
  await requireAdminSession(request, env, user);
  return json(request, env, 200, { games: await readGameEdges(env) });
}

async function handleAdminSetGameEdge(request, env, user, gameIdValue) {
  await requireAdminSession(request, env, user);
  const gameId = String(gameIdValue || "").toLowerCase();
  const definition = GAME_EDGE_DEFINITIONS.find((game) => game.id === gameId);
  if (!definition) throw httpError(404, "That game was not found");
  if (!definition.editable) throw httpError(409, `${definition.name} uses fixed game math and cannot be changed here`);
  const body = await requestJson(request);
  const houseEdgeBasisPoints = Math.round(Number(body.houseEdgePercent) * 100);
  if (!Number.isInteger(houseEdgeBasisPoints) || houseEdgeBasisPoints < 0 || houseEdgeBasisPoints > 1000) {
    throw httpError(400, "House edge must be between 0% and 10%");
  }
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO game_settings(game_id, house_edge_basis_points, updated_at, updated_by)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(game_id) DO UPDATE SET house_edge_basis_points = excluded.house_edge_basis_points,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).bind(gameId, houseEdgeBasisPoints, timestamp, user.sub).run();
  gameEdgesCache = null;
  gameEdgesCacheExpiresAt = 0;
  await writeAdminAudit(env, user, "game.house_edge.updated", gameId, JSON.stringify({ houseEdgeBasisPoints }));
  return json(request, env, 200, { game: (await readGameEdges(env)).find((game) => game.id === gameId) });
}

async function handleAdminSetGameMaintenance(request, env, user, gameIdValue) {
  await requireAdminSession(request, env, user);
  const gameId = String(gameIdValue || "").toLowerCase();
  const definition = GAME_EDGE_DEFINITIONS.find((game) => game.id === gameId);
  if (!definition) throw httpError(404, "That game was not found");
  const body = await requestJson(request);
  if (typeof body.maintenanceMode !== "boolean") throw httpError(400, "Maintenance mode must be true or false");
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO game_settings(game_id, house_edge_basis_points, maintenance_mode, updated_at, updated_by)
    VALUES(?, 100, ?, ?, ?)
    ON CONFLICT(game_id) DO UPDATE SET maintenance_mode = excluded.maintenance_mode,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).bind(gameId, body.maintenanceMode ? 1 : 0, timestamp, user.sub).run();
  gameEdgesCache = null;
  gameEdgesCacheExpiresAt = 0;
  await writeAdminAudit(env, user, body.maintenanceMode ? "game.maintenance.enabled" : "game.maintenance.disabled", gameId);
  return json(request, env, 200, { game: (await readGameEdges(env)).find((game) => game.id === gameId) });
}

async function handleAdminStartLeaderboard(request, env, user, cadence) {
  await requireAdminSession(request, env, user);
  const normalizedCadence = String(cadence || "").toLowerCase();
  if (!LEADERBOARD_CADENCES.includes(normalizedCadence)) throw httpError(400, "Choose a valid leaderboard");
  const body = await requestJson(request);
  const prizeUsdCents = parsePrizeUsdCents(body.prizeUsd);
  const prizePlaces = Number(body.prizePlaces);
  if (!Number.isInteger(prizePlaces) || prizePlaces < 1 || prizePlaces > 50) throw httpError(400, "Prize places must be between 1 and 50");
  const durationSeconds = Number(body.durationSeconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 7_776_000) {
    throw httpError(400, "Countdown must be between one minute and 90 days");
  }
  const startsAt = now();
  const endsAt = startsAt + durationSeconds * 1000;
  await env.DB.prepare(`
    INSERT INTO leaderboard_campaigns(
      cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at, updated_by
    ) VALUES(?, ?, ?, 'active', ?, ?, ?, ?, ?)
    ON CONFLICT(cadence) DO UPDATE SET
      prize_usd_cents = excluded.prize_usd_cents,
      prize_places = excluded.prize_places,
      status = 'active',
      duration_seconds = excluded.duration_seconds,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).bind(normalizedCadence, prizeUsdCents, prizePlaces, durationSeconds, startsAt, endsAt, startsAt, user.sub).run();
  await writeAdminAudit(env, user, "leaderboard.started", normalizedCadence, JSON.stringify({ prizeUsdCents, prizePlaces, durationSeconds, endsAt }));
  const row = await env.DB.prepare(`
    SELECT cadence, prize_usd_cents, prize_places, status, duration_seconds, starts_at, ends_at, updated_at
    FROM leaderboard_campaigns WHERE cadence = ?
  `).bind(normalizedCadence).first();
  return json(request, env, 201, { leaderboard: leaderboardResponse(row, normalizedCadence) });
}

const ADMIN_LEDGER_GAME_PREFIXES = Object.freeze([
  ["blackjack", "Blackjack"], ["coinflip", "Coinflip"], ["roulette", "Roulette"],
  ["plinko", "Plinko"], ["towers", "Towers"], ["crash", "Crash"],
  ["mines", "Mines"], ["moles", "Moles"], ["limbo", "Limbo"], ["wheel", "Wheel"],
  ["keno", "Keno"], ["hilo", "Hi-Lo"], ["dice", "Dice"], ["stack", "Stack"],
]);

function adminLedgerGame(id) {
  const normalized = String(id || "").toLowerCase();
  return ADMIN_LEDGER_GAME_PREFIXES.find(([prefix]) => normalized.startsWith(`${prefix}_`))?.[1] || null;
}

function adminLedgerAmount(value) {
  const units = Number(value || 0);
  if (!Number.isSafeInteger(units)) return "0.00000000";
  return `${units < 0 ? "-" : ""}${assetUnitsToString(Math.abs(units), false)}`;
}

async function handleAdminTransactions(request, env, user) {
  await requireAdminSession(request, env, user);
  const url = new URL(request.url);
  const category = String(url.searchParams.get("type") || "all").toLowerCase();
  const game = String(url.searchParams.get("game") || "all").toLowerCase();
  const query = String(url.searchParams.get("query") || "").trim().slice(0, 80);
  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(25, Math.floor(requestedLimit))) : 100;
  const categorySql = {
    wagers: "l.type IN ('game_wager', 'game_bet')",
    payouts: "l.type = 'game_payout'",
    deposits: "l.type = 'deposit'",
    withdrawals: "l.type LIKE 'withdrawal%'",
    adjustments: "l.type = 'admin_balance_set'",
  };
  const gamePrefixes = new Set(ADMIN_LEDGER_GAME_PREFIXES.map(([prefix]) => prefix));
  const clauses = [];
  const bindings = [];
  if (categorySql[category]) clauses.push(categorySql[category]);
  if (gamePrefixes.has(game)) {
    clauses.push("l.id LIKE ?");
    bindings.push(`${game}_%`);
  }
  if (query) {
    clauses.push("(l.uid LIKE ? OR profile.username LIKE ? OR l.id LIKE ? OR l.provider_reference LIKE ?)");
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows, summary] = await Promise.all([
    env.DB.prepare(`
      SELECT l.id, l.uid, profile.username, l.currency, l.type, l.amount_units,
             l.provider_reference, l.created_at
      FROM crypto_ledger l
      LEFT JOIN player_profiles profile ON profile.uid = l.uid
      ${where}
      ORDER BY l.created_at DESC
      LIMIT ?
    `).bind(...bindings, limit).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN type IN ('game_wager', 'game_bet') THEN 1 ELSE 0 END) AS wagers,
        SUM(CASE WHEN type = 'game_payout' THEN 1 ELSE 0 END) AS payouts,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS deposits,
        SUM(CASE WHEN type LIKE 'withdrawal%' THEN 1 ELSE 0 END) AS withdrawals
      FROM crypto_ledger WHERE created_at >= ?
    `).bind(now() - 24 * 60 * 60 * 1000).first(),
  ]);
  return json(request, env, 200, {
    generatedAt: new Date(now()).toISOString(),
    summary: {
      total24h: Number(summary?.total || 0), wagers24h: Number(summary?.wagers || 0),
      payouts24h: Number(summary?.payouts || 0), deposits24h: Number(summary?.deposits || 0),
      withdrawals24h: Number(summary?.withdrawals || 0),
    },
    transactions: (rows.results || []).map((row) => ({
      id: row.id,
      uid: row.uid,
      username: row.username || null,
      currency: row.currency,
      type: row.type,
      game: adminLedgerGame(row.id),
      amount: adminLedgerAmount(row.amount_units),
      direction: Number(row.amount_units) < 0 ? "debit" : Number(row.amount_units) > 0 ? "credit" : "neutral",
      reference: row.provider_reference || null,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    })),
  });
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
      SELECT l.id, l.uid, profile.username, l.currency, l.type, l.amount_units,
             l.provider_reference, l.created_at AS occurred_at
      FROM crypto_ledger l
      LEFT JOIN player_profiles profile ON profile.uid = l.uid
      ORDER BY l.created_at DESC LIMIT 12
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
      username: row.username || null,
      game: adminLedgerGame(row.id),
      currency: row.currency,
      amount: adminLedgerAmount(row.amount_units),
      direction: Number(row.amount_units) < 0 ? "debit" : Number(row.amount_units) > 0 ? "credit" : "neutral",
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
        SELECT p.uid, profile.username, p.selected_currency, p.updated_at,
               COALESCE(SUM(b.available_units), 0) AS available_units,
               COALESCE(SUM(b.held_units), 0) AS held_units,
               COUNT(b.currency) AS asset_count,
               MAX(b.updated_at) AS balance_updated_at
        FROM wallet_preferences p
        LEFT JOIN player_profiles profile ON profile.uid = p.uid
        LEFT JOIN crypto_balances b ON b.uid = p.uid
        WHERE p.uid LIKE ? OR profile.username LIKE ?
        GROUP BY p.uid ORDER BY COALESCE(MAX(b.updated_at), p.updated_at) DESC LIMIT ?
      `).bind(`%${query}%`, `%${query}%`, limit).all()
    : await env.DB.prepare(`
        SELECT p.uid, profile.username, p.selected_currency, p.updated_at,
               COALESCE(SUM(b.available_units), 0) AS available_units,
               COALESCE(SUM(b.held_units), 0) AS held_units,
               COUNT(b.currency) AS asset_count,
               MAX(b.updated_at) AS balance_updated_at
        FROM wallet_preferences p
        LEFT JOIN player_profiles profile ON profile.uid = p.uid
        LEFT JOIN crypto_balances b ON b.uid = p.uid
        GROUP BY p.uid ORDER BY COALESCE(MAX(b.updated_at), p.updated_at) DESC LIMIT ?
      `).bind(limit).all();
  let prices = {};
  try { prices = await providerPrices(env); } catch { prices = {}; }
  const users = await Promise.all((result.results || []).map(async (row) => {
    const balanceResult = await env.DB.prepare(`
      SELECT currency, available_units, held_units FROM crypto_balances
      WHERE uid = ? ORDER BY currency
    `).bind(row.uid).all();
    return {
      uid: row.uid,
      username: row.username || null,
      selectedCurrency: row.selected_currency,
      assetCount: Number(row.asset_count || 0),
      lastWalletActivity: new Date(Number(row.balance_updated_at || row.updated_at || 0)).toISOString(),
      balances: (balanceResult.results || []).map((balance) => {
        const asset = getWalletAsset(balance.currency);
        const availableUsdCents = assetUnitsToUsdCents(balance.available_units, asset, prices);
        const heldUsdCents = assetUnitsToUsdCents(balance.held_units, asset, prices);
        return {
          currency: balance.currency,
          available: assetUnitsToString(Number(balance.available_units || 0)),
          held: assetUnitsToString(Number(balance.held_units || 0)),
          availableUsd: availableUsdCents === null ? null : (availableUsdCents / 100).toFixed(2),
          heldUsd: heldUsdCents === null ? null : (heldUsdCents / 100).toFixed(2),
        };
      }),
    };
  }));
  return json(request, env, 200, { users });
}

async function handleAdminSetBalance(request, env, user, uid, currency) {
  await requireAdminSession(request, env, user);
  const targetUid = decodeURIComponent(uid);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(targetUid)) throw httpError(400, "Choose a valid player");
  const asset = requireWalletAsset(currency);
  const body = await requestJson(request);
  const reason = String(body.reason || "").trim().replace(/[\r\n]+/g, " ").slice(0, 200);
  if (reason.length < 3) throw httpError(400, "Add a brief reason for this balance change");
  const requestedUsdCents = parseUsdCents(body.amountUsd, "Available balance");
  const nextUnits = await usdCentsToAssetUnits(env, requestedUsdCents, asset);
  const account = await env.DB.prepare(`
    SELECT uid FROM wallet_preferences WHERE uid = ?
    UNION SELECT uid FROM player_profiles WHERE uid = ? LIMIT 1
  `).bind(targetUid, targetUid).first();
  if (!account) throw httpError(404, "That player account was not found");
  const current = await env.DB.prepare("SELECT available_units, held_units FROM crypto_balances WHERE uid = ? AND currency = ?")
    .bind(targetUid, asset.code).first();
  const previousUnits = Number(current?.available_units || 0);
  if (previousUnits === nextUnits) throw httpError(409, "That balance is already set to this amount");
  const timestamp = now();
  const auditId = crypto.randomUUID();
  const detail = JSON.stringify({
    asset: asset.code,
    requestedUsd: (requestedUsdCents / 100).toFixed(2),
    previous: assetUnitsToString(previousUnits),
    next: assetUnitsToString(nextUnits),
    reason,
  });
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO crypto_balances(
        uid, currency, available_units, held_units, lifetime_deposited_units, lifetime_withdrawn_units, created_at, updated_at
      ) VALUES(?, ?, ?, 0, 0, 0, ?, ?)
      ON CONFLICT(uid, currency) DO UPDATE SET available_units = excluded.available_units, updated_at = excluded.updated_at
    `).bind(targetUid, asset.code, nextUnits, timestamp, timestamp),
    env.DB.prepare(`
      INSERT INTO crypto_ledger(id, uid, currency, type, amount_units, provider_reference, created_at)
      VALUES(?, ?, ?, 'admin_balance_set', ?, ?, ?)
    `).bind(crypto.randomUUID(), targetUid, asset.code, nextUnits - previousUnits, `admin:${auditId}`, timestamp),
    env.DB.prepare(`
      INSERT INTO admin_audit_log(id, uid, event_type, target_id, detail, created_at)
      VALUES(?, ?, 'player.balance.set', ?, ?, ?)
    `).bind(auditId, user.sub, `${targetUid}:${asset.code}`, detail.slice(0, 500), timestamp),
  ]);
  return json(request, env, 200, {
    balance: {
      uid: targetUid,
      currency: asset.code,
      available: assetUnitsToString(nextUnits),
      availableUsd: (requestedUsdCents / 100).toFixed(2),
      held: assetUnitsToString(Number(current?.held_units || 0)),
      updatedAt: new Date(timestamp).toISOString(),
    },
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
      promotions: true,
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
  countryAccessCache.delete(normalized);
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
  if (request.method === "GET" && path === "/leaderboards") return handleLeaderboards(request, env, await optionalUser(request, env));
  if (request.method === "GET" && path === "/games/settings") return handleGameSettings(request, env);
  if (request.method === "POST" && path === "/webhooks/oxapay/deposit") return handleDepositWebhook(request, env);
  if (request.method === "POST" && path === "/webhooks/oxapay/payout") return handlePayoutWebhook(request, env);

  const user = await requireUser(request, env);
  if (request.method === "GET" && path === "/admin/access") return handleAdminAccess(request, env, user);
  if (request.method === "POST" && path === "/admin/session") return handleCreateAdminSession(request, env, user);
  if (request.method === "GET" && path === "/admin/session") return handleGetAdminSession(request, env, user);
  if (request.method === "GET" && path === "/admin/overview") return handleAdminOverview(request, env, user);
  if (request.method === "GET" && path === "/admin/transactions") return handleAdminTransactions(request, env, user);
  if (request.method === "GET" && path === "/admin/users") return handleAdminUsers(request, env, user);
  const adminBalanceMatch = path.match(/^\/admin\/users\/([^/]+)\/balances\/([A-Za-z0-9_-]+)$/);
  if (request.method === "POST" && adminBalanceMatch) return handleAdminSetBalance(request, env, user, adminBalanceMatch[1], adminBalanceMatch[2]);
  if (request.method === "GET" && path === "/admin/deposits") return handleAdminDeposits(request, env, user);
  if (request.method === "GET" && path === "/admin/audit") return handleAdminAudit(request, env, user);
  if (request.method === "GET" && path === "/admin/system") return handleAdminSystem(request, env, user);
  if (request.method === "GET" && path === "/admin/country-access") return handleAdminCountryAccess(request, env, user);
  if (request.method === "GET" && path === "/admin/leaderboards") return handleAdminLeaderboards(request, env, user);
  if (request.method === "GET" && path === "/admin/promotions") return handleAdminPromotions(request, env, user);
  if (request.method === "POST" && path === "/admin/promotions") return handleAdminCreatePromotion(request, env, user);
  const removePromotionMatch = path.match(/^\/admin\/promotions\/([A-Za-z0-9-]+)\/remove$/);
  if (request.method === "POST" && removePromotionMatch) return handleAdminRemovePromotion(request, env, user, removePromotionMatch[1]);
  if (request.method === "GET" && path === "/admin/game-edges") return handleAdminGameEdges(request, env, user);
  const gameEdgeMatch = path.match(/^\/admin\/game-edges\/([a-z0-9-]+)$/);
  if (request.method === "POST" && gameEdgeMatch) return handleAdminSetGameEdge(request, env, user, gameEdgeMatch[1]);
  const gameMaintenanceMatch = path.match(/^\/admin\/games\/([a-z0-9-]+)\/maintenance$/);
  if (request.method === "POST" && gameMaintenanceMatch) return handleAdminSetGameMaintenance(request, env, user, gameMaintenanceMatch[1]);
  const leaderboardStartMatch = path.match(/^\/admin\/leaderboards\/(daily|weekly|biweekly|monthly)\/start$/);
  if (request.method === "POST" && leaderboardStartMatch) return handleAdminStartLeaderboard(request, env, user, leaderboardStartMatch[1]);
  const countryAccessMatch = path.match(/^\/admin\/country-access\/([A-Za-z]{2})$/);
  if (request.method === "POST" && countryAccessMatch) return handleAdminSetCountryAccess(request, env, user, countryAccessMatch[1]);
  if (!path.startsWith("/admin/")) {
    const geo = await requireAllowedRegion(request, env);
    try { await touchUserSession(request, env, user, geo); }
    catch (error) { console.error("Session activity write failed", { message: error?.message }); }
  }
  if (request.method === "GET" && path === "/sessions") return handleSessions(request, env, user);
  if (request.method === "GET" && path === "/wallet") return handleGetWallet(request, env, user);
  if (request.method === "GET" && path === "/account") return handleAccountSnapshot(request, env, user);
  if (request.method === "GET" && path === "/account/activity") return handleAccountActivity(request, env, user);
  if (request.method === "POST" && path === "/account/details") return handleAccountDetails(request, env, user);
  if (request.method === "POST" && path === "/account/preferences") return handleAccountPreferences(request, env, user);
  if (request.method === "POST" && path === "/promotions/claim") return handlePromotionClaim(request, env, user);
  if (request.method === "POST" && path === "/profile/sync") return handleSyncProfile(request, env, user);
  if (request.method === "POST" && path === "/wallet/selection") return handleSelectCurrency(request, env, user);
  if (request.method === "GET" && path === "/games/history") return handleGameHistory(request, env, user);
  if (request.method === "POST" && NEW_GAME_BET_PATHS[path]) await requireGameAvailable(env, NEW_GAME_BET_PATHS[path]);
  if (request.method === "GET" && path === "/games/towers/rounds/active") return handleGetActiveTowersRound(request, env, user);
  if (request.method === "POST" && path === "/games/towers/rounds") return handleStartTowersRound(request, env, user);
  const towersChooseMatch = path.match(/^\/games\/towers\/rounds\/([A-Za-z0-9-]+)\/choose$/);
  if (request.method === "POST" && towersChooseMatch) return handleChooseTowersTile(request, env, user, towersChooseMatch[1]);
  const towersCashoutMatch = path.match(/^\/games\/towers\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && towersCashoutMatch) return handleCashoutTowersRound(request, env, user, towersCashoutMatch[1]);
  if (request.method === "GET" && path === "/games/moles/rounds/active") return handleGetActiveMolesRound(request, env, user);
  if (request.method === "POST" && path === "/games/moles/rounds") return handleStartMolesRound(request, env, user);
  const molesChooseMatch = path.match(/^\/games\/moles\/rounds\/([A-Za-z0-9-]+)\/choose$/);
  if (request.method === "POST" && molesChooseMatch) return handleChooseMolesHole(request, env, user, molesChooseMatch[1]);
  const molesCashoutMatch = path.match(/^\/games\/moles\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && molesCashoutMatch) return handleCashoutMolesRound(request, env, user, molesCashoutMatch[1]);
  if (request.method === "GET" && path === "/games/stack/rounds/active") return handleGetActiveStackRound(request, env, user);
  if (request.method === "POST" && path === "/games/stack/rounds") return handleStartStackRound(request, env, user);
  const stackDropMatch = path.match(/^\/games\/stack\/rounds\/([A-Za-z0-9-]+)\/drop$/);
  if (request.method === "POST" && stackDropMatch) return handleDropStackLevel(request, env, user, stackDropMatch[1]);
  const stackCashoutMatch = path.match(/^\/games\/stack\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && stackCashoutMatch) return handleCashoutStackRound(request, env, user, stackCashoutMatch[1]);
  if (request.method === "GET" && path === "/games/blackjack/rounds/active") return handleGetActiveBlackjackRound(request, env, user);
  if (request.method === "POST" && path === "/games/blackjack/rounds") return handleStartBlackjackRound(request, env, user);
  const blackjackActionMatch = path.match(/^\/games\/blackjack\/rounds\/([A-Za-z0-9-]+)\/action$/);
  if (request.method === "POST" && blackjackActionMatch) return handleBlackjackAction(request, env, user, blackjackActionMatch[1]);
  if (request.method === "GET" && path === "/games/crash/live") return handleCrashLive(request, env, user);
  if (request.method === "POST" && path === "/games/crash/wagers") return handleCrashWager(request, env, user);
  const crashCashoutMatch = path.match(/^\/games\/crash\/wagers\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && crashCashoutMatch) return handleCrashCashout(request, env, user, crashCashoutMatch[1]);
  if (request.method === "GET" && path === "/games/hi-lo/rounds/active") return handleGetActiveHiloRound(request, env, user);
  if (request.method === "POST" && path === "/games/hi-lo/rounds") return handleStartHiloRound(request, env, user);
  const hiloGuessMatch = path.match(/^\/games\/hi-lo\/rounds\/([A-Za-z0-9-]+)\/guess$/);
  if (request.method === "POST" && hiloGuessMatch) return handleHiloGuess(request, env, user, hiloGuessMatch[1]);
  const hiloCashoutMatch = path.match(/^\/games\/hi-lo\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && hiloCashoutMatch) return handleHiloCashout(request, env, user, hiloCashoutMatch[1]);
  if (request.method === "GET" && path === "/games/coinflip/rounds/active") return handleGetActiveCoinflipRound(request, env, user);
  if (request.method === "POST" && path === "/games/coinflip/rounds") return handleStartCoinflipRound(request, env, user);
  const coinflipGuessMatch = path.match(/^\/games\/coinflip\/rounds\/([A-Za-z0-9-]+)\/guess$/);
  if (request.method === "POST" && coinflipGuessMatch) return handleCoinflipGuess(request, env, user, coinflipGuessMatch[1]);
  const coinflipCashoutMatch = path.match(/^\/games\/coinflip\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && coinflipCashoutMatch) return handleCoinflipCashout(request, env, user, coinflipCashoutMatch[1]);
  if (request.method === "POST" && path === "/games/dice/bets") return handleDiceBet(request, env, user);
  if (request.method === "POST" && path === "/games/limbo/bets") return handleLimboBet(request, env, user);
  if (request.method === "POST" && path === "/games/plinko/bets") return handlePlinkoBet(request, env, user);
  if (request.method === "GET" && path === "/games/wheel/bets/active") return handleGetActiveWheelBet(request, env, user);
  if (request.method === "POST" && path === "/games/wheel/bets") return handleStartWheelBet(request, env, user);
  const wheelSettleMatch = path.match(/^\/games\/wheel\/bets\/([A-Za-z0-9-]+)\/settle$/);
  if (request.method === "POST" && wheelSettleMatch) return handleSettleWheelBet(request, env, user, wheelSettleMatch[1]);
  if (request.method === "GET" && path === "/games/keno/bets/active") return handleGetActiveKenoBet(request, env, user);
  if (request.method === "POST" && path === "/games/keno/bets") return handleStartKenoBet(request, env, user);
  const kenoSettleMatch = path.match(/^\/games\/keno\/bets\/([A-Za-z0-9-]+)\/settle$/);
  if (request.method === "POST" && kenoSettleMatch) return handleSettleKenoBet(request, env, user, kenoSettleMatch[1]);
  if (request.method === "GET" && path === "/games/roulette/recent") return handleRouletteRecent(request, env, user);
  if (request.method === "GET" && path === "/games/roulette/live") return handleSharedRouletteRound(request, env, user);
  if (request.method === "GET" && path === "/games/roulette/rounds/active") return handleRouletteActiveRound(request, env, user);
  if (request.method === "POST" && path === "/games/roulette/wagers") return handleSharedRouletteWager(request, env, user);
  const rouletteSettleMatch = path.match(/^\/games\/roulette\/rounds\/([A-Za-z0-9_-]+)\/settle$/);
  if (request.method === "POST" && rouletteSettleMatch) return handleRouletteSettle(request, env, user, rouletteSettleMatch[1]);
  if (request.method === "GET" && path === "/games/mines/rounds/active") return handleGetActiveMinesRound(request, env, user);
  if (request.method === "POST" && path === "/games/mines/rounds") return handleStartMinesRound(request, env, user);
  const minesRevealMatch = path.match(/^\/games\/mines\/rounds\/([A-Za-z0-9-]+)\/reveal$/);
  if (request.method === "POST" && minesRevealMatch) return handleRevealMinesTile(request, env, user, minesRevealMatch[1]);
  const minesCashoutMatch = path.match(/^\/games\/mines\/rounds\/([A-Za-z0-9-]+)\/cashout$/);
  if (request.method === "POST" && minesCashoutMatch) return handleCashoutMinesRound(request, env, user, minesCashoutMatch[1]);
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
  if (error?.code === "GAME_MAINTENANCE") return error.message;
  if (isD1CapacityError(error)) return "Wallet services are temporarily unavailable because database capacity has been reached. No balance-changing action was completed. Please retry shortly.";
  if (status >= 500) return "The wallet service could not complete that request";
  return error?.message || "The wallet service could not complete that request";
}

function isD1CapacityError(error) {
  const detail = `${error?.message || ""} ${error?.cause?.message || ""}`;
  return error?.code === 7500 || /D1.*(?:daily|limit|quota)|rows? read limit|exceeded D1/i.test(detail);
}

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin");
      if (origin && !allowedOrigins(env).has(origin)) return json(request, env, 403, { error: "Origin is not allowed" });
      return await route(request, env);
    } catch (error) {
      const capacityLimited = isD1CapacityError(error);
      const status = capacityLimited ? 503 : Number(error?.httpStatus || 500);
      if (status >= 500) console.error("Wallet request failed", { path: pathFrom(request), message: error?.message, code: error?.code });
      return json(request, env, status, {
        error: publicError(error),
        ...(capacityLimited ? { code: "DATABASE_CAPACITY_REACHED", retryable: true } : {}),
      });
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(maintainLiveGameTimelines(env, now()));
  },
};
