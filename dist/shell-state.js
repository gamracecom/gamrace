(function () {
  "use strict";

  const STORAGE_KEY = "gamrace-shell-state-v1";
  const DEFAULT_RANK_BADGE = "ranks/rookie-i.png";
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
    document.documentElement.dataset.sessionState = "signed-out";
  }

  function apply(snapshot = read()) {
    if (!snapshot?.signedIn) return;
    document.documentElement.dataset.sessionState = "signed-in";
    document.querySelectorAll(".profile-label").forEach((label) => { label.textContent = snapshot.username || "Account"; });
    document.querySelectorAll(".balance-value").forEach((value) => { value.textContent = snapshot.balanceText || "$0.00"; });
    document.querySelectorAll(".balance-coin-icon").forEach((icon) => {
      const iconPath = snapshot.selectedIcon || "assets/icons/crypto/usdt.svg";
      if (icon.getAttribute("src") !== iconPath) icon.src = iconPath;
    });
    document.querySelectorAll(".profile-rank-mark").forEach((mark) => {
      const fallback = mark.querySelector(".profile-rank-fallback");
      const image = mark.querySelector(".profile-rank-image");
      if (fallback) fallback.textContent = snapshot.rankFallback || "R";
      if (!image) return;
      const badgePath = snapshot.rankBadgePath || DEFAULT_RANK_BADGE;
      if (image.getAttribute("src") !== badgePath) {
        image.addEventListener("load", () => mark.classList.add("has-image"), { once: true });
        image.addEventListener("error", () => mark.classList.remove("has-image"), { once: true });
        image.src = badgePath;
      }
      if (image.complete && image.naturalWidth) mark.classList.add("has-image");
    });
  }

  const initial = read();
  document.documentElement.dataset.sessionState = initial?.signedIn ? "signed-in" : "unknown";
  PRELOAD_ASSETS.forEach((source) => { const image = new Image(); image.src = source; });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(initial), { once: true });
  else apply(initial);

  window.GamRaceShellState = { read, write, clear, apply };
})();
