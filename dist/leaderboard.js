(function () {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  const tabs = [...document.querySelectorAll("[data-leaderboard-tab]")];
  const podiumCards = [...document.querySelectorAll("[data-podium-position]")];
  const rowsRoot = document.querySelector("[data-leaderboard-rows]");
  const prize = document.querySelector("[data-leaderboard-page-prize]");
  const countdown = document.querySelector("[data-leaderboard-page-countdown]");
  const cadenceLabel = document.querySelector("[data-leaderboard-page-cadence]");
  const status = document.querySelector("[data-leaderboard-status]");
  const currentPlayerRow = document.querySelector("[data-current-player-row]");
  const tabList = document.querySelector(".leaderboard-period-tabs");
  const campaigns = new Map();
  let activeCadence = null;

  function isConfigured(campaign) {
    return Boolean(campaign?.startsAt && campaign?.endsAt);
  }

  function syncAvailableTabs() {
    const available = tabs.filter((tab) => isConfigured(campaigns.get(tab.dataset.leaderboardTab)));
    tabs.forEach((tab) => { tab.hidden = !available.includes(tab); });
    if (tabList) {
      tabList.hidden = available.length === 0;
      tabList.style.setProperty("--leaderboard-tab-count", String(Math.max(1, available.length)));
    }
    if (!available.some((tab) => tab.dataset.leaderboardTab === activeCadence)) {
      activeCadence = available[0]?.dataset.leaderboardTab || null;
    }
  }

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
    const places = Math.max(1, Number(campaign?.prizePlaces || 10));
    if (!total || position < 1 || position > places) return total ? "—" : "Prize TBA";
    const totalWeight = places * (places + 1) / 2;
    const weight = places - position + 1;
    if (position < places) return moneyFromCents(Math.floor(total * weight / totalWeight));
    let distributed = 0;
    for (let index = 1; index < places; index += 1) distributed += Math.floor(total * (places - index + 1) / totalWeight);
    return moneyFromCents(Math.max(0, total - distributed));
  }

  function loadBadge(image, path, label = "Player rank") {
    const holder = image?.closest(".podium-badge, .race-player-badge");
    if (!image || !path) {
      image?.removeAttribute("src");
      if (image) image.hidden = true;
      holder?.classList.add("badge-fallback");
      return;
    }
    image.onload = () => { image.hidden = false; holder?.classList.remove("badge-fallback"); };
    image.onerror = () => { image.hidden = true; image.removeAttribute("src"); holder?.classList.add("badge-fallback"); };
    image.alt = label;
    image.src = path;
  }

  function countdownText(campaign) {
    if (!campaign?.endsAt || campaign.status === "scheduled") return "Race opens soon";
    if (campaign.status === "waiting") return "Waiting for the next race";
    const remaining = new Date(campaign.endsAt).getTime() - Date.now();
    if (remaining <= 0 || campaign.status === "ended") return "Settling race payouts…";
    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `Ends in ${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }

  function podiumEntry(position, entry, campaign) {
    const card = podiumCards.find((item) => Number(item.dataset.podiumPosition) === position);
    if (!card) return;
    const image = card.querySelector("[data-racer-badge]");
    const playerName = card.querySelector("[data-racer-name]");
    const playerBadge = card.querySelector(".podium-badge");
    playerName.textContent = entry?.username || "Grid position open";
    const profileUsername = entry?.profileVisible ? entry.username : "";
    playerName.disabled = !profileUsername;
    playerBadge.disabled = !profileUsername;
    if (profileUsername) {
      playerName.dataset.playerProfile = profileUsername;
      playerBadge.dataset.playerProfile = profileUsername;
    } else {
      delete playerName.dataset.playerProfile;
      delete playerBadge.dataset.playerProfile;
    }
    card.querySelector("[data-racer-rank]").textContent = entry?.playerRank?.label || "Qualify to take the seat";
    card.querySelector("[data-racer-wager]").textContent = entry ? wagerFromCents(entry.wagerUsdCents) : "—";
    card.querySelector("[data-racer-prize]").textContent = prizeForPosition(campaign, position);
    card.classList.toggle("occupied", Boolean(entry));
    if (entry?.playerRank?.badgePath) {
      loadBadge(image, entry.playerRank.badgePath, entry.playerRank.label || "Player rank");
    } else {
      loadBadge(image, "");
    }
  }

  function makeRow(entry, campaign) {
    const row = document.createElement("div");
    row.className = `race-grid-row${entry.position <= 3 ? ` top-${entry.position}` : ""}`;
    row.setAttribute("role", "row");

    const position = document.createElement("span");
    position.className = "race-position";
    position.textContent = String(entry.position);

    const racer = document.createElement("span");
    racer.className = "race-player";
    const badge = document.createElement(entry.profileVisible ? "button" : "span");
    badge.className = "race-player-badge";
    if (entry.profileVisible) {
      badge.type = "button";
      badge.dataset.playerProfile = entry.username;
      badge.setAttribute("aria-label", `View ${entry.username}'s profile`);
    }
    if (entry.playerRank?.badgePath) {
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      badge.append(image);
      loadBadge(image, entry.playerRank.badgePath, entry.playerRank.label || "Player rank");
    }
    const username = document.createElement(entry.profileVisible ? "button" : "strong");
    if (entry.profileVisible) {
      username.type = "button";
      username.className = "race-player-profile-name";
      username.dataset.playerProfile = entry.username;
    }
    username.textContent = entry.username || "Hidden Racer";
    racer.append(badge, username);

    const wager = document.createElement("strong");
    wager.className = "race-wager-value";
    wager.textContent = entry.empty ? "—" : wagerFromCents(entry.wagerUsdCents);
    const rowPrize = document.createElement("strong");
    rowPrize.className = "race-prize-value";
    rowPrize.textContent = prizeForPosition(campaign, entry.position);
    row.append(position, racer, wager, rowPrize);
    return row;
  }

  function makeEmptyRow(positionValue, campaign) {
    return makeRow({ position: positionValue, username: "Open place", wagerUsdCents: 0, playerRank: null, empty: true }, campaign);
  }

  function renderCurrentPlayer(campaign, standings, places) {
    const player = campaign?.currentPlayer;
    if (!currentPlayerRow || !player) {
      if (currentPlayerRow) currentPlayerRow.hidden = true;
      return;
    }
    currentPlayerRow.hidden = false;
    currentPlayerRow.querySelector("[data-current-player-position]").textContent = player.position ? String(player.position) : "—";
    currentPlayerRow.querySelector("[data-current-player-name]").textContent = player.username || "You";
    currentPlayerRow.querySelector("[data-current-player-name]").dataset.playerProfile = player.username || "";
    currentPlayerRow.querySelector("[data-current-player-profile]").dataset.playerProfile = player.username || "";
    currentPlayerRow.querySelector("[data-current-player-wager]").textContent = wagerFromCents(player.wagerUsdCents);
    loadBadge(currentPlayerRow.querySelector("[data-current-player-badge]"), player.playerRank?.badgePath, player.playerRank?.label);
    const cutoff = standings[places - 1];
    const playerOnGrid = Number(player.position || 0) > 0 && Number(player.position) <= places;
    const needed = cutoff ? Math.max(0, Number(cutoff.wagerUsdCents || 0) - Number(player.wagerUsdCents || 0) + 1) : 0;
    currentPlayerRow.querySelector("[data-current-player-needed]").textContent = playerOnGrid ? "On the grid" : needed > 0 ? `${moneyFromCents(needed)} to qualify` : "Open place";
  }

  function render() {
    const campaign = campaigns.get(activeCadence);
    const standings = Array.isArray(campaign?.standings) ? campaign.standings : [];
    const places = Math.max(1, Math.min(50, Number(campaign?.prizePlaces || 10)));
    prize.textContent = moneyFromCents(campaign?.prizeUsdCents);
    countdown.textContent = countdownText(campaign);
    const cadenceNames = { daily: "Daily", weekly: "Weekly", biweekly: "BiWeekly", monthly: "Monthly" };
    cadenceLabel.textContent = activeCadence ? `${cadenceNames[activeCadence] || "Leaderboard"} race` : "No race configured";
    tabs.forEach((tab) => {
      const active = tab.dataset.leaderboardTab === activeCadence;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    [1, 2, 3].forEach((position) => podiumEntry(position, standings[position - 1], campaign));
    rowsRoot.replaceChildren(...Array.from({ length: places }, (_, index) => standings[index] ? makeRow(standings[index], campaign) : makeEmptyRow(index + 1, campaign)));
    renderCurrentPlayer(campaign, standings, places);
    document.querySelector(".race-podium")?.classList.remove("race-podium-refreshed");
    requestAnimationFrame(() => document.querySelector(".race-podium")?.classList.add("race-podium-refreshed"));
  }

  async function refresh() {
    try {
      const token = await window.GamRaceAuth?.getToken?.();
      const response = await fetch(`${API_BASE}/leaderboards`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Leaderboard data is temporarily unavailable");
      const body = await response.json();
      campaigns.clear();
      (body.leaderboards || []).forEach((campaign) => campaigns.set(campaign.cadence, campaign));
      syncAvailableTabs();
      status.textContent = "";
      render();
    } catch (error) {
      status.textContent = error.message || "Leaderboard data is temporarily unavailable";
      render();
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => {
    activeCadence = tab.dataset.leaderboardTab || null;
    render();
  }));
  window.addEventListener("gamrace:auth-state", () => {
    refresh();
  });
  refresh();
  window.setInterval(() => {
    if (activeCadence) countdown.textContent = countdownText(campaigns.get(activeCadence));
  }, 1000);
  window.setInterval(refresh, 15000);
})();
