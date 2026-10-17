(() => {
  "use strict";

  const SETTINGS_KEY = "gamrace-game-settings-v1";
  const FAVORITES_KEY = "gamrace-favourites-v1";
  const SESSION_STATS_KEY = "gamrace-session-stats-v2";
  const GAME_LABELS = {
    all: "All games", mines: "Mines", dice: "Dice", plinko: "Plinko", roulette: "Roulette",
    keno: "Keno", wheel: "Wheel", "hi-lo": "Hi-Lo", coinflip: "Coinflip", crash: "Crash",
    blackjack: "Blackjack", towers: "Towers", moles: "Moles", limbo: "Limbo", stack: "Stack",
  };
  const currentGame = String(new URLSearchParams(location.search).get("game") || "mines").toLowerCase();
  const roots = [...document.querySelectorAll("[data-shared-game-tools]")];

  function renderMaintenanceNotice(enabled) {
    const rail = document.querySelector(".game-rail");
    if (!rail) return;
    let notice = rail.querySelector("[data-game-maintenance-notice]");
    if (!enabled) {
      notice?.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement("aside");
      notice.className = "game-maintenance-notice";
      notice.dataset.gameMaintenanceNotice = "";
      notice.setAttribute("role", "status");
      rail.prepend(notice);
    }
    notice.innerHTML = `<strong>${GAME_LABELS[currentGame] || "This game"} is under maintenance</strong><span>New bets are paused. Any round already in progress can still be completed or cashed out.</span>`;
  }

  function readObject(key, storage = localStorage) {
    try {
      const value = JSON.parse(storage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function readFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function emptyStats() { return { profit: 0, wagered: 0, wins: 0, losses: 0 }; }
  const sessionStats = readObject(SESSION_STATS_KEY, sessionStorage);
  Object.keys(GAME_LABELS).filter((game) => game !== "all").forEach((game) => {
    sessionStats[game] = { ...emptyStats(), ...(sessionStats[game] || {}) };
  });

  function saveStats() {
    try { sessionStorage.setItem(SESSION_STATS_KEY, JSON.stringify(sessionStats)); } catch { /* Session tracking is an enhancement. */ }
  }

  function settingKey(game, name) {
    return `${game}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }

  function closePanels(root) {
    root.querySelectorAll("[data-shared-game-tool-panel]").forEach((panel) => { panel.hidden = true; });
    root.querySelectorAll("[data-shared-game-tool]").forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-expanded", "false");
    });
  }

  function renderFavorite(root) {
    const game = root.dataset.sharedGameTools;
    const button = root.querySelector("[data-shared-game-favorite]");
    if (!button) return;
    const active = readFavorites().has(game);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${GAME_LABELS[game] || game} ${active ? "from" : "to"} favourites`);
  }

  function statsFor(filter) {
    if (filter !== "all") return sessionStats[filter] || emptyStats();
    return Object.keys(GAME_LABELS).filter((game) => game !== "all").reduce((total, game) => {
      const item = sessionStats[game] || emptyStats();
      total.profit += Number(item.profit) || 0;
      total.wagered += Number(item.wagered) || 0;
      total.wins += Number(item.wins) || 0;
      total.losses += Number(item.losses) || 0;
      return total;
    }, emptyStats());
  }

  function panelGame(panel) {
    const sectionId = panel.closest('section[id$="-game"]')?.id?.replace(/-game$/, "") || "";
    return sectionId === "hilo" ? "hi-lo" : sectionId;
  }

  function statField(panel, name) {
    return panel.querySelector(`[data-shared-stat="${name}"], [data-dice-stat="${name}"], [data-stat="${name}"], [data-keno-stat="${name}"], [data-wheel-stat="${name}"], [data-hilo-stat="${name}"], [data-coinflip-stat="${name}"]`);
  }

  function renderStatsPanel(panel) {
    const filter = panel.querySelector("[data-session-stats-filter]")?.value || panelGame(panel);
    const stats = statsFor(filter);
    Object.entries(stats).forEach(([name, value]) => {
      const field = statField(panel, name);
      if (!field) return;
      field.textContent = name === "wins" || name === "losses"
        ? String(Math.round(Number(value) || 0))
        : Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
      if (name === "profit") {
        field.classList.toggle("positive", value > 0);
        field.classList.toggle("negative", value < 0);
      }
    });
    const chart = panel.querySelector(".game-stats-chart");
    if (chart) chart.hidden = filter !== panelGame(panel);
  }

  function renderStats(root) {
    const panel = root.querySelector('[data-shared-game-tool-panel="stats"]');
    if (panel) renderStatsPanel(panel);
  }

  function installStatsPanel(panel) {
    if (panel.dataset.statsEnhanced === "true") return;
    panel.dataset.statsEnhanced = "true";
    const game = panelGame(panel);
    const controls = document.createElement("label");
    controls.className = "game-stats-controls";
    controls.innerHTML = '<span>Track</span><select data-session-stats-filter aria-label="Game to track in statistics"></select>';
    const select = controls.querySelector("select");
    Object.entries(GAME_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === game;
      select.append(option);
    });
    panel.querySelector("header")?.insertAdjacentElement("afterend", controls);
    select.addEventListener("change", () => renderStatsPanel(panel));

    const header = panel.querySelector("header");
    if (header) {
      header.classList.add("game-stats-drag-handle");
      header.title = "Drag statistics panel · double-click to reset";
      let drag = null;
      header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button, select, input")) return;
        const rect = panel.getBoundingClientRect();
        drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        panel.dataset.dragged = "true";
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        header.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      header.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const rect = panel.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - drag.offsetX));
        const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - drag.offsetY));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      });
      const stopDrag = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
        drag = null;
      };
      header.addEventListener("pointerup", stopDrag);
      header.addEventListener("pointercancel", stopDrag);
      header.addEventListener("dblclick", () => {
        delete panel.dataset.dragged;
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
        panel.style.removeProperty("right");
        panel.style.removeProperty("bottom");
      });
    }
    renderStatsPanel(panel);
  }

  roots.forEach((root) => {
    const game = root.dataset.sharedGameTools;
    root.querySelectorAll("[data-shared-game-tool]").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.sharedGameTool;
      const panel = root.querySelector(`[data-shared-game-tool-panel="${name}"]`);
      const shouldOpen = Boolean(panel?.hidden);
      closePanels(root);
      if (panel && shouldOpen) {
        panel.hidden = false;
        button.classList.add("active");
        button.setAttribute("aria-expanded", "true");
      }
    }));
    root.querySelectorAll("[data-close-shared-tool]").forEach((button) => button.addEventListener("click", () => closePanels(root)));
    root.querySelectorAll("[data-shared-game-setting]").forEach((button) => {
      const name = button.dataset.sharedGameSetting;
      const key = settingKey(game, name);
      button.setAttribute("aria-checked", String(Boolean(readObject(SETTINGS_KEY)[key])));
      button.addEventListener("click", () => {
        const settings = readObject(SETTINGS_KEY);
        const enabled = !Boolean(settings[key]);
        settings[key] = enabled;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        button.setAttribute("aria-checked", String(enabled));
        window.dispatchEvent(new CustomEvent("gamrace:game-setting-changed", { detail: { game, name, value: enabled } }));
      });
    });
    const favorite = root.querySelector("[data-shared-game-favorite]");
    favorite?.addEventListener("click", () => {
      const favorites = readFavorites();
      if (favorites.has(game)) favorites.delete(game); else favorites.add(game);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
      renderFavorite(root);
    });
    renderFavorite(root);
    renderStats(root);
  });

  const statsPanels = [...document.querySelectorAll(".stats-panel")];
  statsPanels.forEach(installStatsPanel);

  window.addEventListener("gamrace:session-result", (event) => {
    const game = String(event.detail?.game || "");
    if (!sessionStats[game]) sessionStats[game] = emptyStats();
    const wager = Math.max(0, Number(event.detail?.wager) || 0);
    const payout = Math.max(0, Number(event.detail?.payout) || 0);
    const stats = sessionStats[game];
    stats.wagered += wager;
    stats.profit += payout - wager;
    if (payout > wager) stats.wins += 1; else stats.losses += 1;
    saveStats();
    statsPanels.forEach(renderStatsPanel);
  });

  window.addEventListener("load", () => statsPanels.forEach(renderStatsPanel));
  window.addEventListener("gamrace:wallet-balance-changed", () => window.setTimeout(() => statsPanels.forEach(renderStatsPanel), 0));

  async function refreshRtp() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      renderMaintenanceNotice(Boolean(payload?.games?.[currentGame]?.maintenanceMode));
      document.querySelectorAll("[data-game-rtp]").forEach((node) => {
        const value = Number(payload?.games?.[node.dataset.gameRtp]?.rtpPercent);
        if (!Number.isFinite(value)) return;
        const precision = Number.isInteger(value) ? 0 : 2;
        node.textContent = `${value.toFixed(precision)}%${node.dataset.gameRtp === "coinflip" ? " per flip" : ""}`;
      });
    } catch { /* Static safe defaults remain visible while reconnecting. */ }
  }

  refreshRtp();
  window.setInterval(refreshRtp, 15_000);
  window.addEventListener("focus", refreshRtp);
})();
