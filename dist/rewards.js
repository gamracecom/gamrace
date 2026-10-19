import { getRankProgress } from "./rank-engine.js?v=rank-badges-2";

const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const poolNames = { instant: "Instant Rakeback", weekly: "Weekly Rakeback", monthly: "Monthly Rakeback", promo: "Promo code" };
const status = document.querySelector("[data-rewards-status]");
const history = document.querySelector("[data-rewards-history]");
let snapshot = null;
let serverOffset = 0;
let loading = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function usd(cents) { return money.format(Math.max(0, Number(cents || 0)) / 100); }

function countdown(iso) {
  if (!iso) return "Available as you play";
  const remaining = Math.max(0, new Date(iso).getTime() - (Date.now() + serverOffset));
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor(remaining % 86_400_000 / 3_600_000);
  const minutes = Math.floor(remaining % 3_600_000 / 60_000);
  if (days) return `Next drop in ${days}d ${hours}h`;
  if (hours) return `Next drop in ${hours}h ${minutes}m`;
  return `Next drop in ${Math.max(1, minutes)}m`;
}

async function request(path, options = {}) {
  const token = await window.GamRaceAuth?.getToken?.();
  if (!token) throw Object.assign(new Error("Sign in to unlock your reward circuit."), { status: 401 });
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "Rewards could not be loaded right now."), { status: response.status });
  return body;
}

function renderPool(id, pool) {
  const station = document.querySelector(`[data-reward-pool="${id}"]`);
  if (!station || !pool) return;
  station.querySelector("[data-reward-amount]").textContent = usd(pool.availableUsdCents);
  const accrual = station.querySelector("[data-reward-accrual]");
  if (id === "instant") accrual.textContent = `${(pool.rateBasisPoints / 100).toFixed(2)}% of eligible wager`;
  else accrual.textContent = `${usd(pool.accruingUsdCents)} building this ${id === "weekly" ? "week" : "month"}`;
  const timer = station.querySelector("[data-reward-countdown]");
  if (timer) timer.textContent = pool.canClaim ? "READY TO CLAIM" : countdown(pool.nextAvailableAt);
  const button = station.querySelector("[data-claim-reward]");
  button.disabled = !pool.canClaim;
  button.textContent = pool.canClaim ? `Claim ${usd(pool.availableUsdCents)}` : id === "instant" ? "Nothing to claim yet" : "Not available yet";
  station.classList.toggle("ready", Boolean(pool.canClaim));
}

function renderRank(summary = {}) {
  const progress = getRankProgress(Number(summary.lifetimeWeightedWager ?? summary.totalWagered ?? 0));
  document.querySelector("[data-rewards-rank-badge]").src = progress.currentRank.badgePath;
  document.querySelector("[data-rewards-rank-name]").textContent = progress.currentRank.label;
  document.querySelector("[data-rewards-rank-percent]").textContent = `${Math.round(progress.percentage)}%`;
  document.querySelector("[data-rewards-rank-fill]").style.width = `${progress.percentage}%`;
  document.querySelector("[data-rewards-rank-next]").textContent = progress.nextRank
    ? `Next rank at ${money.format(progress.nextRank.threshold)} weighted wager`
    : `${money.format(progress.currentValue)} lifetime weighted wager`;
}

function renderHistory(rows = []) {
  if (!rows.length) {
    history.innerHTML = '<div class="rewards-empty">Your successful reward claims will appear here.</div>';
    return;
  }
  history.innerHTML = rows.map((row) => `<article class="reward-history-row"><span class="reward-history-icon"><img src="assets/brand/gamrace-icon.png" alt="" /></span><span><strong>${escapeHtml(poolNames[row.type] || "Reward")}</strong><small>${new Date(row.createdAt).toLocaleString()}</small></span><b>${row.rewardUsdCents ? usd(row.rewardUsdCents) : `${escapeHtml(row.amount)} ${escapeHtml(row.currency)}`}</b></article>`).join("");
}

function render() {
  if (!snapshot) return;
  Object.entries(snapshot.pools || {}).forEach(([id, pool]) => renderPool(id, pool));
  renderRank(snapshot.summary);
  renderHistory(snapshot.history);
}

async function loadRewards() {
  if (loading) return;
  loading = true;
  status.textContent = "Loading your live rewards…";
  try {
    const body = await request("/rewards");
    snapshot = body.rewards;
    serverOffset = new Date(snapshot.serverNow).getTime() - Date.now();
    render();
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
    if (error.status === 401) history.innerHTML = '<div class="rewards-empty">Sign in to see and claim your rewards.</div>';
  } finally { loading = false; }
}

document.querySelectorAll("[data-claim-reward]").forEach((button) => button.addEventListener("click", async () => {
  const pool = button.dataset.claimReward;
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Claiming…";
  try {
    const body = await request(`/rewards/${pool}/claim`, { method: "POST", body: "{}" });
    snapshot = body.rewards;
    render();
    status.textContent = `${poolNames[pool]} credited to your wallet.`;
    window.dispatchEvent(new CustomEvent("gamrace:wallet-balance-changed"));
  } catch (error) { status.textContent = error.message; button.textContent = previous; }
  finally { if (snapshot) renderPool(pool, snapshot.pools[pool]); }
}));

document.querySelector(".rewards-promo-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.code;
  const button = form.querySelector("button");
  const message = document.querySelector(".rewards-promo-status");
  button.disabled = true;
  button.textContent = "Claiming…";
  message.textContent = "";
  try {
    const body = await request("/promotions/claim", { method: "POST", body: JSON.stringify({ code: input.value.trim() }) });
    message.textContent = `${body.promotion?.title || "Promo"} claimed successfully.`;
    input.value = "";
    window.dispatchEvent(new CustomEvent("gamrace:wallet-balance-changed"));
    await loadRewards();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Claim"; }
});

window.addEventListener("gamrace:auth-state", (event) => { if (event.detail?.signedIn) loadRewards(); else status.textContent = "Sign in to unlock your reward circuit."; });
window.addEventListener("gamrace:wallet-balance-changed", () => window.setTimeout(loadRewards, 350));
window.setInterval(() => { if (snapshot) Object.entries(snapshot.pools || {}).forEach(([id, pool]) => renderPool(id, pool)); }, 30_000);
if (window.GamRaceAuth?.getUser?.()) loadRewards();
