"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const {
  DEFAULT_LIMITS,
  createIpnSignature,
  normalizeAddress,
  normalizeCurrency,
  normalizeExtraId,
  parseUsdCents,
  paymentCanCredit,
  signaturesMatch,
} = require("./wallet-core");

initializeApp();
const db = getFirestore();

const REGION = "europe-west2";
const NOWPAYMENTS_API_KEY = defineSecret("NOWPAYMENTS_API_KEY");
const NOWPAYMENTS_IPN_SECRET = defineSecret("NOWPAYMENTS_IPN_SECRET");
const NOWPAYMENTS_EMAIL = defineSecret("NOWPAYMENTS_EMAIL");
const NOWPAYMENTS_PASSWORD = defineSecret("NOWPAYMENTS_PASSWORD");
const PAYMENT_SECRETS = [NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET];
const PAYOUT_SECRETS = [NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, NOWPAYMENTS_EMAIL, NOWPAYMENTS_PASSWORD];

const ALLOWED_ORIGINS = new Set([
  "https://gamrace.com",
  "https://www.gamrace.com",
  "http://localhost:4173",
  "http://localhost:8080",
]);

let sdkModulePromise;

function getSdkModule() {
  if (!sdkModulePromise) sdkModulePromise = import("@nowpaymentsio/nowpayments-sdk-nodejs");
  return sdkModulePromise;
}

async function createNowPaymentsSdk({ payouts = false } = {}) {
  const { NowPaymentsSDK } = await getSdkModule();
  const options = {
    apiKey: NOWPAYMENTS_API_KEY.value(),
    ipnSecret: NOWPAYMENTS_IPN_SECRET.value(),
    ipnCallbackUrl: publicFunctionUrl("nowPaymentsIpn"),
    payoutIpnCallbackUrl: publicFunctionUrl("nowPaymentsPayoutIpn"),
  };
  if (payouts) {
    options.email = NOWPAYMENTS_EMAIL.value();
    options.password = NOWPAYMENTS_PASSWORD.value();
  }
  return new NowPaymentsSDK(options);
}

function publicFunctionUrl(name) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "gamrace";
  return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
}

function setCors(req, res) {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Cache-Control", "no-store");
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function safeError(error, fallback = "The wallet service could not complete that request") {
  if (error?.name === "ValidationError" || error?.type === "validation") return error.message || fallback;
  if (error?.code === "already-exists") return "This request has already been submitted";
  return fallback;
}

function requestPath(req) {
  return String(req.path || req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
}

async function requireUser(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Sign in to use the wallet"), { httpStatus: 401 });
  try {
    return await getAuth().verifyIdToken(match[1], true);
  } catch {
    throw Object.assign(new Error("Your session has expired. Sign in again."), { httpStatus: 401 });
  }
}

function requireOwner(user) {
  if (user.owner !== true && user.admin !== true) {
    throw Object.assign(new Error("Owner access is required"), { httpStatus: 403 });
  }
}

function walletRef(uid) {
  return db.collection("wallets").doc(uid);
}

function cleanWallet(data = {}) {
  return {
    currency: "USD",
    availableUsdCents: Number(data.availableUsdCents || 0),
    heldUsdCents: Number(data.heldUsdCents || 0),
    lifetimeDepositedUsdCents: Number(data.lifetimeDepositedUsdCents || 0),
    lifetimeWithdrawnUsdCents: Number(data.lifetimeWithdrawnUsdCents || 0),
  };
}

async function ensureWallet(uid) {
  const ref = walletRef(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return;
    transaction.create(ref, {
      currency: "USD",
      availableUsdCents: 0,
      heldUsdCents: 0,
      lifetimeDepositedUsdCents: 0,
      lifetimeWithdrawnUsdCents: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const snapshot = await ref.get();
  return cleanWallet(snapshot.data());
}

async function enforceCooldown(uid, action, seconds) {
  const ref = db.collection("walletRateLimits").doc(`${uid}_${action}`);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const nextAllowedAt = snapshot.exists ? Number(snapshot.data().nextAllowedAtMs || 0) : 0;
    if (nextAllowedAt > now) {
      throw Object.assign(new Error("Please wait a moment before trying again"), { httpStatus: 429 });
    }
    transaction.set(ref, {
      uid,
      action,
      nextAllowedAtMs: now + seconds * 1000,
      expiresAt: Timestamp.fromMillis(now + Math.max(seconds, 3600) * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(requestId)) throw new Error("Invalid request identifier");
  return requestId;
}

function depositResponse(data) {
  return {
    id: data.paymentId,
    status: data.status,
    requestedUsdCents: data.requestedUsdCents,
    payAmount: data.payAmount,
    payCurrency: data.payCurrency,
    payAddress: data.payAddress,
    payinExtraId: data.payinExtraId || null,
    network: data.network || null,
    expiresAt: data.expiresAt || null,
    credited: Boolean(data.credited),
  };
}

function withdrawalResponse(id, data) {
  return {
    id,
    status: data.status,
    requestedUsdCents: data.requestedUsdCents,
    payoutAmount: data.payoutAmount,
    payoutCurrency: data.payoutCurrency,
    address: data.maskedAddress || maskAddress(data.address),
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
  };
}

function maskAddress(address) {
  const value = String(address || "");
  if (value.length < 14) return value;
  return `${value.slice(0, 7)}…${value.slice(-6)}`;
}

async function listWalletActivity(uid) {
  const [deposits, withdrawals] = await Promise.all([
    db.collection("deposits").where("uid", "==", uid).limit(25).get(),
    db.collection("withdrawals").where("uid", "==", uid).limit(25).get(),
  ]);
  const items = [
    ...deposits.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        type: "deposit",
        status: data.status,
        amountUsdCents: data.requestedUsdCents,
        currency: data.payCurrency,
        createdAt: data.createdAt?.toMillis?.() || 0,
      };
    }),
    ...withdrawals.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        type: "withdrawal",
        status: data.status,
        amountUsdCents: data.requestedUsdCents,
        currency: data.payoutCurrency,
        createdAt: data.createdAt?.toMillis?.() || 0,
      };
    }),
  ];
  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

async function handleGetWallet(user, res) {
  const wallet = await ensureWallet(user.uid);
  const activity = await listWalletActivity(user.uid);
  sendJson(res, 200, { wallet, activity });
}

async function handleCurrencies(res) {
  const sdk = await createNowPaymentsSdk();
  const currencies = await sdk.getMerchantCurrencies();
  const usable = currencies
    .filter((currency) => currency.enabled !== false && currency.enable !== false)
    .map((currency) => ({
      code: currency.code,
      name: currency.name || currency.code.toUpperCase(),
      network: currency.network || null,
      requiresExtraId: Boolean(currency.requiresExtraId),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  sendJson(res, 200, { currencies: usable });
}

async function handleCreateDeposit(user, req, res) {
  await enforceCooldown(user.uid, "deposit", 3);
  const requestId = normalizeRequestId(req.body?.requestId);
  const amountUsdCents = parseUsdCents(req.body?.amountUsd, {
    minimumUsdCents: Number(process.env.MINIMUM_DEPOSIT_USD_CENTS || DEFAULT_LIMITS.minimumDepositUsdCents),
    maximumUsdCents: Number(process.env.MAXIMUM_DEPOSIT_USD_CENTS || DEFAULT_LIMITS.maximumDepositUsdCents),
  });
  const payCurrency = normalizeCurrency(req.body?.payCurrency);
  const requestRef = db.collection("depositRequests").doc(`${user.uid}_${requestId}`);
  const requestSnapshot = await requestRef.get();
  if (requestSnapshot.exists) {
    const existing = requestSnapshot.data();
    if (existing.paymentId) {
      const depositSnapshot = await db.collection("deposits").doc(existing.paymentId).get();
      if (depositSnapshot.exists) return sendJson(res, 200, { deposit: depositResponse(depositSnapshot.data()) });
    }
    throw Object.assign(new Error("This deposit is already being created"), { httpStatus: 409 });
  }
  await requestRef.create({
    uid: user.uid,
    requestId,
    status: "creating",
    requestedUsdCents: amountUsdCents,
    payCurrency,
    createdAt: FieldValue.serverTimestamp(),
  });

  try {
    const sdk = await createNowPaymentsSdk();
    const orderId = `GRD-${requestId}`.slice(0, 64);
    const payment = await sdk.createDirectPayment({
      amount: amountUsdCents / 100,
      currency: "usd",
      payCurrency,
      orderId,
      description: "GamRace wallet deposit",
      ipnCallbackUrl: publicFunctionUrl("nowPaymentsIpn"),
      originIp: req.ip,
    });
    if (!payment.payment_id || !payment.pay_address || !payment.pay_amount) {
      throw new Error("NOWPayments did not return complete deposit details");
    }
    const paymentId = String(payment.payment_id);
    const deposit = {
      uid: user.uid,
      requestId,
      paymentId,
      orderId,
      status: payment.payment_status || "waiting",
      requestedUsdCents: amountUsdCents,
      payAmount: Number(payment.pay_amount),
      payCurrency: payment.pay_currency || payCurrency,
      payAddress: payment.pay_address,
      payinExtraId: payment.payin_extra_id || null,
      network: payment.network || null,
      expiresAt: payment.expiration_estimate_date || payment.valid_until || null,
      credited: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      providerCreatedAt: payment.created_at || null,
    };
    await db.runTransaction(async (transaction) => {
      transaction.create(db.collection("deposits").doc(paymentId), deposit);
      transaction.update(requestRef, {
        status: "created",
        paymentId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    sendJson(res, 201, { deposit: depositResponse(deposit) });
  } catch (error) {
    await requestRef.set({
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
      errorCode: String(error?.code || error?.type || "provider_error").slice(0, 80),
    }, { merge: true });
    throw error;
  }
}

async function applyDepositPayment(payment) {
  const paymentId = String(payment.payment_id || payment.id || "");
  if (!paymentId) throw new Error("Payment ID is missing");
  const depositRef = db.collection("deposits").doc(paymentId);
  await db.runTransaction(async (transaction) => {
    const depositSnapshot = await transaction.get(depositRef);
    if (!depositSnapshot.exists) throw Object.assign(new Error("Deposit not found"), { httpStatus: 404 });
    const deposit = depositSnapshot.data();
    if (payment.order_id && payment.order_id !== deposit.orderId) throw new Error("Payment order mismatch");
    const providerPriceCents = Math.round(Number(payment.price_amount || 0) * 100);
    if (providerPriceCents && providerPriceCents !== deposit.requestedUsdCents) throw new Error("Payment amount mismatch");

    const status = String(payment.payment_status || payment.status || deposit.status).toLowerCase();
    const update = {
      status,
      actuallyPaid: Number(payment.actually_paid || payment.amount_received || 0),
      providerUpdatedAt: payment.updated_at || null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (paymentCanCredit(status) && !deposit.credited) {
      const accountRef = walletRef(deposit.uid);
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists) {
        transaction.create(accountRef, {
          currency: "USD",
          availableUsdCents: deposit.requestedUsdCents,
          heldUsdCents: 0,
          lifetimeDepositedUsdCents: deposit.requestedUsdCents,
          lifetimeWithdrawnUsdCents: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(accountRef, {
          availableUsdCents: FieldValue.increment(deposit.requestedUsdCents),
          lifetimeDepositedUsdCents: FieldValue.increment(deposit.requestedUsdCents),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.create(accountRef.collection("ledger").doc(`deposit_${paymentId}`), {
        uid: deposit.uid,
        type: "deposit",
        amountUsdCents: deposit.requestedUsdCents,
        providerReference: paymentId,
        createdAt: FieldValue.serverTimestamp(),
      });
      update.credited = true;
      update.creditedAt = FieldValue.serverTimestamp();
    }
    transaction.update(depositRef, update);
  });
  return (await depositRef.get()).data();
}

async function handleGetDeposit(user, paymentId, res) {
  const ref = db.collection("deposits").doc(paymentId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().uid !== user.uid) {
    throw Object.assign(new Error("Deposit not found"), { httpStatus: 404 });
  }
  let deposit = snapshot.data();
  if (!deposit.credited && !["failed", "refunded", "expired"].includes(deposit.status)) {
    const sdk = await createNowPaymentsSdk();
    const payment = await sdk.getPaymentStatus(paymentId);
    deposit = await applyDepositPayment(payment);
  }
  sendJson(res, 200, { deposit: depositResponse(deposit) });
}

async function handleCreateWithdrawal(user, req, res) {
  await enforceCooldown(user.uid, "withdrawal", 5);
  const requestId = normalizeRequestId(req.body?.requestId);
  const amountUsdCents = parseUsdCents(req.body?.amountUsd, {
    minimumUsdCents: Number(process.env.MINIMUM_WITHDRAWAL_USD_CENTS || DEFAULT_LIMITS.minimumWithdrawalUsdCents),
    maximumUsdCents: Number(process.env.MAXIMUM_WITHDRAWAL_USD_CENTS || DEFAULT_LIMITS.maximumWithdrawalUsdCents),
  });
  const payoutCurrency = normalizeCurrency(req.body?.payoutCurrency);
  const address = normalizeAddress(req.body?.address);
  const extraId = normalizeExtraId(req.body?.extraId);
  const withdrawalRef = db.collection("withdrawals").doc(`${user.uid}_${requestId}`);
  const existing = await withdrawalRef.get();
  if (existing.exists) return sendJson(res, 200, { withdrawal: withdrawalResponse(existing.id, existing.data()) });

  const sdk = await createNowPaymentsSdk();
  await sdk.validatePayoutAddress({ address, currency: payoutCurrency, extraId: extraId || null });
  const estimate = await sdk.estimatePrice({
    amount: amountUsdCents / 100,
    fromCurrency: "usd",
    toCurrency: payoutCurrency,
  });
  const payoutAmount = Number(estimate.estimated_amount);
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) throw new Error("A withdrawal quote is not available for that currency");

  const accountRef = walletRef(user.uid);
  await db.runTransaction(async (transaction) => {
    const [accountSnapshot, withdrawalSnapshot] = await Promise.all([
      transaction.get(accountRef),
      transaction.get(withdrawalRef),
    ]);
    if (withdrawalSnapshot.exists) return;
    const account = cleanWallet(accountSnapshot.data());
    if (!accountSnapshot.exists || account.availableUsdCents < amountUsdCents) {
      throw Object.assign(new Error("Your available balance is too low"), { httpStatus: 409 });
    }
    transaction.update(accountRef, {
      availableUsdCents: FieldValue.increment(-amountUsdCents),
      heldUsdCents: FieldValue.increment(amountUsdCents),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(withdrawalRef, {
      uid: user.uid,
      requestId,
      status: "pending_review",
      requestedUsdCents: amountUsdCents,
      payoutAmount,
      payoutCurrency,
      address,
      maskedAddress: maskAddress(address),
      extraId: extraId || null,
      quoteCreatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(accountRef.collection("ledger").doc(`withdrawal_hold_${withdrawalRef.id}`), {
      uid: user.uid,
      type: "withdrawal_hold",
      amountUsdCents: -amountUsdCents,
      providerReference: withdrawalRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  const created = await withdrawalRef.get();
  sendJson(res, 201, { withdrawal: withdrawalResponse(created.id, created.data()) });
}

async function handleGetWithdrawal(user, withdrawalId, res) {
  const snapshot = await db.collection("withdrawals").doc(withdrawalId).get();
  if (!snapshot.exists || snapshot.data().uid !== user.uid) {
    throw Object.assign(new Error("Withdrawal not found"), { httpStatus: 404 });
  }
  sendJson(res, 200, { withdrawal: withdrawalResponse(snapshot.id, snapshot.data()) });
}

async function handleAdminCreatePayout(user, withdrawalId, res) {
  requireOwner(user);
  const ref = db.collection("withdrawals").doc(withdrawalId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("Withdrawal not found"), { httpStatus: 404 });
  const withdrawal = snapshot.data();
  if (withdrawal.providerBatchId) return sendJson(res, 200, { id: withdrawalId, status: withdrawal.status, providerBatchId: withdrawal.providerBatchId });
  if (withdrawal.status !== "pending_review") throw Object.assign(new Error("Withdrawal cannot be paid from its current state"), { httpStatus: 409 });

  const sdk = await createNowPaymentsSdk({ payouts: true });
  const estimate = await sdk.estimatePrice({
    amount: withdrawal.requestedUsdCents / 100,
    fromCurrency: "usd",
    toCurrency: withdrawal.payoutCurrency,
  });
  const payoutAmount = Number(estimate.estimated_amount);
  const batch = await sdk.createPayout({
    address: withdrawal.address,
    currency: withdrawal.payoutCurrency,
    amount: payoutAmount,
    extraId: withdrawal.extraId || null,
    uniqueExternalId: withdrawalId,
    payoutDescription: "GamRace player withdrawal",
    batchIpnCallbackUrl: publicFunctionUrl("nowPaymentsPayoutIpn"),
    autoVerify: false,
  });
  const providerPayoutId = batch.withdrawals?.[0]?.id || null;
  await ref.update({
    status: "verification_required",
    payoutAmount,
    providerBatchId: batch.id,
    providerPayoutId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  sendJson(res, 200, { id: withdrawalId, status: "verification_required", providerBatchId: batch.id });
}

async function handleAdminVerifyPayout(user, withdrawalId, req, res) {
  requireOwner(user);
  const code = String(req.body?.verificationCode || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the current six-digit 2FA code");
  const ref = db.collection("withdrawals").doc(withdrawalId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("Withdrawal not found"), { httpStatus: 404 });
  const withdrawal = snapshot.data();
  if (!withdrawal.providerBatchId) throw Object.assign(new Error("Create the payout first"), { httpStatus: 409 });
  if (!["verification_required", "verification_failed"].includes(withdrawal.status)) {
    throw Object.assign(new Error("Withdrawal does not require verification"), { httpStatus: 409 });
  }
  const sdk = await createNowPaymentsSdk({ payouts: true });
  try {
    await sdk.verifyPayout(withdrawal.providerBatchId, code);
    await ref.update({ status: "processing", verifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    sendJson(res, 200, { id: withdrawalId, status: "processing" });
  } catch (error) {
    await ref.update({ status: "verification_failed", updatedAt: FieldValue.serverTimestamp() });
    throw error;
  }
}

async function settleWithdrawal(withdrawalId, status, provider = {}) {
  const ref = db.collection("withdrawals").doc(withdrawalId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Withdrawal not found");
    const withdrawal = snapshot.data();
    const normalizedStatus = String(status || withdrawal.status).toLowerCase();
    const update = {
      status: normalizedStatus,
      providerStatus: provider.payout_status || provider.status || normalizedStatus,
      providerHash: provider.hash || null,
      providerFee: provider.fee || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const accountRef = walletRef(withdrawal.uid);
    if (normalizedStatus === "finished" && !withdrawal.settled) {
      transaction.update(accountRef, {
        heldUsdCents: FieldValue.increment(-withdrawal.requestedUsdCents),
        lifetimeWithdrawnUsdCents: FieldValue.increment(withdrawal.requestedUsdCents),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(accountRef.collection("ledger").doc(`withdrawal_${withdrawalId}`), {
        uid: withdrawal.uid,
        type: "withdrawal",
        amountUsdCents: -withdrawal.requestedUsdCents,
        providerReference: provider.id || withdrawal.providerPayoutId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      update.settled = true;
      update.settledAt = FieldValue.serverTimestamp();
    }
    if (["failed", "rejected", "cancelled", "canceled"].includes(normalizedStatus) && !withdrawal.released && !withdrawal.settled) {
      transaction.update(accountRef, {
        availableUsdCents: FieldValue.increment(withdrawal.requestedUsdCents),
        heldUsdCents: FieldValue.increment(-withdrawal.requestedUsdCents),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(accountRef.collection("ledger").doc(`withdrawal_release_${withdrawalId}`), {
        uid: withdrawal.uid,
        type: "withdrawal_release",
        amountUsdCents: withdrawal.requestedUsdCents,
        providerReference: provider.id || withdrawal.providerPayoutId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      update.released = true;
      update.releasedAt = FieldValue.serverTimestamp();
    }
    transaction.update(ref, update);
  });
}

exports.walletApi = onRequest({ region: REGION, secrets: PAYMENT_SECRETS, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const user = await requireUser(req);
    const path = requestPath(req);
    if (req.method === "GET" && path === "/wallet") return await handleGetWallet(user, res);
    if (req.method === "GET" && path === "/currencies") return await handleCurrencies(res);
    if (req.method === "POST" && path === "/deposits") return await handleCreateDeposit(user, req, res);
    const depositMatch = path.match(/^\/deposits\/([A-Za-z0-9_-]+)$/);
    if (req.method === "GET" && depositMatch) return await handleGetDeposit(user, depositMatch[1], res);
    if (req.method === "POST" && path === "/withdrawals") return await handleCreateWithdrawal(user, req, res);
    const withdrawalMatch = path.match(/^\/withdrawals\/([A-Za-z0-9_-]+)$/);
    if (req.method === "GET" && withdrawalMatch) return await handleGetWithdrawal(user, withdrawalMatch[1], res);
    sendJson(res, 404, { error: "Wallet route not found" });
  } catch (error) {
    const status = Number(error?.httpStatus || (error?.type === "validation" ? 400 : 500));
    if (status >= 500) logger.error("walletApi failed", { message: error?.message, code: error?.code, type: error?.type });
    sendJson(res, status, { error: status >= 500 ? safeError(error) : error.message });
  }
});

exports.walletAdminApi = onRequest({ region: REGION, secrets: PAYOUT_SECRETS, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const user = await requireUser(req);
    requireOwner(user);
    const path = requestPath(req);
    const createPayoutMatch = path.match(/^\/withdrawals\/([A-Za-z0-9_-]+)\/create-payout$/);
    if (req.method === "POST" && createPayoutMatch) return await handleAdminCreatePayout(user, createPayoutMatch[1], res);
    const verifyPayoutMatch = path.match(/^\/withdrawals\/([A-Za-z0-9_-]+)\/verify$/);
    if (req.method === "POST" && verifyPayoutMatch) return await handleAdminVerifyPayout(user, verifyPayoutMatch[1], req, res);
    sendJson(res, 404, { error: "Admin wallet route not found" });
  } catch (error) {
    const status = Number(error?.httpStatus || (error?.type === "validation" ? 400 : 500));
    if (status >= 500) logger.error("walletAdminApi failed", { message: error?.message, code: error?.code, type: error?.type });
    sendJson(res, status, { error: status >= 500 ? safeError(error) : error.message });
  }
});

exports.nowPaymentsIpn = onRequest({ region: REGION, secrets: PAYMENT_SECRETS, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const signature = req.get("x-nowpayments-sig") || "";
    const expected = createIpnSignature(req.body, NOWPAYMENTS_IPN_SECRET.value());
    if (!signaturesMatch(signature, expected)) return sendJson(res, 401, { error: "Invalid signature" });
    const paymentId = String(req.body?.payment_id || "");
    if (!paymentId) return sendJson(res, 400, { error: "Payment ID is required" });
    const sdk = await createNowPaymentsSdk();
    const payment = await sdk.getPaymentStatus(paymentId);
    await applyDepositPayment(payment);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    logger.error("NOWPayments deposit IPN failed", { message: error?.message, code: error?.code });
    sendJson(res, Number(error?.httpStatus || 500), { error: "IPN could not be processed" });
  }
});

exports.nowPaymentsPayoutIpn = onRequest({ region: REGION, secrets: PAYMENT_SECRETS, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const signature = req.get("x-nowpayments-sig") || "";
    const expected = createIpnSignature(req.body, NOWPAYMENTS_IPN_SECRET.value());
    if (!signaturesMatch(signature, expected)) return sendJson(res, 401, { error: "Invalid signature" });
    const withdrawalId = String(req.body?.unique_external_id || "");
    if (!withdrawalId) throw new Error("Payout does not contain the GamRace withdrawal reference");
    await settleWithdrawal(withdrawalId, req.body?.payout_status || req.body?.status, req.body);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    logger.error("NOWPayments payout IPN failed", { message: error?.message, code: error?.code });
    sendJson(res, Number(error?.httpStatus || 500), { error: "Payout IPN could not be processed" });
  }
});
