const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const poolNames = { instant: "Instant Rakeback", weekly: "Weekly Rakeback", monthly: "Monthly Rakeback", promo: "Promo code" };
const status = document.querySelector("[data-rewards-status]");
let snapshot = null;
let loading = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function usd(cents) { return money.format(Math.max(0, Number(cents || 0)) / 100); }

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
  const button = station.querySelector("[data-claim-reward]");
  button.disabled = !pool.canClaim;
  button.textContent = pool.canClaim ? (id === "instant" ? `Claim ${usd(pool.availableUsdCents)}` : "Claim") : id === "instant" ? "Nothing to claim yet" : "Not available yet";
  station.classList.toggle("ready", Boolean(pool.canClaim));
}

function lockIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
}

function renderRankRewards(ranks = []) {
  const rail = document.querySelector("[data-rank-reward-rail]");
  if (!rail) return;
  rail.innerHTML = ranks.map((rank) => {
    const starterRank = rank.id === "rookie-1";
    const state = rank.claimed ? "claimed" : rank.canClaim ? "claimable" : starterRank && rank.unlocked ? "current" : "locked";
    const action = rank.claimed ? "Claimed" : rank.canClaim ? `Claim ${usd(rank.rewardUsdCents)}` : starterRank && rank.unlocked ? "Current" : `${lockIcon()} Locked`;
    return `<article class="rank-reward-item ${state}" data-rank-id="${escapeHtml(rank.id)}"><div class="rank-reward-image"><img src="${escapeHtml(rank.badgePath)}" alt="" /></div><h2><span>${escapeHtml(rank.name)}</span><b>${escapeHtml(rank.tier)}</b></h2><button type="button" data-claim-rank="${escapeHtml(rank.id)}" ${rank.canClaim ? "" : "disabled"}>${action}</button></article>`;
  }).join("");
  const current = [...rail.querySelectorAll(".rank-reward-item.current,.rank-reward-item.claimable")].at(-1);
  requestAnimationFrame(() => current?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" }));
  rail.querySelectorAll("[data-claim-rank]").forEach((button) => button.addEventListener("click", claimRankReward));
}

function render() {
  if (!snapshot) return;
  Object.entries(snapshot.pools || {}).forEach(([id, pool]) => renderPool(id, pool));
  renderRankRewards(snapshot.rankRewards);
}

async function loadRewards() {
  if (loading) return;
  loading = true;
  status.textContent = "";
  try {
    const body = await request("/rewards");
    snapshot = body.rewards;
    render();
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  } finally { loading = false; }
}

async function claimRankReward(event) {
  const button = event.currentTarget;
  const rankId = button.dataset.claimRank;
  button.disabled = true;
  button.textContent = "Claiming…";
  try {
    const body = await request(`/rewards/ranks/${rankId}/claim`, { method: "POST", body: "{}" });
    snapshot.rankRewards = body.rankRewards;
    renderRankRewards(snapshot.rankRewards);
    await window.gamraceWallet?.refresh?.();
    status.textContent = `${usd(body.claim.rewardUsdCents)} credited.`;
    window.dispatchEvent(new CustomEvent("gamrace:wallet-balance-changed"));
  } catch (error) { status.textContent = error.message; renderRankRewards(snapshot.rankRewards); }
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
    await window.gamraceWallet?.refresh?.();
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
    await window.gamraceWallet?.refresh?.();
    window.dispatchEvent(new CustomEvent("gamrace:wallet-balance-changed"));
    await loadRewards();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Claim"; }
});

window.addEventListener("gamrace:auth-state", (event) => { if (event.detail?.signedIn) loadRewards(); else status.textContent = ""; });
window.addEventListener("gamrace:wallet-balance-changed", () => window.setTimeout(loadRewards, 350));
if (window.GamRaceAuth?.getUser?.()) loadRewards();
