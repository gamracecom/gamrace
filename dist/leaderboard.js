(function () {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  const tabs = [...document.querySelectorAll("[data-leaderboard-tab]")];
  const podiumCards = [...document.querySelectorAll("[data-podium-position]")];
  const rowsRoot = document.querySelector("[data-leaderboard-rows]");
  const emptyState = document.querySelector("[data-leaderboard-empty]");
  const prize = document.querySelector("[data-leaderboard-page-prize]");
  const countdown = document.querySelector("[data-leaderboard-page-countdown]");
  const status = document.querySelector("[data-leaderboard-status]");
  const campaigns = new Map();
  let activeCadence = "daily";

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

  function podiumEntry(position, entry) {
    const card = podiumCards.find((item) => Number(item.dataset.podiumPosition) === position);
    if (!card) return;
    const image = card.querySelector("[data-racer-badge]");
    card.querySelector("[data-racer-name]").textContent = entry?.username || "Grid position open";
    card.querySelector("[data-racer-wager]").textContent = entry ? `${wagerFromCents(entry.wagerUsdCents)} wagered` : "—";
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

  function makeRow(entry) {
    const row = document.createElement("div");
    row.className = "race-grid-row";
    row.setAttribute("role", "row");

    const position = document.createElement("span");
    position.className = "race-position";
    position.textContent = String(entry.position).padStart(2, "0");

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

    const rank = document.createElement("span");
    rank.className = "race-rank-label";
    rank.textContent = entry.playerRank?.label || "Private";

    const wager = document.createElement("strong");
    wager.className = "race-wager-value";
    wager.textContent = wagerFromCents(entry.wagerUsdCents);
    row.append(position, racer, rank, wager);
    return row;
  }

  function render() {
    const campaign = campaigns.get(activeCadence);
    const standings = Array.isArray(campaign?.standings) ? campaign.standings : [];
    prize.textContent = moneyFromCents(campaign?.prizeUsdCents);
    countdown.textContent = countdownText(campaign);
    tabs.forEach((tab) => {
      const active = tab.dataset.leaderboardTab === activeCadence;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    [1, 2, 3].forEach((position) => podiumEntry(position, standings[position - 1]));
    rowsRoot.replaceChildren(...standings.slice(3).map(makeRow));
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
