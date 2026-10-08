import {
  DEFAULT_LIMITS,
  assetUnitsToString,
  createIpnSignature,
  maskAddress,
  normalizeAddress,
  normalizeCurrency,
  normalizeExtraId,
  normalizeRequestId,
  parseAssetUnits,
  parseUsdCents,
  paymentIsTerminal,
  providerAmountToUnits,
  signaturesMatch,
} from "./core.js";
import { DEFAULT_WALLET_ASSET, WALLET_ASSETS, getWalletAsset, requireWalletAsset } from "./assets.js";

let firebaseKeys;
let firebaseKeysExpiresAt = 0;
let currencyCache;
let currencyCacheExpiresAt = 0;

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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
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

function requireOwner(user, env) {
  if (!env.OWNER_FIREBASE_UID) throw httpError(503, "Owner access has not been configured");
  if (user.sub !== env.OWNER_FIREBASE_UID) throw httpError(403, "Owner access is required");
}

async function nowPayments(env, path, options = {}) {
  if (!env.NOWPAYMENTS_API_KEY) throw httpError(503, "Wallet payments are not configured yet");
  const url = new URL(`${String(env.NOWPAYMENTS_API_BASE || "https://api.nowpayments.io/v1").replace(/\/$/, "")}${path}`);
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": env.NOWPAYMENTS_API_KEY,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("NOWPayments request failed", {
      path,
      status: response.status,
      code: body?.code || body?.status,
      message: String(body?.message || body?.error || "").slice(0, 200),
    });
    throw httpError(response.status >= 500 ? 502 : 400, "The payment service could not complete that request", "PROVIDER_ERROR");
  }
  return body;
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
  const selected = balances.find((balance) => balance.code === selectedCurrency) || balances[0];
  let selectedUsdCents = 0;
  if (Number(selected.available) > 0) {
    try {
      const estimate = await nowPayments(env, "/estimate", {
        query: { amount: selected.available, currency_from: selected.code, currency_to: "usd" },
      });
      selectedUsdCents = Math.max(0, Math.round(Number(estimate.estimated_amount || 0) * 100));
    } catch {
      selectedUsdCents = 0;
    }
  }
  return { selectedCurrency, selectedUsdCents, balances };
}

function depositResponse(row) {
  return {
    id: String(row.payment_id),
    status: row.status,
    requestedUsdCents: Number(row.requested_usd_cents),
    payAmount: String(row.pay_amount),
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
    FROM crypto_deposits WHERE uid = ?
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

function normalizeProviderCurrencies(body) {
  // NOWPayments' merchant-specific endpoint returns `selectedCurrencies`,
  // while the general currency endpoints return `currencies` (or an array).
  const source = Array.isArray(body?.selectedCurrencies)
    ? body.selectedCurrencies
    : Array.isArray(body?.currencies)
      ? body.currencies
      : Array.isArray(body)
        ? body
        : [];
  return source.map((entry) => {
    if (typeof entry === "string") return { code: entry.toLowerCase(), name: entry.toUpperCase(), network: null, requiresExtraId: false };
    return {
      code: String(entry?.code || "").toLowerCase(),
      name: entry?.name || String(entry?.code || "").toUpperCase(),
      network: entry?.network ? String(entry.network).toLowerCase() : null,
      requiresExtraId: Boolean(entry?.extra_id_exists),
      enabled: entry?.enable == null ? true : Boolean(entry.enable),
    };
  }).filter((entry) => entry.code && entry.enabled !== false)
    .map(({ enabled: _enabled, ...entry }) => entry)
    .sort((left, right) => left.code.localeCompare(right.code));
}

async function handleCurrencies(request, env) {
  if (!currencyCache || currencyCacheExpiresAt < now()) {
    currencyCache = normalizeProviderCurrencies(await nowPayments(env, "/merchant/coins"));
    currencyCacheExpiresAt = now() + 5 * 60 * 1000;
  }
  const available = new Set(currencyCache.map((currency) => currency.code));
  return json(request, env, 200, {
    currencies: WALLET_ASSETS.filter((asset) => available.has(asset.code)),
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

async function existingDepositForRequest(env, uid, requestId) {
  return env.DB.prepare("SELECT * FROM crypto_deposits WHERE uid = ? AND request_id = ?").bind(uid, requestId).first();
}

async function currentMinimumDepositUsdCents(env, payCurrency) {
  const configuredFloor = envNumber(env, "MINIMUM_DEPOSIT_USD_CENTS", DEFAULT_LIMITS.minimumDepositUsdCents);
  try {
    const minimum = await nowPayments(env, "/min-amount", {
      query: {
        currency_from: payCurrency,
        currency_to: payCurrency,
        fiat_equivalent: "usd",
      },
    });
    let minimumUsd = Number(minimum.fiat_equivalent || minimum.min_amount_fiat || 0);
    if (!(minimumUsd > 0) && Number(minimum.min_amount) > 0) {
      const estimate = await nowPayments(env, "/estimate", {
        query: {
          amount: minimum.min_amount,
          currency_from: payCurrency,
          currency_to: "usd",
        },
      });
      minimumUsd = Number(estimate.estimated_amount || 0);
    }
    if (minimumUsd > 0) {
      // Keep a small buffer so a quote does not fall below a changing network minimum
      // between checking the limit and creating the payment address.
      return Math.max(configuredFloor, Math.ceil(minimumUsd * 1.05 * 100));
    }
  } catch (error) {
    console.error("Could not resolve dynamic deposit minimum", { payCurrency, code: error?.code || "unknown" });
  }
  return Math.max(configuredFloor, 500);
}

async function handleCreateDeposit(request, env, user) {
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const payCurrency = requireWalletAsset(normalizeCurrency(body.payCurrency)).code;
  await enforceCooldown(env, user.sub, `deposit:${payCurrency}`, 3);
  const minimumUsdCents = await currentMinimumDepositUsdCents(env, payCurrency);
  const amountUsdCents = body.amountUsd == null || body.amountUsd === ""
    ? minimumUsdCents
    : parseUsdCents(body.amountUsd, {
      minimumUsdCents,
      maximumUsdCents: envNumber(env, "MAXIMUM_DEPOSIT_USD_CENTS", DEFAULT_LIMITS.maximumDepositUsdCents),
    });
  await ensureWalletPreference(env, user.sub);

  const existing = await existingDepositForRequest(env, user.sub, requestId);
  if (existing) return json(request, env, 200, { deposit: depositResponse(existing) });

  const timestamp = now();
  const requestKey = `${user.sub}:${requestId}`;
  const reserved = await env.DB.prepare(`
    INSERT OR IGNORE INTO crypto_deposit_requests(
      id, uid, request_id, status, requested_usd_cents, pay_currency, created_at, updated_at
    ) VALUES(?, ?, ?, 'creating', ?, ?, ?, ?)
  `).bind(requestKey, user.sub, requestId, amountUsdCents, payCurrency, timestamp, timestamp).run();

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
    const orderId = `GRD-${requestId}`.slice(0, 64);
    const payment = await nowPayments(env, "/payment", {
      method: "POST",
      body: {
        price_amount: amountUsdCents / 100,
        price_currency: "usd",
        pay_currency: payCurrency,
        payout_currency: payCurrency,
        order_id: orderId,
        order_description: "GamRace wallet deposit",
        ipn_callback_url: `${String(env.PUBLIC_BASE_URL).replace(/\/$/, "")}/ipn/deposit`,
      },
    });
    if (!payment.payment_id || !payment.pay_address || !payment.pay_amount) throw httpError(502, "The payment service returned incomplete deposit details");
    const paymentId = String(payment.payment_id);
    const status = String(payment.payment_status || payment.status || "waiting").toLowerCase();
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
        requestId,
        orderId,
        status,
        amountUsdCents,
        String(payment.pay_amount),
        String(payment.pay_currency || payCurrency).toLowerCase(),
        String(payment.pay_address),
        payment.payin_extra_id || null,
        payment.network || null,
        payment.expiration_estimate_date || payment.valid_until || null,
        String(payment.actually_paid || payment.amount_received || "0"),
        status === "finished" ? providerAmountToUnits(payment.actually_paid || payment.amount_received) : 0,
        payment.created_at || null,
        payment.updated_at || null,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(`
        UPDATE crypto_deposit_requests SET status = 'created', payment_id = ?, updated_at = ? WHERE id = ?
      `).bind(paymentId, timestamp, requestKey),
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

async function applyProviderPayment(env, payment) {
  const paymentId = String(payment?.payment_id || payment?.id || "");
  if (!paymentId) throw httpError(400, "Payment identifier is missing");
  const deposit = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(paymentId).first();
  if (!deposit) throw httpError(404, "Deposit not found");
  if (payment.order_id && payment.order_id !== deposit.order_id) throw httpError(409, "Payment reference mismatch");
  const providerCurrency = normalizeCurrency(payment.pay_currency || deposit.pay_currency);
  if (providerCurrency !== deposit.pay_currency) throw httpError(409, "Payment currency mismatch");
  const providerPriceCents = Math.round(Number(payment.price_amount || 0) * 100);
  if (providerPriceCents && providerPriceCents !== Number(deposit.requested_usd_cents)) throw httpError(409, "Payment amount mismatch");
  const status = String(payment.payment_status || payment.status || deposit.status).toLowerCase();
  const timestamp = now();
  await env.DB.prepare(`
    UPDATE crypto_deposits
    SET status = ?, actually_paid = ?, credit_units = ?, provider_updated_at = ?, updated_at = ?
    WHERE payment_id = ?
  `).bind(
    status,
    String(payment.actually_paid || payment.amount_received || "0"),
    status === "finished" ? providerAmountToUnits(payment.actually_paid || payment.amount_received) : Number(deposit.credit_units || 0),
    payment.updated_at || null,
    timestamp,
    paymentId,
  ).run();
  return env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ?").bind(paymentId).first();
}

async function handleGetDeposit(request, env, user, paymentId) {
  let deposit = await env.DB.prepare("SELECT * FROM crypto_deposits WHERE payment_id = ? AND uid = ?").bind(paymentId, user.sub).first();
  if (!deposit) throw httpError(404, "Deposit not found");
  if (!deposit.credited && !paymentIsTerminal(deposit.status)) {
    deposit = await applyProviderPayment(env, await nowPayments(env, `/payment/${encodeURIComponent(paymentId)}`));
  }
  return json(request, env, 200, { deposit: depositResponse(deposit) });
}

async function handleDepositIpn(request, env) {
  if (!env.NOWPAYMENTS_IPN_SECRET) throw httpError(503, "Payment notifications are not configured");
  const body = await requestJson(request);
  const received = request.headers.get("x-nowpayments-sig") || "";
  const expected = await createIpnSignature(body, env.NOWPAYMENTS_IPN_SECRET);
  if (!signaturesMatch(received, expected)) throw httpError(401, "Invalid signature");
  const paymentId = String(body.payment_id || body.id || "");
  if (!paymentId) throw httpError(400, "Payment identifier is missing");
  const verified = await nowPayments(env, `/payment/${encodeURIComponent(paymentId)}`);
  await applyProviderPayment(env, verified);
  return json(request, env, 200, { ok: true });
}

async function handleCreateWithdrawal(request, env, user) {
  await enforceCooldown(env, user.sub, "withdrawal", 5);
  const body = await requestJson(request);
  const requestId = normalizeRequestId(body.requestId);
  const requestedUnits = parseAssetUnits(body.amount);
  const payoutCurrency = requireWalletAsset(normalizeCurrency(body.payoutCurrency)).code;
  const address = normalizeAddress(body.address);
  const extraId = normalizeExtraId(body.extraId);
  const id = `${user.sub}_${requestId}`;
  const existing = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ? AND uid = ?").bind(id, user.sub).first();
  if (existing) return json(request, env, 200, { withdrawal: withdrawalResponse(existing) });

  const preference = await ensureWalletPreference(env, user.sub);
  if (preference.selected_currency !== payoutCurrency) throw httpError(409, "Withdraw from the balance currently selected in your wallet");
  await nowPayments(env, "/payout/validate-address", {
    method: "POST",
    body: { address, currency: payoutCurrency, extra_id: extraId || undefined },
  });
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
  const withdrawal = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ? AND uid = ?").bind(withdrawalId, user.sub).first();
  if (!withdrawal) throw httpError(404, "Withdrawal not found");
  return json(request, env, 200, { withdrawal: withdrawalResponse(withdrawal) });
}

async function handleAdminWithdrawals(request, env, user) {
  requireOwner(user, env);
  const result = await env.DB.prepare(`
    SELECT id, uid, status, hold_state, requested_units, payout_amount, payout_currency,
           address, extra_id, provider_reference, review_note, created_at, updated_at
    FROM crypto_withdrawals
    WHERE status = 'pending_review'
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
  requireOwner(user, env);
  const body = await requestJson(request);
  const current = await env.DB.prepare("SELECT * FROM crypto_withdrawals WHERE id = ?").bind(withdrawalId).first();
  if (!current) throw httpError(404, "Withdrawal not found");
  if (current.status !== "pending_review") throw httpError(409, "Withdrawal has already been reviewed");
  const timestamp = now();
  if (decision === "complete") {
    const providerReference = String(body.providerReference || "").trim();
    if (providerReference.length < 3 || providerReference.length > 160) throw httpError(400, "Enter the completed NOWPayments payout reference");
    await env.DB.prepare(`
      UPDATE crypto_withdrawals
      SET status = 'finished', provider_reference = ?, review_note = ?, updated_at = ?
      WHERE id = ? AND status = 'pending_review'
    `).bind(providerReference, String(body.note || "").slice(0, 500) || null, timestamp, withdrawalId).run();
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
  return json(request, env, 200, { withdrawal: withdrawalResponse(updated) });
}

function pathFrom(request) {
  return new URL(request.url).pathname.replace(/\/+$/, "") || "/";
}

async function route(request, env) {
  const path = pathFrom(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method === "GET" && path === "/health") return json(request, env, 200, { ok: true, provider: "nowpayments", mode: "live" });
  if (request.method === "POST" && path === "/ipn/deposit") return handleDepositIpn(request, env);

  const user = await requireUser(request, env);
  if (request.method === "GET" && path === "/wallet") return handleGetWallet(request, env, user);
  if (request.method === "POST" && path === "/wallet/selection") return handleSelectCurrency(request, env, user);
  if (request.method === "GET" && path === "/currencies") return handleCurrencies(request, env);
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
