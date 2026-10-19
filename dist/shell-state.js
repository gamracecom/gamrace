(function () {
  "use strict";

  const STORAGE_KEY = "gamrace-shell-state-v1";
  const WALLET_SELECTION_KEY = "gamrace-wallet-selection-v1";
  const DEFAULT_RANK_BADGE = "ranks/rookie-i.webp";
  const PRELOAD_ASSETS = [
    "assets/brand/gamrace-icon.png",
    DEFAULT_RANK_BADGE,
    "assets/icons/crypto/usdt.svg",
    "assets/icons/crypto/usdc.svg",
    "assets/icons/crypto/btc.svg",
    "assets/icons/crypto/eth.svg",
    "assets/icons/crypto/sol.svg",
    "assets/icons/crypto/ltc.svg",
    "assets/icons/crypto/trx.svg",
    "assets/icons/crypto/xrp.svg",
    "assets/icons/crypto/doge.svg",
    "assets/icons/crypto/bnb.svg",
  ];

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function write(update) {
    const next = { ...(read() || {}), ...update, updatedAt: Date.now() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Private browsing can disable storage. */ }
    apply(next);
    return next;
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Private browsing can disable storage. */ }
    try { sessionStorage.removeItem(WALLET_SELECTION_KEY); } catch { /* Private browsing can disable storage. */ }
    delete window.gamraceWalletSelection;
    document.documentElement.dataset.sessionState = "signed-out";
    document.querySelectorAll(".profile-label").forEach((label) => { label.textContent = "Account"; });
    document.querySelectorAll(".profile-rank-mark").forEach((mark) => {
      mark.classList.remove("has-image", "rank-loading");
      const image = mark.querySelector(".profile-rank-image");
      if (image) { image.removeAttribute("src"); image.classList.remove("custom", "fallback"); }
      mark.style.removeProperty("--avatar-color");
    });
  }

  function readWalletSelection() {
    try {
      const value = JSON.parse(sessionStorage.getItem(WALLET_SELECTION_KEY) || "null");
      if (!value || typeof value !== "object" || !value.currency || !value.asset || !value.balance) return null;
      return value;
    } catch {
      return null;
    }
  }

  function cacheWalletSelection(selection) {
    if (!selection || typeof selection !== "object") return;
    const safeSelection = {
      currency: String(selection.currency || ""),
      asset: { ...(selection.asset || {}) },
      balance: { ...(selection.balance || {}) },
      displayFiat: selection.displayFiat !== false,
      cachedAt: Date.now(),
    };
    if (!safeSelection.currency) return;
    window.gamraceWalletSelection = safeSelection;
    try { sessionStorage.setItem(WALLET_SELECTION_KEY, JSON.stringify(safeSelection)); } catch { /* Storage can be unavailable. */ }
  }

  function apply(snapshot = read()) {
    if (!snapshot?.signedIn) {
      document.querySelectorAll(".profile-rank-mark").forEach((mark) => mark.classList.remove("has-image", "rank-loading"));
      return;
    }
    document.documentElement.dataset.sessionState = "signed-in";
    document.querySelectorAll(".profile-label").forEach((label) => { label.textContent = snapshot.username || "Account"; });
    document.querySelectorAll(".balance-value").forEach((value) => { value.textContent = snapshot.balanceText || "$0.00"; });
    document.querySelectorAll(".balance-coin-icon").forEach((icon) => {
      const iconPath = snapshot.selectedIcon || "assets/icons/crypto/usdt.svg";
      if (icon.getAttribute("src") !== iconPath) icon.src = iconPath;
    });
    document.querySelectorAll(".profile-rank-mark").forEach((mark) => {
      const image = mark.querySelector(".profile-rank-image");
      if (!image) return;
      const avatarPath = snapshot.avatarUrl || "assets/brand/gamrace-icon.png";
      const custom = Boolean(snapshot.avatarUrl);
      mark.style.setProperty("--avatar-color", snapshot.avatarColor || "#168bff");
      image.classList.toggle("custom", custom);
      image.classList.toggle("fallback", !custom);
      if (image.getAttribute("src") !== avatarPath) {
        image.addEventListener("load", () => mark.classList.add("has-image"), { once: true });
        image.addEventListener("error", () => {
          image.src = "assets/brand/gamrace-icon.png";
          image.classList.remove("custom");
          image.classList.add("fallback");
        }, { once: true });
        image.src = avatarPath;
      }
      if (image.complete && image.naturalWidth) mark.classList.add("has-image");
    });
  }

  const initial = read();
  const initialWalletSelection = readWalletSelection();
  if (initialWalletSelection) window.gamraceWalletSelection = initialWalletSelection;
  document.documentElement.dataset.sessionState = initial?.signedIn ? "signed-in" : "unknown";
  PRELOAD_ASSETS.forEach((source) => { const image = new Image(); image.src = source; });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(initial), { once: true });
  else apply(initial);
  window.setTimeout(() => {
    if (document.body?.dataset.authenticated !== "pending") return;
    document.body.dataset.authenticated = "false";
    clear();
  }, 8000);

  window.GamRaceShellState = { read, write, clear, apply, readWalletSelection, cacheWalletSelection };
})();
