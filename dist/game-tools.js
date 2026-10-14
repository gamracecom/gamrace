(() => {
  "use strict";

  const SETTINGS_KEY = "gamrace-game-settings-v1";
  const FAVORITES_KEY = "gamrace-favourites-v1";
  const roots = [...document.querySelectorAll("[data-shared-game-tools]")];
  const sessionStats = new Map();

  function readObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function readFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
    catch { return new Set(); }
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
    button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${game.charAt(0).toUpperCase() + game.slice(1)} ${active ? "from" : "to"} favourites`);
  }

  function renderStats(root) {
    const game = root.dataset.sharedGameTools;
    const stats = sessionStats.get(game) || { profit: 0, wagered: 0, wins: 0, losses: 0 };
    Object.entries(stats).forEach(([name, value]) => {
      const field = root.querySelector(`[data-shared-stat="${name}"]`);
      if (field) field.textContent = name === "wins" || name === "losses" ? String(value) : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    });
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
    sessionStats.set(game, { profit: 0, wagered: 0, wins: 0, losses: 0 });
    renderFavorite(root);
    renderStats(root);
  });

  window.addEventListener("gamrace:session-result", (event) => {
    const game = String(event.detail?.game || "");
    const root = roots.find((item) => item.dataset.sharedGameTools === game);
    if (!root) return;
    const wager = Math.max(0, Number(event.detail?.wager) || 0);
    const payout = Math.max(0, Number(event.detail?.payout) || 0);
    const stats = sessionStats.get(game);
    stats.wagered += wager;
    stats.profit += payout - wager;
    if (payout > wager) stats.wins += 1; else stats.losses += 1;
    renderStats(root);
  });

  async function refreshRtp() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
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
