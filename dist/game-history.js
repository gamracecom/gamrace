(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (!["mines", "dice", "plinko", "roulette", "keno"].includes(gameName)) return;
  const section = document.querySelector(`.${gameName}-history`) || (gameName === "mines" ? document.querySelector(".mines-history:not(.dice-history):not(.plinko-history):not(.roulette-history):not(.keno-history)") : null);
  if (!section) return;
  const body = section.querySelector("tbody");
  const select = section.querySelector("select");
  const tabSelector = gameName === "mines" ? "[data-history-view]" : `[data-${gameName}-history-view]`;
  const tabs = [...section.querySelectorAll(tabSelector)];
  let activeView = "top";
  let loading = false;
  let loadedOnce = false;

  function periodValue() {
    const label = String(select?.value || "lifetime").toLowerCase();
    if (label.includes("today")) return "today";
    if (label.includes("week")) return "week";
    return "lifetime";
  }

  function formatAmount(value, currency) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${String(currency || "").toUpperCase()}`;
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

  function render(entries) {
    body.replaceChildren();
    body.setAttribute("aria-label", `Live ${gameName} results`);
    if (!entries.length) {
      const row = document.createElement("tr");
      row.className = "history-empty-row";
      const empty = cell("No completed bets in this period yet.");
      empty.colSpan = 6;
      row.append(empty);
      body.append(row);
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement("tr");
      if (entry.isYou) row.classList.add("is-you");
      const username = entry.isYou && entry.username === "Player" ? "You" : entry.username;
      row.append(
        cell(`#${index + 1}`, "history-rank-cell"),
        cell(username),
        cell(new Date(entry.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })),
        cell(formatAmount(entry.wager, entry.currency), "history-number-cell"),
        cell(formatMultiplier(entry.multiplier), "history-number-cell"),
        cell(formatAmount(entry.payout, entry.currency), "history-number-cell history-payout-cell"),
      );
      body.append(row);
    });
  }

  function showSkeleton() {
    if (loadedOnce) return;
    body.replaceChildren(...Array.from({ length: 5 }, () => {
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

  async function refresh() {
    if (loading || document.hidden || !window.gamraceWallet?.request) return;
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
    activeView = (tab.dataset[`${gameName}HistoryView`] || tab.dataset.historyView) === "lucky" ? "lucky" : "top";
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    refresh();
  }));
  select?.addEventListener("change", refresh);
  window.addEventListener("gamrace:wallet-balance-changed", refresh);
  window.addEventListener("gamrace:game-history-refresh", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.setInterval(refresh, 4000);
  window.setTimeout(refresh, 250);
})();
