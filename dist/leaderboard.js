(function () {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  const tabs = [...document.querySelectorAll("[data-leaderboard-tab]")];
  const podiumCards = [...document.querySelectorAll("[data-podium-position]")];
  const rowsRoot = document.querySelector("[data-leaderboard-rows]");
  const emptyState = document.querySelector("[data-leaderboard-empty]");
  const prize = document.querySelector("[data-leaderboard-page-prize]");
  const countdown = document.querySelector("[data-leaderboard-page-countdown]");
  const cadenceLabel = document.querySelector("[data-leaderboard-page-cadence]");
  const status = document.querySelector("[data-leaderboard-status]");
  const campaigns = new Map();
  let activeCadence = "daily";
  const prizeShares = [0.35, 0.2, 0.14, 0.09, 0.065, 0.05, 0.04, 0.035, 0.02, 0.01];

  function moneyFromCents(value) {
    const cents = Math.max(0, Number(value || 0));
    if (!cents) return "Prize TBA";
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0,
    }).format(cents / 100);
  }

  function wagerFromCents(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Math.max(0, Number(value || 0)) / 100);
  }

  function prizeForPosition(campaign, position) {
    const total = Math.max(0, Number(campaign?.prizeUsdCents || 0));
    const share = prizeShares[position - 1] || 0;
    return total && share ? moneyFromCents(Math.round(total * share)) : "Prize TBA";
  }

  function countdownText(campaign) {
    if (!campaign?.endsAt || campaign.status === "scheduled") return "Race opens soon";
    const remaining = new Date(campaign.endsAt).getTime() - Date.now();
    if (remaining <= 0 || campaign.status === "ended") return "Race finished";
    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }

  function podiumEntry(position, entry, campaign) {
    const card = podiumCards.find((item) => Number(item.dataset.podiumPosition) === position);
    if (!card) return;
    const image = card.querySelector("[data-racer-badge]");
    card.querySelector("[data-racer-name]").textContent = entry?.username || "Grid position open";
    card.querySelector("[data-racer-rank]").textContent = entry?.playerRank?.label || "Qualify to take the seat";
    card.querySelector("[data-racer-wager]").textContent = entry ? wagerFromCents(entry.wagerUsdCents) : "—";
    card.querySelector("[data-racer-prize]").textContent = prizeForPosition(campaign, position);
    card.classList.toggle("occupied", Boolean(entry));
    if (entry?.playerRank?.badgePath) {
      image.src = entry.playerRank.badgePath;
      image.alt = entry.playerRank.label || "Player rank";
      image.hidden = false;
    } else {
      image.removeAttribute("src");
      image.alt = "";
      image.hidden = true;
    }
  }

  function makeRow(entry, campaign) {
    const row = document.createElement("div");
    row.className = `race-grid-row${entry.position <= 3 ? ` top-${entry.position}` : ""}`;
    row.setAttribute("role", "row");

    const position = document.createElement("span");
    position.className = "race-position";
    position.textContent = entry.position === 1 ? "♛" : String(entry.position);

    const racer = document.createElement("span");
    racer.className = "race-player";
    const badge = document.createElement("span");
    badge.className = "race-player-badge";
    if (entry.playerRank?.badgePath) {
      const image = document.createElement("img");
      image.src = entry.playerRank.badgePath;
      image.alt = "";
      image.decoding = "async";
      badge.append(image);
    }
    const username = document.createElement("strong");
    username.textContent = entry.username || "Hidden Racer";
    racer.append(badge, username);

    const wager = document.createElement("strong");
    wager.className = "race-wager-value";
    wager.textContent = wagerFromCents(entry.wagerUsdCents);
    const rowPrize = document.createElement("strong");
    rowPrize.className = "race-prize-value";
    rowPrize.textContent = prizeForPosition(campaign, entry.position);
    row.append(position, racer, wager, rowPrize);
    return row;
  }

  function render() {
    const campaign = campaigns.get(activeCadence);
    const standings = Array.isArray(campaign?.standings) ? campaign.standings : [];
    prize.textContent = moneyFromCents(campaign?.prizeUsdCents);
    countdown.textContent = countdownText(campaign);
    cadenceLabel.textContent = activeCadence === "biweekly" ? "BiWeekly" : "Daily";
    tabs.forEach((tab) => {
      const active = tab.dataset.leaderboardTab === activeCadence;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    [1, 2, 3].forEach((position) => podiumEntry(position, standings[position - 1], campaign));
    rowsRoot.replaceChildren(...standings.slice(0, 10).map((entry) => makeRow(entry, campaign)));
    emptyState.hidden = standings.length > 0;
    document.querySelector(".race-podium")?.classList.remove("race-podium-refreshed");
    requestAnimationFrame(() => document.querySelector(".race-podium")?.classList.add("race-podium-refreshed"));
  }

  async function refresh() {
    try {
      const response = await fetch(`${API_BASE}/leaderboards`, { cache: "no-store" });
      if (!response.ok) throw new Error("Leaderboard data is temporarily unavailable");
      const body = await response.json();
      (body.leaderboards || []).forEach((campaign) => campaigns.set(campaign.cadence, campaign));
      status.textContent = "";
      render();
    } catch (error) {
      status.textContent = error.message || "Leaderboard data is temporarily unavailable";
      render();
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => {
    activeCadence = tab.dataset.leaderboardTab || "daily";
    render();
  }));
  render();
  refresh();
  window.setInterval(() => {
    countdown.textContent = countdownText(campaigns.get(activeCadence));
  }, 1000);
  window.setInterval(refresh, 15000);
})();
