import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { RANK_STAGES } from "./rank-config.js?v=rank-badges-1";

const firebaseConfig = {
  apiKey: "AIzaSyBS3pib3PsHnSJGaQqBc--S99qI7sqhDuU",
  authDomain: "gamrace.com",
  projectId: "gamrace",
  storageBucket: "gamrace.firebasestorage.app",
  messagingSenderId: "576202313103",
  appId: "1:576202313103:web:8e3153a6816b7bf8658ffa",
};

const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
const SESSION_KEY = "gamrace-admin-session-v1";
const ISO_COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
auth.useDeviceLanguage();

const accessScreen = document.querySelector("#access-screen");
const adminApp = document.querySelector("#admin-app");
const accessLoading = document.querySelector("#access-loading");
const accessAccount = document.querySelector("#access-account");
const accessPassword = document.querySelector("#access-password");
const accessDenied = document.querySelector("#access-denied");
const accessStatus = document.querySelector("#access-status");
const passwordInput = document.querySelector("#admin-password");
const navButtons = [...document.querySelectorAll("[data-admin-view]")];
const panels = [...document.querySelectorAll("[data-admin-panel]")];
const reviewDialog = document.querySelector("#review-dialog");
const balanceDialog = document.querySelector("#balance-dialog");

let firebaseUser = null;
let adminSession = readSession();
let activeView = "overview";
let reviewDecision = "complete";
let activeWithdrawal = null;
let overviewCache = null;
let systemCache = null;
let countryAccessCache = null;
let playersCache = [];
let activePlayer = null;

const viewMeta = {
  overview: ["COMMAND", "Overview"],
  players: ["COMMAND", "Players"],
  deposits: ["OPERATIONS", "Deposits"],
  withdrawals: ["OPERATIONS", "Withdrawals"],
  games: ["PRODUCT", "Games"],
  ranks: ["PRODUCT", "Ranks & VIP"],
  providers: ["PRODUCT", "Providers"],
  promotions: ["GROWTH", "Promotions"],
  risk: ["TRUST", "Risk & Compliance"],
  support: ["PLAYER CARE", "Support"],
  content: ["SITE", "Site Content"],
  integrations: ["PLATFORM", "Integrations"],
  audit: ["SECURITY", "Audit Log"],
  system: ["PLATFORM", "System"],
};

const assetNames = {
  usdttrc20: "USDT · TRC20", usdtbep20: "USDT · BEP20", usdtsol: "USDT · Solana", usdtpolygon: "USDT · Polygon", usdterc20: "USDT · ERC20",
  btc: "BTC · Bitcoin", eth: "ETH · Ethereum",
  usdcsol: "USDC · Solana", usdcpolygon: "USDC · Polygon", usdcbase: "USDC · Base", usdcbep20: "USDC · BEP20", usdc: "USDC · ERC20",
  sol: "SOL · Solana", trx: "TRX · Tron", ltc: "LTC · Litecoin", doge: "DOGE · Dogecoin", xrp: "XRP · XRP Ledger", bnbbsc: "BNB · BEP20",
};
const assetOrder = Object.keys(assetNames);

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!value?.token || !value?.expiresAt || Date.parse(value.expiresAt) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

function saveSession(session) {
  adminSession = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  adminSession = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function showAccessStage(stage) {
  accessLoading.hidden = stage !== "loading";
  accessAccount.hidden = stage !== "account";
  accessPassword.hidden = stage !== "password";
  accessDenied.hidden = stage !== "denied";
  accessStatus.textContent = "";
  delete accessStatus.dataset.state;
}

function setAccessStatus(message, state = "error") {
  accessStatus.textContent = message;
  accessStatus.dataset.state = state;
}

function ownerName(user = firebaseUser) {
  return user?.displayName || user?.email?.split("@")[0] || "Owner";
}

function setOwnerIdentity(user) {
  const name = ownerName(user);
  const initial = name.charAt(0).toUpperCase();
  document.querySelector("#gate-owner-name").textContent = name;
  document.querySelector("#gate-owner-email").textContent = user?.email || "Verified Firebase account";
  document.querySelector("#gate-avatar").textContent = initial;
  document.querySelector("#sidebar-owner-name").textContent = name;
  document.querySelector("#sidebar-avatar").textContent = initial;
  document.querySelector("#overview-owner-name").textContent = name.split(" ")[0];
}

async function api(path, options = {}, requireAdmin = true) {
  if (!firebaseUser) throw Object.assign(new Error("Sign in with the owner account"), { status: 401 });
  const token = await firebaseUser.getIdToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (requireAdmin && adminSession?.token) headers["X-Admin-Session"] = adminSession.token;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(body.error || "The admin service could not complete that request"), { status: response.status });
    if (requireAdmin && response.status === 401) {
      clearSession();
      showAdminGate();
    }
    throw error;
  }
  return body;
}

function showAdminGate() {
  adminApp.hidden = true;
  accessScreen.hidden = false;
  if (!firebaseUser) showAccessStage("account");
  else {
    setOwnerIdentity(firebaseUser);
    showAccessStage("password");
    requestAnimationFrame(() => passwordInput.focus());
  }
}

async function verifyStoredSession() {
  if (!adminSession) return false;
  try {
    const result = await api("/admin/session");
    adminSession.expiresAt = result.expiresAt;
    saveSession(adminSession);
    return true;
  } catch (error) {
    if (error.status === 403) showAccessStage("denied");
    return false;
  }
}

async function openAdmin() {
  setOwnerIdentity(firebaseUser);
  accessScreen.hidden = true;
  adminApp.hidden = false;
  document.querySelector("#day-period").textContent = new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening";
  renderRanks();
  selectView(location.hash.replace("#", "") || "overview", { updateHash: false });
}

onAuthStateChanged(auth, async (user) => {
  firebaseUser = user;
  showAccessStage("loading");
  if (!user) {
    clearSession();
    showAccessStage("account");
    return;
  }
  setOwnerIdentity(user);
  if (await verifyStoredSession()) await openAdmin();
  else if (!accessDenied.hidden) return;
  else showAccessStage("password");
});

document.querySelector("#owner-sign-in").addEventListener("click", async () => {
  setAccessStatus("", "");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (error?.code !== "auth/popup-closed-by-user") setAccessStatus("Google sign-in could not be completed.");
  }
});

accessPassword.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  const button = accessPassword.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Verifying securely…";
  setAccessStatus("", "");
  try {
    const result = await api("/admin/session", { method: "POST", body: JSON.stringify({ password }) }, false);
    saveSession(result.session);
    passwordInput.value = "";
    setAccessStatus("Access verified.", "success");
    await openAdmin();
  } catch (error) {
    if (error.status === 403) showAccessStage("denied");
    else setAccessStatus(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Unlock control room";
  }
});

document.querySelector("#toggle-admin-password").addEventListener("click", () => {
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  document.querySelector("#toggle-admin-password").setAttribute("aria-label", reveal ? "Hide admin password" : "Show admin password");
});

async function signOutOwner() {
  clearSession();
  await signOut(auth);
  showAdminGate();
}

document.querySelector("#switch-owner-account").addEventListener("click", signOutOwner);
document.querySelector("#denied-sign-out").addEventListener("click", signOutOwner);

function lockAdmin() {
  clearSession();
  showAdminGate();
}

document.querySelector("#lock-admin").addEventListener("click", lockAdmin);
document.querySelector("#system-lock-admin").addEventListener("click", lockAdmin);

function showToast(message, state = "success") {
  const toast = document.createElement("div");
  toast.className = `admin-toast ${state === "error" ? "error" : ""}`;
  toast.textContent = message;
  document.querySelector("#admin-toast-region").append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function setLastRefresh(date = new Date()) {
  document.querySelector("#last-refresh").textContent = `Updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDate(value, compact = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return compact
    ? date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortId(value, size = 8) {
  const text = String(value || "");
  return text.length > size * 2 ? `${text.slice(0, size)}…${text.slice(-size)}` : text || "—";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function statusClass(status) {
  return String(status || "").toLowerCase().replaceAll(" ", "_");
}

function formatAsset(code) {
  return assetNames[String(code || "").toLowerCase()] || String(code || "—").toUpperCase();
}

function setTableEmpty(body, columns, message) {
  body.innerHTML = `<tr class="empty-row"><td colspan="${columns}">${message}</td></tr>`;
}

function selectView(view, { updateHash = true } = {}) {
  if (!viewMeta[view]) view = "overview";
  activeView = view;
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.adminView === view));
  panels.forEach((panel) => {
    const selected = panel.dataset.adminPanel === view;
    panel.hidden = !selected;
    panel.classList.toggle("active", selected);
  });
  document.querySelector("#view-eyebrow").textContent = viewMeta[view][0];
  document.querySelector("#view-title").textContent = viewMeta[view][1];
  if (updateHash) history.replaceState(null, "", `#${view}`);
  document.querySelector("#admin-sidebar").classList.remove("open");
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", "false");
  loadView(view).catch((error) => showToast(error.message, "error"));
}

navButtons.forEach((button) => button.addEventListener("click", () => selectView(button.dataset.adminView)));
document.querySelectorAll("[data-jump-view]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.jumpView)));

document.querySelector("#admin-menu-button").addEventListener("click", () => {
  const sidebar = document.querySelector("#admin-sidebar");
  const open = sidebar.classList.toggle("open");
  document.querySelector("#admin-menu-button").setAttribute("aria-expanded", String(open));
});

document.querySelector("#refresh-view").addEventListener("click", () => {
  loadView(activeView, true).then(() => showToast(`${viewMeta[activeView][1]} refreshed`)).catch((error) => showToast(error.message, "error"));
});

async function loadView(view, force = false) {
  if (view === "overview") return loadOverview(force);
  if (view === "players") return loadPlayers();
  if (view === "deposits") return loadDeposits();
  if (view === "withdrawals") return loadWithdrawals();
  if (view === "audit") return loadAudit();
  if (view === "risk") return loadCountryAccess(force);
  if (view === "system" || view === "integrations") return loadSystem(force);
  setLastRefresh();
}

function displayCountryName(code) {
  try { return new Intl.DisplayNames([navigator.language || "en"], { type: "region" }).of(code) || code; } catch { return code; }
}

function countryAccessMap(data) {
  return new Map((data?.overrides || []).map((entry) => [entry.countryCode, Boolean(entry.allowed)]));
}

function renderCountryAccess() {
  const container = document.querySelector("#country-access-grid");
  if (!container || !countryAccessCache) return;
  const query = document.querySelector("#country-search").value.trim().toLowerCase();
  const overrides = countryAccessMap(countryAccessCache);
  const countries = ISO_COUNTRY_CODES
    .map((code) => ({ code, name: displayCountryName(code), allowed: overrides.has(code) ? overrides.get(code) : true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const shown = countries.filter((country) => !query || country.name.toLowerCase().includes(query) || country.code.toLowerCase().includes(query));
  document.querySelector("#country-allowed-count").textContent = countries.filter((country) => country.allowed).length;
  document.querySelector("#country-blocked-count").textContent = countries.filter((country) => !country.allowed).length;
  container.innerHTML = shown.length ? shown.map((country) => `<div class="country-access-row ${country.allowed ? "" : "blocked"}" data-country-code="${country.code}"><b>${country.code}</b><span title="${country.name}">${country.name}</span><button type="button" aria-label="${country.allowed ? `Block ${country.name}` : `Allow ${country.name}`}" title="${country.allowed ? "Allowed — click to block" : "Blocked — click to allow"}">${country.allowed ? "On" : "Off"}</button></div>`).join("") : "<p>No countries match that search.</p>";
  container.querySelectorAll("[data-country-code] button").forEach((button) => button.addEventListener("click", async () => {
    const row = button.closest("[data-country-code]");
    const code = row.dataset.countryCode;
    const currentAllowed = overrides.has(code) ? overrides.get(code) : true;
    button.disabled = true;
    try {
      const updated = await api(`/admin/country-access/${code}`, { method: "POST", body: JSON.stringify({ allowed: !currentAllowed }) });
      countryAccessCache.overrides = [...countryAccessMap(countryAccessCache).entries()].filter(([countryCode]) => countryCode !== code).map(([countryCode, allowed]) => ({ countryCode, allowed }));
      countryAccessCache.overrides.push(updated);
      renderCountryAccess();
      showToast(`${displayCountryName(code)} is now ${updated.allowed ? "allowed" : "blocked"}`);
    } catch (error) {
      button.disabled = false;
      showToast(error.message, "error");
    }
  }));
}

async function loadCountryAccess(force = false) {
  countryAccessCache = countryAccessCache && !force ? countryAccessCache : await api("/admin/country-access");
  renderCountryAccess();
  setLastRefresh();
}

document.querySelector("#country-search")?.addEventListener("input", renderCountryAccess);

async function loadOverview(force = false) {
  const [overview, system] = await Promise.all([
    overviewCache && !force ? overviewCache : api("/admin/overview"),
    systemCache && !force ? systemCache : api("/admin/system"),
  ]);
  overviewCache = overview;
  systemCache = system;
  renderOverview(overview);
  renderSystem(system);
  setLastRefresh(new Date(overview.generatedAt));
}

function renderOverview(data) {
  const summary = data.summary || {};
  document.querySelector('[data-metric="totalUsers"]').textContent = summary.totalUsers?.toLocaleString() ?? "0";
  document.querySelector('[data-metric="deposits24h"]').textContent = summary.deposits24h?.toLocaleString() ?? "0";
  document.querySelector('[data-metric="withdrawals24h"]').textContent = summary.withdrawals24h?.toLocaleString() ?? "0";
  document.querySelector('[data-metric="pendingWithdrawals"]').textContent = summary.pendingWithdrawals?.toLocaleString() ?? "0";
  document.querySelector('[data-metric-note="completedDeposits"]').textContent = `${Number(summary.completedDeposits || 0).toLocaleString()} lifetime`;
  document.querySelector('[data-metric-note="flagged24h"]').textContent = `${Number(summary.flagged24h || 0).toLocaleString()} flagged today`;
  const navCount = document.querySelector("#withdrawal-nav-count");
  navCount.textContent = summary.pendingWithdrawals || 0;
  navCount.hidden = !summary.pendingWithdrawals;
  renderActivityChart(data.dailyActivity || []);
  renderAssets(data.balances || []);
  renderRecent(data.recentActivity || []);
  renderAttention(summary.pendingWithdrawals || 0);
}

function renderActivityChart(rows) {
  const source = new Map(rows.map((row) => [row.day, row]));
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    days.push({ date, deposits: Number(source.get(key)?.deposits || 0), withdrawals: Number(source.get(key)?.withdrawals || 0) });
  }
  const max = Math.max(1, ...days.flatMap((day) => [day.deposits, day.withdrawals]));
  const points = (field) => days.map((day, index) => `${Math.round(index * (700 / 6))},${235 - Math.round((day[field] / max) * 195)}`).join(" ");
  document.querySelector(".deposits-line").setAttribute("points", points("deposits"));
  document.querySelector(".withdrawals-line").setAttribute("points", points("withdrawals"));
  document.querySelector("#chart-days").innerHTML = days.map((day) => `<span>${day.date.toLocaleDateString([], { weekday: "short" }).toUpperCase()}</span>`).join("");
}

function renderAssets(balances) {
  const container = document.querySelector("#asset-balance-list");
  if (!balances.length) {
    container.innerHTML = '<div class="empty-compact"><span>—</span><strong>No player balances yet</strong><small>Balances appear after the first credited deposit.</small></div>';
    return;
  }
  container.innerHTML = balances.slice(0, 8).map((balance) => `
    <div class="asset-row"><span class="asset-symbol">${formatAsset(balance.currency).split(" ")[0]}</span><div><strong>${formatAsset(balance.currency)}</strong><small>${balance.holders} holder${balance.holders === 1 ? "" : "s"} · ${balance.held} held</small></div><b>${balance.available}</b></div>
  `).join("");
}

function renderRecent(activity) {
  const container = document.querySelector("#recent-activity-list");
  if (!activity.length) {
    container.innerHTML = '<div class="empty-compact"><span>—</span><strong>No transaction activity</strong><small>New deposits and withdrawals will appear here.</small></div>';
    return;
  }
  container.innerHTML = activity.slice(0, 8).map((item) => `
    <div class="recent-item"><span class="recent-icon ${item.type}">${item.type === "deposit" ? "↓" : "↑"}</span><div><strong>${item.type === "deposit" ? "Deposit" : "Withdrawal"} · ${formatAsset(item.currency)}</strong><small>${shortId(item.uid, 6)} · ${formatDate(item.occurredAt, true)}</small></div><b>${item.amount}</b></div>
  `).join("");
}

function renderAttention(pending) {
  const container = document.querySelector("#attention-list");
  container.innerHTML = pending
    ? `<div class="attention-item"><span>!</span><div><strong>${pending} withdrawal${pending === 1 ? "" : "s"} awaiting review</strong><small>Funds are held until you decide.</small></div><b>REVIEW</b></div>`
    : '<div class="empty-compact"><span aria-hidden="true">•</span><strong>Nothing waiting</strong><small>Your review queue is clear.</small></div>';
}

async function loadPlayers() {
  const query = document.querySelector("#player-search").value.trim();
  const result = await api(`/admin/users?limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`);
  const body = document.querySelector("#players-table-body");
  playersCache = result.users;
  if (!result.users.length) setTableEmpty(body, 6, query ? "No player matches that username or UID." : "No wallet players yet.");
  else body.innerHTML = result.users.map((user, index) => `
    <tr><td><span class="table-primary player-username">${escapeHtml(user.username || "Username pending")}</span><span class="table-secondary" title="${escapeHtml(user.uid)}">${escapeHtml(user.uid)}</span></td><td>${escapeHtml(formatAsset(user.selectedCurrency))}</td><td>${Number(user.assetCount || 0)}</td><td>${formatDate(user.lastWalletActivity, true)}</td><td><span class="status-pill live">ACTIVE</span></td><td><button class="table-action-button" type="button" data-edit-player-balance="${index}">Edit balance</button></td></tr>
  `).join("");
  body.querySelectorAll("[data-edit-player-balance]").forEach((button) => button.addEventListener("click", () => openBalanceEditor(playersCache[Number(button.dataset.editPlayerBalance)])));
  setLastRefresh();
}

function playerBalance(player, currency) {
  return player?.balances?.find((balance) => balance.currency === currency) || { currency, available: "0", held: "0" };
}

function refreshBalanceEditor() {
  if (!activePlayer) return;
  const currency = document.querySelector("#balance-asset").value;
  const balance = playerBalance(activePlayer, currency);
  document.querySelector("#balance-current-available").textContent = `${balance.available} ${formatAsset(currency)}`;
  document.querySelector("#balance-current-held").textContent = `${balance.held} ${formatAsset(currency)}`;
  document.querySelector("#balance-amount").value = balance.available;
}

function openBalanceEditor(player) {
  if (!player) return;
  activePlayer = player;
  document.querySelector("#balance-player-username").textContent = player.username || "Username pending";
  document.querySelector("#balance-player-uid").textContent = player.uid;
  const select = document.querySelector("#balance-asset");
  select.innerHTML = assetOrder.map((code) => `<option value="${code}">${escapeHtml(assetNames[code])}</option>`).join("");
  select.value = assetNames[player.selectedCurrency] ? player.selectedCurrency : assetOrder[0];
  document.querySelector("#balance-reason").value = "";
  document.querySelector("#balance-status").textContent = "";
  refreshBalanceEditor();
  balanceDialog.showModal();
}

document.querySelector("#balance-asset").addEventListener("change", refreshBalanceEditor);
document.querySelector("#balance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activePlayer) return;
  const currency = document.querySelector("#balance-asset").value;
  const amount = document.querySelector("#balance-amount").value.trim();
  const reason = document.querySelector("#balance-reason").value.trim();
  const status = document.querySelector("#balance-status");
  const button = document.querySelector("#confirm-balance-update");
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount)) { status.textContent = "Enter a non-negative balance with no more than 8 decimal places."; return; }
  if (reason.length < 3) { status.textContent = "Add a brief reason for this balance change."; return; }
  button.disabled = true;
  button.textContent = "Saving securely…";
  status.textContent = "";
  try {
    const playerName = activePlayer.username || "Player";
    await api(`/admin/users/${encodeURIComponent(activePlayer.uid)}/balances/${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ amount, reason }),
    });
    balanceDialog.close();
    showToast(`${playerName} balance updated and audited`);
    await loadPlayers();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save balance";
  }
});
balanceDialog.addEventListener("close", () => { activePlayer = null; });

document.querySelector("#player-search-button").addEventListener("click", () => loadPlayers().catch((error) => showToast(error.message, "error")));
document.querySelector("#player-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadPlayers().catch((error) => showToast(error.message, "error")); });

async function loadDeposits() {
  const status = document.querySelector("#deposit-status-filter").value;
  const result = await api(`/admin/deposits?limit=75&status=${encodeURIComponent(status)}`);
  const body = document.querySelector("#deposits-table-body");
  if (!result.deposits.length) setTableEmpty(body, 6, "No deposits match this view.");
  else body.innerHTML = result.deposits.map((deposit) => `
    <tr><td><span class="table-primary">${shortId(deposit.id, 7)}</span><span class="table-secondary">OxaPay transaction</span></td><td>${shortId(deposit.uid, 6)}</td><td>${formatAsset(deposit.payCurrency)}</td><td><span class="table-primary">${deposit.payAmount}</span><span class="table-secondary">${deposit.network || "Selected network"}</span></td><td><span class="status-pill ${statusClass(deposit.status)}">${deposit.status}</span></td><td>${formatDate(deposit.createdAt, true)}</td></tr>
  `).join("");
  setLastRefresh();
}

document.querySelector("#deposit-status-filter").addEventListener("change", () => loadDeposits().catch((error) => showToast(error.message, "error")));

async function loadWithdrawals() {
  const result = await api("/admin/withdrawals");
  const container = document.querySelector("#withdrawal-queue");
  const count = result.withdrawals.length;
  const navCount = document.querySelector("#withdrawal-nav-count");
  navCount.textContent = count;
  navCount.hidden = count === 0;
  if (!count) container.innerHTML = '<div class="empty-state-card"><div><span aria-hidden="true">•</span><strong>No withdrawals waiting for review</strong><p>New requests will appear here with funds already held.</p></div></div>';
  else container.innerHTML = result.withdrawals.map((withdrawal) => `
    <article class="withdrawal-card"><div><label>Request</label><strong>${shortId(withdrawal.id, 7)}</strong></div><div><label>Amount</label><strong class="amount">${withdrawal.payoutAmount} ${formatAsset(withdrawal.payoutCurrency)}</strong></div><div><label>Status</label><strong><span class="status-pill ${statusClass(withdrawal.status)}">${withdrawal.status.replaceAll("_", " ")}</span></strong></div><div><label>Submitted</label><strong>${formatDate(withdrawal.createdAt, true)}</strong></div>${withdrawal.status === "pending_review" ? `<button type="button" data-review-withdrawal="${withdrawal.id}">Review</button>` : ""}</article>
  `).join("");
  container.querySelectorAll("[data-review-withdrawal]").forEach((button) => button.addEventListener("click", () => openWithdrawalReview(result.withdrawals.find((item) => item.id === button.dataset.reviewWithdrawal))));
  setLastRefresh();
}

function openWithdrawalReview(withdrawal) {
  activeWithdrawal = withdrawal;
  reviewDecision = "complete";
  document.querySelectorAll("[data-review-decision]").forEach((button) => button.classList.toggle("active", button.dataset.reviewDecision === "complete"));
  document.querySelector("#review-note").value = "";
  document.querySelector("#review-status").textContent = "";
  document.querySelector("#confirm-review").textContent = "Approve & send";
  document.querySelector("#review-title").textContent = `Review ${shortId(withdrawal.id, 7)}`;
  document.querySelector("#review-summary").innerHTML = `
    <div><span>Amount</span><strong>${withdrawal.payoutAmount} ${formatAsset(withdrawal.payoutCurrency)}</strong></div><div><span>Player</span><strong>${shortId(withdrawal.uid, 7)}</strong></div><div><span>Address</span><strong title="${withdrawal.address}">${shortId(withdrawal.address, 9)}</strong></div><div><span>Submitted</span><strong>${formatDate(withdrawal.createdAt, true)}</strong></div>`;
  reviewDialog.showModal();
}

document.querySelectorAll("[data-review-decision]").forEach((button) => button.addEventListener("click", () => {
  reviewDecision = button.dataset.reviewDecision;
  document.querySelectorAll("[data-review-decision]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  document.querySelector("#confirm-review").textContent = reviewDecision === "complete" ? "Approve & send" : "Reject and release funds";
}));

document.querySelector("#confirm-review").addEventListener("click", async () => {
  if (!activeWithdrawal) return;
  const note = document.querySelector("#review-note").value.trim();
  const status = document.querySelector("#review-status");
  const button = document.querySelector("#confirm-review");
  if (reviewDecision === "reject" && note.length < 3) { status.textContent = "Enter a brief rejection reason."; return; }
  button.disabled = true;
  status.textContent = "";
  try {
    await api(`/admin/withdrawals/${encodeURIComponent(activeWithdrawal.id)}/${reviewDecision}`, { method: "POST", body: JSON.stringify({ note }) });
    reviewDialog.close();
    overviewCache = null;
    showToast(reviewDecision === "complete" ? "Withdrawal sent to OxaPay" : "Withdrawal rejected and funds released");
    await loadWithdrawals();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function renderRanks() {
  const container = document.querySelector("#rank-admin-grid");
  if (container.childElementCount) return;
  container.innerHTML = RANK_STAGES.map((rank, index) => `
    <article class="rank-admin-card"><span class="rank-number">STAGE ${String(index + 1).padStart(2, "0")}</span><h3>${rank.name}</h3><p>${rank.subtitle}</p><div class="rank-tiers"><span>I</span><span>II</span><span>III</span></div><small class="rank-threshold">Starts at $${rank.thresholds[0].toLocaleString()}</small></article>
  `).join("");
}

async function loadAudit() {
  const result = await api("/admin/audit");
  const body = document.querySelector("#audit-table-body");
  if (!result.events.length) setTableEmpty(body, 4, "No admin activity has been recorded yet.");
  else body.innerHTML = result.events.map((event) => `
    <tr><td><span class="table-primary">${event.type.replaceAll(".", " · ")}</span><span class="table-secondary">Owner ${shortId(event.uid, 5)}</span></td><td>${event.targetId ? shortId(event.targetId, 7) : "—"}</td><td>${event.detail || "—"}</td><td>${formatDate(event.createdAt, true)}</td></tr>
  `).join("");
  setLastRefresh();
}

async function loadSystem(force = false) {
  const data = systemCache && !force ? systemCache : await api("/admin/system");
  systemCache = data;
  renderSystem(data);
  setLastRefresh();
}

function renderSystem(data) {
  const services = data.services || [];
  const unhealthy = services.filter((service) => service.status !== "operational");
  document.querySelector("#overview-system-copy").textContent = unhealthy.length ? `${unhealthy.length} service${unhealthy.length === 1 ? "" : "s"} need attention` : `${services.length} connected services healthy`;
  document.querySelector("#service-list").innerHTML = services.map((service) => `<div class="service-row ${service.status}"><i></i><strong>${service.label}</strong><span>${service.status}</span></div>`).join("");
  document.querySelector("#session-expiry").textContent = formatDate(data.sessionExpiresAt, true);
  const paymentsStatus = document.querySelector("#payments-integration-status");
  const payments = services.find((service) => service.id === "payments");
  paymentsStatus.textContent = payments?.status || "unknown";
  paymentsStatus.className = `status-pill ${statusClass(payments?.status)}`;
}

window.addEventListener("hashchange", () => {
  const view = location.hash.replace("#", "");
  if (!adminApp.hidden && viewMeta[view]) selectView(view, { updateHash: false });
});

setInterval(() => {
  if (adminSession?.expiresAt && Date.parse(adminSession.expiresAt) <= Date.now()) {
    clearSession();
    showAdminGate();
    setAccessStatus("Your admin session expired. Enter your password again.");
  }
}, 30_000);

