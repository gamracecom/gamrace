(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (!["mines", "dice", "plinko", "roulette", "keno", "wheel", "hi-lo", "coinflip", "crash", "blackjack", "towers"].includes(gameName)) return;
  const historyClass = gameName === "hi-lo" ? "hilo" : gameName;
  const section = document.querySelector(`.${historyClass}-history`) || (gameName === "mines" ? document.querySelector(".mines-history:not(.dice-history):not(.plinko-history):not(.roulette-history):not(.keno-history):not(.wheel-history):not(.hilo-history)") : null);
  if (!section) return;

  const gameLabel = gameName === "hi-lo" ? "Hi-Lo" : `${gameName.charAt(0).toUpperCase()}${gameName.slice(1)}`;
  const body = section.querySelector("tbody");
  const select = section.querySelector("select");
  const tabSelector = gameName === "mines" ? "[data-history-view]" : `[data-${historyClass}-history-view]`;
  const tabs = [...section.querySelectorAll(tabSelector)];
  let activeView = "top";
  let loading = false;
  let loadedOnce = false;

  function installCard() {
    const content = document.createElement("div");
    content.className = "game-results-content";
    content.hidden = true;
    while (section.firstChild) content.append(section.firstChild);

    const summary = document.createElement("button");
    summary.className = "game-results-summary";
    summary.type = "button";
    summary.setAttribute("aria-expanded", "false");
    summary.innerHTML = `
      <span class="game-results-title"><strong>${gameLabel}</strong><small>GamRace Original</small></span>
      <span class="game-results-leader" aria-live="polite">
        <span class="game-results-trophy" aria-hidden="true">★</span>
        <strong data-history-highlight-multiplier>Top wins</strong>
        <span class="game-results-player"><img data-history-highlight-badge alt="" hidden /><span data-history-highlight-user>Live results</span></span>
      </span>
      <span class="game-results-chevron" aria-hidden="true"></span>`;
    summary.addEventListener("click", () => {
      const open = content.hidden;
      content.hidden = !open;
      section.classList.toggle("is-expanded", open);
      summary.setAttribute("aria-expanded", String(open));
      if (open) refresh();
    });
    section.classList.add("game-results-card");
    section.removeAttribute("hidden");
    section.prepend(summary);
    section.append(content);
    return {
      summary,
      content,
      multiplier: summary.querySelector("[data-history-highlight-multiplier]"),
      username: summary.querySelector("[data-history-highlight-user]"),
      badge: summary.querySelector("[data-history-highlight-badge]"),
    };
  }

  const card = installCard();

  if (select) {
    select.replaceChildren(
      new Option("Lifetime", "lifetime"),
      new Option("Past 30 days", "30d"),
      new Option("Past 90 days", "90d"),
    );
  }

  function periodValue() {
    return ["30d", "90d"].includes(select?.value) ? select.value : "lifetime";
  }

  function formatAmount(value, currency) {
    const amount = Number(value) || 0;
    const symbol = String(currency || "").split("_")[0].toUpperCase();
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${symbol}`;
  }

  function formatMultiplier(value) {
    const multiplier = Number(value) || 0;
    return `${multiplier.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}×`;
  }

  function cell(text, className = "") {
    const element = document.createElement("td");
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function ensureProfileDialog() {
    let overlay = document.querySelector("#public-player-profile");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "public-profile-overlay";
    overlay.id = "public-player-profile";
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="public-profile-card" role="dialog" aria-modal="true" aria-labelledby="public-profile-name">
        <button class="public-profile-close" type="button" aria-label="Close player profile">×</button>
        <img class="public-profile-badge" alt="" />
        <span class="section-kicker">GAMRACE PLAYER</span>
        <h2 id="public-profile-name">Player</h2>
        <p class="public-profile-rank">Rookie I</p>
        <p class="public-profile-copy">This player has shared their public GamRace profile.</p>
      </section>`;
    const close = () => { overlay.hidden = true; };
    overlay.querySelector(".public-profile-close").addEventListener("click", close);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) close(); });
    document.body.append(overlay);
    return overlay;
  }

  function openProfile(entry) {
    if (!entry.profileVisible || entry.usernameHidden) return;
    const overlay = ensureProfileDialog();
    const rank = entry.playerRank || { label: "Rank hidden", badgePath: "" };
    overlay.querySelector("#public-profile-name").textContent = entry.username;
    overlay.querySelector(".public-profile-rank").textContent = rank.label;
    const badge = overlay.querySelector(".public-profile-badge");
    badge.src = rank.badgePath || "";
    badge.hidden = !rank.badgePath;
    overlay.hidden = false;
    overlay.querySelector(".public-profile-close").focus();
  }

  function playerCell(entry) {
    const element = document.createElement("td");
    element.className = "history-user-cell";
    if (entry.playerRank?.badgePath) {
      const badge = document.createElement("img");
      badge.className = "history-rank-badge";
      badge.src = entry.playerRank.badgePath;
      badge.alt = entry.playerRank.label;
      element.append(badge);
    }
    const username = entry.isYou && entry.username === "Player" ? "You" : entry.username;
    if (entry.profileVisible && !entry.usernameHidden) {
      const button = document.createElement("button");
      button.className = "history-user-button";
      button.type = "button";
      button.textContent = username;
      button.addEventListener("click", () => openProfile(entry));
      element.append(button);
    } else {
      const label = document.createElement("span");
      label.textContent = username;
      element.append(label);
    }
    return element;
  }

  function renderSummary(entries) {
    const leader = entries[0];
    card.multiplier.textContent = leader ? formatMultiplier(leader.multiplier) : "No wins yet";
    card.username.textContent = leader ? leader.username : "Live results";
    card.badge.hidden = !leader?.playerRank?.badgePath;
    if (leader?.playerRank?.badgePath) {
      card.badge.src = leader.playerRank.badgePath;
      card.badge.alt = leader.playerRank.label;
    }
  }

  function render(entries) {
    const visibleEntries = entries.slice(0, 3);
    renderSummary(visibleEntries);
    body.replaceChildren();
    body.setAttribute("aria-label", `Live ${gameName} winning results`);
    if (!visibleEntries.length) {
      const row = document.createElement("tr");
      row.className = "history-empty-row";
      const empty = cell("No winning bets in this period yet.");
      empty.colSpan = 6;
      row.append(empty);
      body.append(row);
      return;
    }
    visibleEntries.forEach((entry, index) => {
      const row = document.createElement("tr");
      if (entry.isYou) row.classList.add("is-you");
      row.append(
        cell(`${index + 1}${["st", "nd", "rd"][index]}`, "history-rank-cell"),
        playerCell(entry),
        cell(new Date(entry.createdAt).toLocaleDateString(), "history-date-cell"),
        cell(formatAmount(entry.wager, entry.currency), "history-number-cell"),
        cell(formatMultiplier(entry.multiplier), "history-number-cell"),
        cell(formatAmount(entry.payout, entry.currency), "history-number-cell history-payout-cell"),
      );
      body.append(row);
    });
  }

  function showSkeleton() {
    if (loadedOnce) return;
    body.replaceChildren(...Array.from({ length: 3 }, () => {
      const row = document.createElement("tr");
      row.className = "history-skeleton";
      row.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 6; index += 1) {
        const td = document.createElement("td");
        td.append(document.createElement("i"));
        row.append(td);
      }
      return row;
    }));
  }

  async function refresh({ force = false } = {}) {
    if (loading || document.hidden || !window.gamraceWallet?.request) return;
    if (loadedOnce && card.content.hidden && !force) return;
    loading = true;
    showSkeleton();
    try {
      const query = new URLSearchParams({ game: gameName, view: activeView, period: periodValue() });
      const response = await window.gamraceWallet.request(`/games/history?${query}`);
      render(Array.isArray(response.entries) ? response.entries : []);
      loadedOnce = true;
    } catch {
      if (!loadedOnce) render([]);
    } finally {
      loading = false;
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => {
    activeView = (tab.dataset[`${historyClass}HistoryView`] || tab.dataset.historyView) === "lucky" ? "lucky" : "top";
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    refresh();
  }));
  select?.addEventListener("change", refresh);
  window.addEventListener("gamrace:wallet-balance-changed", () => refresh({ force: true }));
  window.addEventListener("gamrace:game-history-refresh", () => refresh({ force: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !card.content.hidden) refresh(); });
  window.setInterval(refresh, 4000);
  window.setTimeout(() => refresh({ force: true }), 250);
})();
