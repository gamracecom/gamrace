import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { RANK_STAGES } from "./rank-config.js?v=rank-badges-2";

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
let leaderboardCache = null;
let promotionsCache = null;
let gameEdgesCache = null;
let chatSettingsCache = null;
let rankRewardsCache = null;
let announcementCache = null;

const viewMeta = {
  overview: ["COMMAND", "Overview"],
  players: ["COMMAND", "Players"],
  transactions: ["OPERATIONS", "Transactions"],
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
  if (view === "transactions") return loadTransactions();
  if (view === "deposits") return loadDeposits();
  if (view === "withdrawals") return loadWithdrawals();
  if (view === "games") return loadGameEdges(force);
  if (view === "ranks") return loadRankRewards(force);
  if (view === "promotions") return loadPromotionsWorkspace(force);
  if (view === "audit") return loadAudit();
  if (view === "risk") return loadCountryAccess(force);
  if (view === "content") return loadAnnouncementSettings(force);
  if (view === "system" || view === "integrations") return loadSystem(force);
  setLastRefresh();
}

function renderGameEdges() {
  const container = document.querySelector("#game-edge-grid");
  if (!container || !gameEdgesCache) return;
  container.innerHTML = gameEdgesCache.map((game) => `
    <article class="panel-card game-edge-card${game.editable ? "" : " is-fixed-edge"}${game.maintenanceMode ? " is-maintenance" : ""}" data-game-edge="${escapeHtml(game.id)}">
      <div class="game-edge-title"><span>${escapeHtml(game.name.slice(0, 1))}</span><div><strong>${escapeHtml(game.name)}</strong><small>${game.editable ? "Live configurable margin" : escapeHtml(game.reason || "Fixed game math")}</small></div><b>${game.editable ? "EDITABLE" : "FIXED"}</b></div>
      <div class="game-maintenance-row"><span><strong>Maintenance mode</strong><small>${game.maintenanceMode ? "New bets are blocked" : "Players can start new bets"}</small></span><button class="toggle-control${game.maintenanceMode ? " on" : ""}" data-maintenance-toggle type="button" role="switch" aria-checked="${String(Boolean(game.maintenanceMode))}" aria-label="Toggle ${escapeHtml(game.name)} maintenance mode"><span></span></button></div>
      <label class="game-edge-setting${game.editable ? "" : " is-locked"}"><span>House edge</span><span class="game-edge-input"><input data-edge-input type="number" min="0" max="10" step="0.01" value="${Number(game.houseEdgePercent).toFixed(2)}" ${game.editable ? "" : "disabled"} aria-label="${escapeHtml(game.name)} house edge percentage" /><i>%</i></span></label>
      <div class="game-edge-rtp"><span>Player RTP</span><strong>${Number(game.rtpPercent).toFixed(2)}%</strong></div>
      <button class="solid-button" data-save-edge type="button" ${game.editable ? "" : "disabled"}>${game.editable ? "Save edge" : "Not adjustable"}</button>
      <p data-game-setting-status role="status"></p>
    </article>`).join("");
  container.querySelectorAll("[data-game-edge]").forEach((card) => {
    const game = gameEdgesCache.find((item) => item.id === card.dataset.gameEdge);
    const input = card.querySelector("[data-edge-input]");
    const rtp = card.querySelector(".game-edge-rtp strong");
    const button = card.querySelector("[data-save-edge]");
    const maintenanceButton = card.querySelector("[data-maintenance-toggle]");
    const status = card.querySelector("[data-game-setting-status]");
    input?.addEventListener("input", () => { const edge = Number(input.value); rtp.textContent = Number.isFinite(edge) ? `${Math.max(0, 100 - edge).toFixed(2)}%` : "—"; });
    button?.addEventListener("click", async () => {
      const edge = Number(input.value);
      if (!Number.isFinite(edge) || edge < 0 || edge > 10) { status.textContent = "Enter a value from 0% to 10%."; return; }
      button.disabled = true; button.textContent = "Saving…"; status.textContent = "";
      try {
        const result = await api(`/admin/game-edges/${encodeURIComponent(game.id)}`, { method: "POST", body: JSON.stringify({ houseEdgePercent: edge }) });
        gameEdgesCache = gameEdgesCache.map((item) => item.id === game.id ? result.game : item);
        renderGameEdges(); showToast(`${game.name} house edge updated`);
      } catch (error) { status.textContent = error.message; button.disabled = false; button.textContent = "Save edge"; }
    });
    maintenanceButton?.addEventListener("click", async () => {
      const maintenanceMode = !Boolean(game.maintenanceMode);
      maintenanceButton.disabled = true;
      status.textContent = "";
      try {
        const result = await api(`/admin/games/${encodeURIComponent(game.id)}/maintenance`, { method: "POST", body: JSON.stringify({ maintenanceMode }) });
        gameEdgesCache = gameEdgesCache.map((item) => item.id === game.id ? result.game : item);
        renderGameEdges();
        showToast(`${game.name} maintenance ${maintenanceMode ? "enabled" : "disabled"}`);
      } catch (error) { status.textContent = error.message; maintenanceButton.disabled = false; }
    });
  });
}

async function loadGameEdges(force = false) {
  if (!gameEdgesCache || force) gameEdgesCache = (await api("/admin/game-edges")).games || [];
  renderGameEdges(); setLastRefresh();
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
    container.innerHTML = '<div class="empty-compact"><span>—</span><strong>No transaction activity</strong><small>Player wagers and wallet movements will appear here.</small></div>';
    return;
  }
  container.innerHTML = activity.slice(0, 8).map((item) => `
    <div class="recent-item"><span class="recent-icon ${statusClass(item.type)}">${transactionIcon(item)}</span><div><strong>${escapeHtml(transactionLabel(item))} · ${escapeHtml(formatAsset(item.currency))}</strong><small>${escapeHtml(item.username || shortId(item.uid, 6))} · ${formatDate(item.occurredAt, true)}</small></div><b class="transaction-amount ${item.direction || "neutral"}">${escapeHtml(item.amount)}</b></div>
  `).join("");
}

function transactionLabel(item) {
  if (item.type === "game_wager" || item.type === "game_bet") return `${item.game || "Game"} wager`;
  if (item.type === "game_payout") return `${item.game || "Game"} payout`;
  if (item.type === "admin_balance_set") return "Balance adjustment";
  if (item.type === "deposit") return "Deposit";
  if (item.type === "withdrawal_hold") return "Withdrawal reserved";
  if (item.type === "withdrawal_release") return "Withdrawal released";
  if (item.type === "withdrawal") return "Withdrawal";
  if (item.type === "promo_reward") return "Promo claim";
  if (item.type === "leaderboard_payout" || item.type === "leaderboard_reward") return "Leaderboard payout";
  if (item.type === "rakeback_claim") return "Rakeback claim";
  if (["vip_reward", "bonus_reward", "reward"].includes(item.type)) return "Player reward";
  return String(item.type || "Wallet activity").replaceAll("_", " ");
}

function transactionIcon(item) {
  if (item.type === "game_wager" || item.type === "game_bet") return "−";
  if (item.type === "game_payout") return "+";
  if (item.type === "deposit") return "↓";
  if (["promo_reward", "leaderboard_payout", "leaderboard_reward", "rakeback_claim", "vip_reward", "bonus_reward", "reward"].includes(item.type)) return "★";
  if (String(item.type || "").startsWith("withdrawal")) return "↑";
  return "±";
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
  const availableUsd = balance.availableUsd === null || balance.availableUsd === undefined ? "Rate unavailable" : `$${balance.availableUsd}`;
  const heldUsd = balance.heldUsd === null || balance.heldUsd === undefined ? "Rate unavailable" : `$${balance.heldUsd}`;
  document.querySelector("#balance-current-available").textContent = `${availableUsd} · ${balance.available} ${formatAsset(currency)}`;
  document.querySelector("#balance-current-held").textContent = `${heldUsd} · ${balance.held} ${formatAsset(currency)}`;
  document.querySelector("#balance-amount").value = balance.availableUsd ?? "";
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
function closeBalanceEditor() {
  if (!balanceDialog.open) return;
  balanceDialog.close("cancel");
}
document.querySelector("#close-balance-editor").addEventListener("click", closeBalanceEditor);
document.querySelector("#cancel-balance-editor").addEventListener("click", closeBalanceEditor);
balanceDialog.addEventListener("click", (event) => {
  if (event.target === balanceDialog) closeBalanceEditor();
});
document.querySelector("#balance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activePlayer) return;
  const currency = document.querySelector("#balance-asset").value;
  const amount = document.querySelector("#balance-amount").value.trim();
  const reason = document.querySelector("#balance-reason").value.trim();
  const status = document.querySelector("#balance-status");
  const button = document.querySelector("#confirm-balance-update");
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) { status.textContent = "Enter a non-negative dollar balance with no more than 2 decimal places."; return; }
  if (reason.length < 3) { status.textContent = "Add a brief reason for this balance change."; return; }
  button.disabled = true;
  button.textContent = "Saving securely…";
  status.textContent = "";
  try {
    const playerName = activePlayer.username || "Player";
    await api(`/admin/users/${encodeURIComponent(activePlayer.uid)}/balances/${encodeURIComponent(currency)}`, {
      method: "POST",
      body: JSON.stringify({ amountUsd: amount, reason }),
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
balanceDialog.addEventListener("close", () => {
  activePlayer = null;
  document.querySelector("#balance-form").reset();
  document.querySelector("#balance-status").textContent = "";
});

document.querySelector("#player-search-button").addEventListener("click", () => loadPlayers().catch((error) => showToast(error.message, "error")));
document.querySelector("#player-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadPlayers().catch((error) => showToast(error.message, "error")); });

async function loadTransactions() {
  const type = document.querySelector("#transaction-type-filter")?.value || "all";
  const game = document.querySelector("#transaction-game-filter")?.value || "all";
  const query = document.querySelector("#transaction-search")?.value.trim() || "";
  const result = await api(`/admin/transactions?limit=100&type=${encodeURIComponent(type)}&game=${encodeURIComponent(game)}${query ? `&query=${encodeURIComponent(query)}` : ""}`);
  const summary = result.summary || {};
  document.querySelector('[data-transaction-metric="total"]').textContent = Number(summary.total24h || 0).toLocaleString();
  document.querySelector('[data-transaction-metric="wagers"]').textContent = Number(summary.wagers24h || 0).toLocaleString();
  document.querySelector('[data-transaction-metric="payouts"]').textContent = Number(summary.payouts24h || 0).toLocaleString();
  document.querySelector('[data-transaction-metric="payments"]').textContent = (Number(summary.deposits24h || 0) + Number(summary.withdrawals24h || 0)).toLocaleString();
  const body = document.querySelector("#transactions-table-body");
  if (!result.transactions?.length) setTableEmpty(body, 6, "No wallet transactions match these filters.");
  else body.innerHTML = result.transactions.map((item) => `
    <tr>
      <td><span class="table-primary">${escapeHtml(item.username || "Username pending")}</span><span class="table-secondary" title="${escapeHtml(item.uid)}">${escapeHtml(shortId(item.uid, 8))}</span></td>
      <td><span class="transaction-kind ${statusClass(item.type)}">${transactionIcon(item)}</span><span class="table-primary transaction-label">${escapeHtml(transactionLabel(item))}</span><span class="table-secondary">${escapeHtml(String(item.type || "activity").replaceAll("_", " "))}</span></td>
      <td>${escapeHtml(formatAsset(item.currency))}</td>
      <td><strong class="transaction-amount ${escapeHtml(item.direction || "neutral")}">${escapeHtml(item.amount)}</strong></td>
      <td><span class="table-primary" title="${escapeHtml(item.id)}">${escapeHtml(shortId(item.reference || item.id, 9))}</span><span class="table-secondary">${item.game ? `${escapeHtml(item.game)} round` : "Wallet reference"}</span></td>
      <td>${formatDate(item.createdAt, true)}</td>
    </tr>`).join("");
  setLastRefresh(new Date(result.generatedAt));
}

const reloadTransactions = () => loadTransactions().catch((error) => showToast(error.message, "error"));
document.querySelector("#transaction-search-button")?.addEventListener("click", reloadTransactions);
document.querySelector("#transaction-type-filter")?.addEventListener("change", reloadTransactions);
document.querySelector("#transaction-game-filter")?.addEventListener("change", reloadTransactions);
document.querySelector("#transaction-search")?.addEventListener("keydown", (event) => { if (event.key === "Enter") reloadTransactions(); });

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
  if (!container || !rankRewardsCache) return;
  container.innerHTML = rankRewardsCache.map((rank) => `<article class="rank-admin-card rank-reward-admin-card" data-admin-rank="${escapeHtml(rank.id)}"><img src="${escapeHtml(rank.badgePath)}" alt="" /><div><h3>${escapeHtml(rank.name)} <b>${escapeHtml(rank.tier)}</b></h3><small>$${(Number(rank.thresholdUsdCents || 0) / 100).toLocaleString()} wager</small></div><label><span>Reward (USD)</span><div class="leaderboard-money-input"><b>$</b><input data-rank-reward-value type="number" min="0" max="100000000" step="0.01" value="${(Number(rank.rewardUsdCents || 0) / 100).toFixed(2)}" /></div></label><label class="rank-reward-enabled"><input data-rank-reward-enabled type="checkbox" ${rank.enabled ? "checked" : ""} /> Enabled</label><button class="solid-button" data-save-rank-reward type="button">Save</button><p role="status"></p></article>`).join("");
  container.querySelectorAll("[data-save-rank-reward]").forEach((button) => button.addEventListener("click", saveRankReward));
}

async function loadRankRewards(force = false) {
  if (!rankRewardsCache || force) rankRewardsCache = (await api("/admin/rank-rewards")).ranks || [];
  renderRanks();
  setLastRefresh();
}

async function saveRankReward(event) {
  const card = event.currentTarget.closest("[data-admin-rank]");
  const button = event.currentTarget;
  const message = card.querySelector("p");
  button.disabled = true;
  button.textContent = "Saving…";
  message.textContent = "";
  try {
    const body = await api(`/admin/rank-rewards/${encodeURIComponent(card.dataset.adminRank)}`, { method: "POST", body: JSON.stringify({ rewardUsd: card.querySelector("[data-rank-reward-value]").value, enabled: card.querySelector("[data-rank-reward-enabled]").checked }) });
    rankRewardsCache = rankRewardsCache.map((rank) => rank.id === body.rank.id ? body.rank : rank);
    message.textContent = "Saved";
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Save"; }
}

function adminPrize(cents) {
  const amount = Number(cents || 0) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return "Prize TBA";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function adminLeaderboardCountdown(leaderboard) {
  if (!leaderboard?.endsAt) return "Not started";
  const remaining = Math.max(0, Math.floor((Date.parse(leaderboard.endsAt) - Date.now()) / 1000));
  if (!remaining) return "Finished";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${String(days).padStart(2, "0")}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function renderLeaderboards() {
  const container = document.querySelector("#leaderboard-status-grid");
  if (!container || !leaderboardCache) return;
  container.innerHTML = leaderboardCache.map((leaderboard) => {
    const active = leaderboard.status === "active" && leaderboard.endsAt && Date.parse(leaderboard.endsAt) > Date.now();
    const status = active ? "live" : leaderboard.endsAt ? "ended" : "scheduled";
    const labels = { daily: "Daily", weekly: "Weekly", biweekly: "BiWeekly", monthly: "Monthly" };
    const label = labels[leaderboard.cadence] || leaderboard.cadence;
    return `<article class="panel-card leaderboard-status-card" data-leaderboard-admin-cadence="${leaderboard.cadence}"><div class="leaderboard-status-head"><span>${label.toUpperCase()} RACE</span><span class="status-pill ${status}">${active ? "LIVE" : leaderboard.endsAt ? "ENDED" : "NOT STARTED"}</span></div><h3>King of the Track</h3><strong class="leaderboard-status-prize">${escapeHtml(adminPrize(leaderboard.prizeUsdCents))}</strong><b class="leaderboard-status-countdown">${escapeHtml(adminLeaderboardCountdown(leaderboard))}</b><small>${Number(leaderboard.prizePlaces || 10)} paid places · ${leaderboard.endsAt ? `Ends ${escapeHtml(formatDate(leaderboard.endsAt))}` : "Set the prize and duration to put this race live."}</small></article>`;
  }).join("");
}

async function loadLeaderboards(force = false) {
  if (!leaderboardCache || force) {
    const result = await api("/admin/leaderboards");
    leaderboardCache = result.leaderboards || [];
  }
  renderLeaderboards();
  setLastRefresh();
}

function renderPromotions() {
  const container = document.querySelector("#promotion-list");
  if (!container || !promotionsCache) return;
  if (!promotionsCache.length) {
    container.innerHTML = '<div class="admin-empty"><strong>No promotion codes yet</strong><span>Create the first live wallet reward.</span></div>';
    return;
  }
  container.innerHTML = promotionsCache.map((promo) => {
    const availability = !promo.enabled ? "PAUSED" : promo.endsAt && Date.parse(promo.endsAt) <= Date.now() ? "ENDED" : promo.startsAt && Date.parse(promo.startsAt) > Date.now() ? "SCHEDULED" : "LIVE";
    const limit = promo.maxClaims ? `${promo.claimCount.toLocaleString()} / ${promo.maxClaims.toLocaleString()} claims` : `${promo.claimCount.toLocaleString()} claims`;
    const rankName = String(promo.minimumRankStage || "rookie").replaceAll("-", " ");
    return `<article><header><div><strong>${escapeHtml(promo.code)}</strong><span>${escapeHtml(promo.title)}</span></div><span class="promotion-card-actions"><b data-status="${availability.toLowerCase()}">${availability}</b><button type="button" data-remove-promotion="${escapeHtml(promo.id)}" aria-label="Remove ${escapeHtml(promo.code)}">Remove</button></span></header><div class="promotion-reward">${escapeHtml(promo.rewardAmount)} ${escapeHtml(formatAsset(promo.rewardCurrency))}</div><small>Minimum ${escapeHtml(rankName)} ${["I", "II", "III"][promo.minimumRankTier - 1] || "I"} · ${escapeHtml(limit)}</small>${Number(promo.minimumDepositUsd) > 0 ? `<small>Deposit $${escapeHtml(promo.minimumDepositUsd)} across any crypto within ${promo.depositLookbackDays || "all"} days</small>` : ""}</article>`;
  }).join("");
  container.querySelectorAll("[data-remove-promotion]").forEach((button) => button.addEventListener("click", async () => {
    const promo = promotionsCache.find((item) => item.id === button.dataset.removePromotion);
    if (!promo || !window.confirm(`Remove promotion ${promo.code}? It will stop working immediately.`)) return;
    button.disabled = true;
    button.textContent = "Removing…";
    try {
      await api(`/admin/promotions/${encodeURIComponent(promo.id)}/remove`, { method: "POST" });
      promotionsCache = promotionsCache.filter((item) => item.id !== promo.id);
      renderPromotions();
      showToast(`${promo.code} removed`);
    } catch (error) { button.disabled = false; button.textContent = "Remove"; showToast(error.message, "error"); }
  }));
}

function preparePromotionAssets() {
  const options = assetOrder.map((code) => `<option value="${code}">${escapeHtml(formatAsset(code))}</option>`).join("");
  for (const select of [document.querySelector("#promo-reward-currency")]) {
    if (select && !select.options.length) select.innerHTML = options;
  }
}

async function loadPromotionsWorkspace(force = false) {
  preparePromotionAssets();
  const [leaderboards, promotions] = await Promise.all([
    (!leaderboardCache || force) ? api("/admin/leaderboards") : Promise.resolve({ leaderboards: leaderboardCache }),
    (!promotionsCache || force) ? api("/admin/promotions") : Promise.resolve({ promotions: promotionsCache }),
  ]);
  leaderboardCache = leaderboards.leaderboards || [];
  promotionsCache = promotions.promotions || [];
  renderLeaderboards();
  renderPromotions();
  setLastRefresh();
}

document.querySelector("#promo-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#promo-form-status");
  const button = document.querySelector("#create-promo");
  const dateValue = (selector) => {
    const value = document.querySelector(selector).value;
    return value ? new Date(value).toISOString() : null;
  };
  const payload = {
    code: document.querySelector("#promo-code").value,
    title: document.querySelector("#promo-title").value,
    description: document.querySelector("#promo-description").value,
    rewardCurrency: document.querySelector("#promo-reward-currency").value,
    rewardAmount: document.querySelector("#promo-reward-amount").value,
    minimumRankStage: document.querySelector("#promo-min-rank").value,
    minimumRankTier: Number(document.querySelector("#promo-min-tier").value),
    minimumDepositUsd: document.querySelector("#promo-min-deposit").value || "0",
    depositLookbackDays: Number(document.querySelector("#promo-lookback-days").value || 0),
    maxClaims: Number(document.querySelector("#promo-max-claims").value || 0),
    startsAt: dateValue("#promo-starts-at"),
    endsAt: dateValue("#promo-ends-at"),
    enabled: document.querySelector("#promo-enabled").checked,
  };
  button.disabled = true;
  button.textContent = "Creating…";
  status.textContent = "";
  try {
    const result = await api("/admin/promotions", { method: "POST", body: JSON.stringify(payload) });
    promotionsCache = [result.promotion, ...(promotionsCache || [])];
    renderPromotions();
    event.currentTarget.reset();
    document.querySelector("#promo-enabled").checked = true;
    document.querySelector("#promo-min-deposit").value = "0";
    document.querySelector("#promo-lookback-days").value = "0";
    document.querySelector("#promo-max-claims").value = "0";
    showToast(`${result.promotion.code} is ready`);
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Create promotion"; }
});

document.querySelector("#leaderboard-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const cadence = document.querySelector("#leaderboard-cadence").value;
  const prizeUsd = document.querySelector("#leaderboard-prize").value.trim();
  const prizePlaces = Number(document.querySelector("#leaderboard-places").value || 0);
  const days = Number(document.querySelector("#leaderboard-days").value || 0);
  const hours = Number(document.querySelector("#leaderboard-hours").value || 0);
  const minutes = Number(document.querySelector("#leaderboard-minutes").value || 0);
  const durationSeconds = Math.round(days * 86400 + hours * 3600 + minutes * 60);
  const status = document.querySelector("#leaderboard-form-status");
  const button = document.querySelector("#start-leaderboard");
  if (!/^\d+(?:\.\d{1,2})?$/.test(prizeUsd) || Number(prizeUsd) <= 0) { status.textContent = "Enter a valid prize amount."; return; }
  if (!Number.isInteger(prizePlaces) || prizePlaces < 1 || prizePlaces > 50) { status.textContent = "Choose between 1 and 50 prize places."; return; }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 60) { status.textContent = "Set a countdown of at least one minute."; return; }
  button.disabled = true;
  button.textContent = "Starting race…";
  status.textContent = "";
  try {
    const result = await api(`/admin/leaderboards/${cadence}/start`, {
      method: "POST",
      body: JSON.stringify({ prizeUsd, prizePlaces, durationSeconds }),
    });
    leaderboardCache = (leaderboardCache || []).map((item) => item.cadence === result.leaderboard.cadence ? result.leaderboard : item);
    renderLeaderboards();
    const labels = { daily: "Daily", weekly: "Weekly", biweekly: "BiWeekly", monthly: "Monthly" };
    showToast(`${labels[cadence] || cadence} King of the Track is live`);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Start leaderboard";
  }
});

document.querySelector("#leaderboard-cadence")?.addEventListener("change", (event) => {
  const suggestedDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
  document.querySelector("#leaderboard-days").value = String(suggestedDays[event.currentTarget.value] || 7);
  document.querySelector("#leaderboard-hours").value = "0";
  document.querySelector("#leaderboard-minutes").value = "0";
});

setInterval(() => {
  if (activeView === "promotions" && leaderboardCache) renderLeaderboards();
}, 1000);

setInterval(() => {
  if (activeView === "transactions" && !adminApp.hidden) loadTransactions().catch(() => {});
}, 5000);

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
  const [data, chatSettings] = await Promise.all([
    systemCache && !force ? systemCache : api("/admin/system"),
    chatSettingsCache && !force ? chatSettingsCache : api("/admin/chat/settings"),
  ]);
  systemCache = data;
  chatSettingsCache = chatSettings;
  renderSystem(data);
  renderChatSettings(chatSettings);
  setLastRefresh();
}

function ensureChatSettingsControl() {
  let card = document.querySelector(".chat-access-control");
  if (card) return card;
  card = document.createElement("article");
  card.className = "panel-card chat-access-control";
  card.innerHTML = `<div class="panel-heading"><div><p class="section-kicker">LIVE CHAT</p><h3>Chat controls</h3><p>Everyone can read chat. Control who can send, how often they can post and the maximum message length.</p></div></div><form id="chat-access-form"><label><span>Minimum lifetime wager (USD)</span><div class="leaderboard-money-input"><b>$</b><input id="chat-minimum-wager" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" value="100.00" required /></div></label><label><span>Cooldown (seconds)</span><input id="chat-cooldown" type="number" inputmode="decimal" min="0" max="300" step="0.1" value="1.5" required /></label><label><span>Maximum characters</span><input id="chat-max-characters" type="number" inputmode="numeric" min="1" max="1000" step="1" value="240" required /></label><button class="solid-button" type="submit">Save chat controls</button><p class="dialog-status" id="chat-access-status" role="status" aria-live="polite"></p></form>`;
  const systemPanel = document.querySelector('[data-admin-panel="system"]');
  systemPanel?.querySelector(".global-controls")?.before(card);
  card.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const status = event.currentTarget.querySelector(".dialog-status");
    button.disabled = true;
    status.textContent = "";
    try {
      chatSettingsCache = await api("/admin/chat/settings", {
        method: "POST",
        body: JSON.stringify({
          minimumWagerUsd: event.currentTarget.querySelector("#chat-minimum-wager").value,
          cooldownSeconds: Number(event.currentTarget.querySelector("#chat-cooldown").value),
          maxCharacters: Number(event.currentTarget.querySelector("#chat-max-characters").value),
        }),
      });
      renderChatSettings(chatSettingsCache);
      status.textContent = "Live chat controls updated for every player.";
      status.dataset.state = "success";
      showToast("Chat requirement updated");
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
    } finally {
      button.disabled = false;
    }
  });
  return card;
}

function renderChatSettings(settings) {
  const card = ensureChatSettingsControl();
  const minimum = card?.querySelector("#chat-minimum-wager");
  const cooldown = card?.querySelector("#chat-cooldown");
  const maximum = card?.querySelector("#chat-max-characters");
  if (minimum) minimum.value = (Number(settings?.minimumWagerUsdCents || 0) / 100).toFixed(2);
  if (cooldown) cooldown.value = String(Number(settings?.cooldownSeconds ?? 1.5));
  if (maximum) maximum.value = String(Number(settings?.maxCharacters || 240));
}

function localDateTimeValue(timestamp) {
  if (!Number(timestamp)) return "";
  const date = new Date(Number(timestamp) - new Date(Number(timestamp)).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function renderAnnouncementSettings(data) {
  const announcement = data?.announcement || {};
  const text = document.querySelector("#announcement-text");
  const enabled = document.querySelector("#announcement-enabled");
  if (!text || !enabled) return;
  text.value = announcement.text || "";
  enabled.checked = Boolean(announcement.enabled);
  document.querySelector("#announcement-starts").value = localDateTimeValue(announcement.startsAt);
  document.querySelector("#announcement-ends").value = localDateTimeValue(announcement.endsAt);
  updateAnnouncementPreview();
}

async function loadAnnouncementSettings(force = false) {
  if (!announcementCache || force) announcementCache = await api("/admin/announcement");
  renderAnnouncementSettings(announcementCache);
  setLastRefresh();
}

function updateAnnouncementPreview() {
  const text = document.querySelector("#announcement-text")?.value || "";
  const enabled = Boolean(document.querySelector("#announcement-enabled")?.checked);
  const preview = document.querySelector("#announcement-preview strong");
  const count = document.querySelector("#announcement-character-count");
  const liveStatus = document.querySelector("#announcement-live-status");
  if (preview) preview.textContent = text.trim() || "Your announcement preview appears here.";
  if (count) count.textContent = String(text.length);
  if (liveStatus) { liveStatus.textContent = enabled ? "ON" : "OFF"; liveStatus.className = `status-pill ${enabled ? "live" : ""}`; }
}

document.querySelector("#announcement-text")?.addEventListener("input", updateAnnouncementPreview);
document.querySelector("#announcement-enabled")?.addEventListener("change", updateAnnouncementPreview);
document.querySelector("#announcement-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const status = document.querySelector("#announcement-status");
  const toIso = (value) => value ? new Date(value).toISOString() : null;
  button.disabled = true;
  status.textContent = "";
  try {
    announcementCache = await api("/admin/announcement", {
      method: "POST",
      body: JSON.stringify({
        text: document.querySelector("#announcement-text").value,
        enabled: document.querySelector("#announcement-enabled").checked,
        startsAt: toIso(document.querySelector("#announcement-starts").value),
        endsAt: toIso(document.querySelector("#announcement-ends").value),
      }),
    });
    renderAnnouncementSettings(announcementCache);
    status.textContent = "Announcement updated across GamRace.";
    status.dataset.state = "success";
    showToast("Announcement updated");
  } catch (error) {
    status.textContent = error.message;
    status.dataset.state = "error";
  } finally { button.disabled = false; }
});

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

