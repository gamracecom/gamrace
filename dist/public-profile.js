(() => {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  const FLAG_ICON = "assets/brand/gamrace-icon.png";
  let activeProfile = null;

  const overlay = document.createElement("div");
  overlay.className = "player-profile-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="player-profile-panel" role="dialog" aria-modal="true" aria-labelledby="player-profile-name" tabindex="-1">
      <button class="player-profile-close" type="button" aria-label="Close player profile">×</button>
      <div class="player-profile-identity">
        <span class="player-profile-avatar" aria-hidden="true"><img alt="" /></span>
        <span class="player-profile-rank-badge" aria-hidden="true"><img alt="" /></span>
        <div><span class="player-profile-kicker">GAMRACE PLAYER</span><h2 id="player-profile-name">Player</h2><p data-player-rank>Profile</p></div>
      </div>
      <div class="player-profile-stats" data-player-stats></div>
      <p class="player-profile-favourite" data-player-favourite hidden></p>
      <p class="player-profile-status" data-player-profile-status role="status" aria-live="polite"></p>
      <div class="player-profile-actions">
        <button class="player-profile-tip" type="button" data-player-tip>Tip user</button>
        <button class="player-profile-copy" type="button" data-player-copy>Copy username</button>
      </div>
    </section>`;
  document.body.append(overlay);

  const panel = overlay.querySelector(".player-profile-panel");
  const avatar = overlay.querySelector(".player-profile-avatar");
  const avatarImage = avatar.querySelector("img");
  const rankBadge = overlay.querySelector(".player-profile-rank-badge");
  const rankImage = rankBadge.querySelector("img");
  const name = overlay.querySelector("#player-profile-name");
  const rank = overlay.querySelector("[data-player-rank]");
  const statsRoot = overlay.querySelector("[data-player-stats]");
  const favourite = overlay.querySelector("[data-player-favourite]");
  const status = overlay.querySelector("[data-player-profile-status]");
  const tip = overlay.querySelector("[data-player-tip]");
  const copy = overlay.querySelector("[data-player-copy]");

  function close() {
    overlay.hidden = true;
    activeProfile = null;
    document.body.classList.remove("modal-open");
  }

  function number(value, maximumFractionDigits = 0) {
    return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits });
  }

  function money(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: amount ? "always" : "auto", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }

  function stat(label, value, hidden = false) {
    const item = document.createElement("span");
    const title = document.createElement("small");
    const result = document.createElement("strong");
    title.textContent = label;
    result.textContent = hidden ? "Private" : value;
    if (hidden) item.classList.add("private");
    item.append(title, result);
    return item;
  }

  function setAvatar(profile) {
    avatar.style.setProperty("--player-avatar-color", profile.avatar?.color || "#168bff");
    avatarImage.src = profile.avatar?.url || FLAG_ICON;
    avatarImage.className = profile.avatar?.url ? "custom" : "fallback";
    avatarImage.onerror = () => { avatarImage.src = FLAG_ICON; avatarImage.className = "fallback"; };
  }

  function render(profile) {
    activeProfile = profile;
    name.textContent = profile.username;
    rank.textContent = profile.rank?.label || "Rank private";
    setAvatar(profile);
    if (profile.rank?.badgePath) {
      rankImage.src = profile.rank.badgePath;
      rankImage.alt = profile.rank.label;
      rankBadge.hidden = false;
    } else {
      rankBadge.hidden = true;
      rankImage.removeAttribute("src");
    }
    const values = profile.stats || {};
    statsRoot.replaceChildren(
      stat("Bets placed", number(values.totalBets)),
      stat("Win rate", `${number(values.winRate, 2)}%`),
      stat("Profit / loss", values.netProfitLoss == null ? "" : money(values.netProfitLoss), values.netProfitLoss == null),
      stat("Highest multiplier", `${number(values.highestMultiplier, 2)}×`),
      stat("Total wagered", values.totalWagered == null ? "" : money(values.totalWagered).replace(/^\+/, ""), values.totalWagered == null),
    );
    favourite.hidden = values.favouriteGame == null;
    favourite.textContent = values.favouriteGame == null ? "" : `Favourite game · ${values.favouriteGame}`;
    tip.hidden = !profile.canTip;
    copy.hidden = false;
    status.textContent = "";
    panel.removeAttribute("aria-busy");
  }

  async function requestProfile(username) {
    let token = null;
    try { token = await window.GamRaceAuth?.getToken?.(); } catch { token = null; }
    const response = await fetch(`${API_BASE}/players/${encodeURIComponent(username)}/profile`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "This player profile is not available");
    return body.profile;
  }

  async function open(usernameValue) {
    const username = String(usernameValue || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) return;
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    panel.setAttribute("aria-busy", "true");
    name.textContent = username;
    rank.textContent = "Loading profile…";
    statsRoot.replaceChildren();
    favourite.hidden = true;
    tip.hidden = true;
    copy.hidden = true;
    status.textContent = "";
    panel.focus({ preventScroll: true });
    try { render(await requestProfile(username)); }
    catch (error) {
      activeProfile = null;
      rank.textContent = "Profile unavailable";
      status.textContent = error.message;
      panel.removeAttribute("aria-busy");
    }
  }

  overlay.querySelector(".player-profile-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) close(); });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-player-profile]");
    if (!trigger) return;
    event.preventDefault();
    open(trigger.dataset.playerProfile);
  });
  tip.addEventListener("click", () => {
    const username = activeProfile?.username;
    if (!username) return;
    close();
    window.gamraceWallet?.openTip?.(username);
  });
  copy.addEventListener("click", async () => {
    if (!activeProfile?.username) return;
    try {
      await navigator.clipboard.writeText(activeProfile.username);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy username"; }, 1200);
    } catch { status.textContent = "Username could not be copied."; }
  });

  window.GamRacePlayerProfile = { open, close };
})();
