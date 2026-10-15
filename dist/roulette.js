(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "roulette") return;
  const game = document.querySelector("#roulette-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Roulette | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const track = game.querySelector("#roulette-track");
  const viewport = game.querySelector("#roulette-track-viewport");
  const status = game.querySelector("#roulette-round-status");
  const progress = game.querySelector("#roulette-progress");
  const recent = game.querySelector("#roulette-recent-results");
  const betInput = game.querySelector("#roulette-bet-amount");
  const message = game.querySelector("#roulette-message");
  const optionButtons = [...game.querySelectorAll("[data-roulette-option]")];
  const countFields = Object.fromEntries(["blue", "cyan", "purple", "gold"].map((key) => [key, game.querySelector(`#roulette-${key}-count`)]));

  const OUTCOMES = Object.freeze({
    blue: { label: "Blue", multiplier: 2 },
    cyan: { label: "Cyan", multiplier: 2 },
    purple: { label: "7×", multiplier: 7 },
    gold: { label: "14×", multiplier: 14 },
  });
  const TRACK_PATTERN = Object.freeze([
    "blue", "cyan", "blue", "cyan", "blue", "cyan", "blue",
    "purple", "gold", "purple",
    "cyan", "blue", "cyan", "blue", "cyan", "blue", "cyan",
  ]);
  const BETTING_MS = 12_000;
  const SPIN_MS = 6_500;
  const CENTRE_MS = 1_300;
  const displayedStakes = { blue: 0, cyan: 0, purple: 0, gold: 0 };

  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let activeRound = null;
  let serverOffsetMs = 0;
  let twoXSelection = null;
  let placingBet = false;
  let syncing = false;
  let syncTimer = 0;
  let clockFrame = 0;
  let trackAnimation = null;
  let animatedRoundId = "";
  let walletRefreshRoundId = "";
  let recoveredAssetStakes = false;
  const recordedSessionRounds = new Set();

  function requestId() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  function iconMarkup(outcome) {
    const name = outcome === "blue" ? "blue-2x" : outcome === "cyan" ? "cyan-2x" : outcome === "purple" ? "purple-7x" : "gold-14x";
    return `<img class="roulette-tile-icon" src="assets/icons/roulette/${name}.png" alt="" aria-hidden="true" />`;
  }

  function tile(outcome, compact = false) {
    const element = document.createElement("span");
    element.className = `${compact ? "roulette-recent-tile" : "roulette-track-tile"} ${outcome}`;
    element.innerHTML = iconMarkup(outcome);
    element.title = `${OUTCOMES[outcome].label} · ${OUTCOMES[outcome].multiplier}×`;
    return element;
  }

  function cancelTrackAnimation() {
    if (trackAnimation) trackAnimation.cancel();
    trackAnimation = null;
  }

  function renderIdleTrack() {
    cancelTrackAnimation();
    track.classList.remove("is-spinning", "is-centering");
    track.style.transform = "translateX(-46px)";
    track.replaceChildren(...Array.from({ length: 35 }, (_, index) => tile(TRACK_PATTERN[index % TRACK_PATTERN.length])));
  }

  function trackPositions(outcome, landingBasisPoints) {
    const items = Array.from({ length: 72 }, (_, index) => TRACK_PATTERN[index % TRACK_PATTERN.length]);
    const matching = items.map((item, index) => item === outcome ? index : -1).filter((index) => index >= 42);
    const offset = Math.max(-3200, Math.min(3200, Number(landingBasisPoints) || 0));
    const finalIndex = matching[Math.abs(offset) % Math.min(matching.length, 6)];
    track.replaceChildren(...items.map((item) => tile(item)));
    const firstTile = track.firstElementChild;
    const tileWidth = firstTile.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = tileWidth + gap;
    const centre = viewport.clientWidth / 2 - (finalIndex * step + tileWidth / 2);
    const landed = centre - (offset / 10000) * tileWidth;
    return { start: landed + step * 24, landed, centre };
  }

  function animateSharedRound(round, serverNow) {
    if (!round?.result || animatedRoundId === round.id) return;
    animatedRoundId = round.id;
    cancelTrackAnimation();
    const positions = trackPositions(round.result, round.landingBasisPoints);
    const elapsed = Math.max(0, Number(serverNow) - Number(round.closesAtMs));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || elapsed >= SPIN_MS + CENTRE_MS) {
      track.style.transform = `translateX(${positions.centre}px)`;
      return;
    }
    if (elapsed < SPIN_MS) {
      trackAnimation = track.animate(
        [{ transform: `translateX(${positions.start}px)` }, { transform: `translateX(${positions.landed}px)` }],
        { duration: SPIN_MS, easing: "cubic-bezier(.12, .58, .1, 1)", fill: "forwards" },
      );
      trackAnimation.currentTime = elapsed;
      trackAnimation.onfinish = () => {
        track.style.transform = `translateX(${positions.landed}px)`;
        trackAnimation = track.animate(
          [{ transform: `translateX(${positions.landed}px)` }, { transform: `translateX(${positions.centre}px)` }],
          { duration: CENTRE_MS, easing: "cubic-bezier(.2, .72, .24, 1)", fill: "forwards" },
        );
        trackAnimation.onfinish = () => {
          track.style.transform = `translateX(${positions.centre}px)`;
          trackAnimation = null;
        };
      };
      return;
    }
    track.style.transform = `translateX(${positions.landed}px)`;
    trackAnimation = track.animate(
      [{ transform: `translateX(${positions.landed}px)` }, { transform: `translateX(${positions.centre}px)` }],
      { duration: CENTRE_MS, easing: "cubic-bezier(.2, .72, .24, 1)", fill: "forwards" },
    );
    trackAnimation.currentTime = elapsed - SPIN_MS;
    trackAnimation.onfinish = () => {
      track.style.transform = `translateX(${positions.centre}px)`;
      trackAnimation = null;
    };
  }

  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function formatStake(value) {
    if (recoveredAssetStakes && displayFiat) return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
    return formatAmount(value);
  }

  function setMessage(text = "") {
    message.textContent = text;
    message.hidden = !text;
  }

  function hasStakes() {
    return Object.values(displayedStakes).some((value) => value > 0);
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const bettingOpen = activeRound?.phase === "betting" && Date.now() + serverOffsetMs < Number(activeRound.closesAtMs) - 250;
    optionButtons.forEach((button) => {
      const outcome = button.dataset.rouletteOption;
      const oppositeTwoX = (outcome === "blue" || outcome === "cyan") && twoXSelection && twoXSelection !== outcome;
      button.disabled = placingBet || !bettingOpen || !selectedCurrency || oppositeTwoX || amount < minimumWager() || amount > availableBalance;
      button.closest(".roulette-option")?.classList.toggle("is-locked", Boolean(oppositeTwoX));
    });
    Object.entries(displayedStakes).forEach(([key, value]) => {
      const field = game.querySelector(`[data-roulette-stake="${key}"]`);
      if (field) field.textContent = formatStake(value);
    });
    if (amount > availableBalance && amount > 0) setMessage("Your available balance is too low for that bet.");
  }

  function renderRecent(payload) {
    const results = Array.isArray(payload?.results) ? payload.results.filter((item) => OUTCOMES[item]) : [];
    const counts = payload?.counts || {};
    Object.keys(countFields).forEach((key) => { countFields[key].textContent = String(Number(counts[key]) || 0); });
    recent.replaceChildren(...results.slice(0, 10).map((outcome) => tile(outcome, true)));
  }

  function applyRound(round, serverNow) {
    const previousRound = activeRound;
    const isNewRound = activeRound?.id !== round?.id;
    activeRound = round;
    if (!round) return;
    twoXSelection = round.twoXSelection || null;
    Object.keys(displayedStakes).forEach((key) => { displayedStakes[key] = Number(round.bets?.[key] || 0); });
    recoveredAssetStakes = displayFiat && hasStakes();
    if (isNewRound) {
      animatedRoundId = "";
      walletRefreshRoundId = "";
      if (!previousRound) renderIdleTrack();
    }
    if (round.phase === "spinning") {
      animateSharedRound(round, serverNow);
      if (!recordedSessionRounds.has(round.id) && hasStakes() && OUTCOMES[round.result]) {
        recordedSessionRounds.add(round.id);
        const wager = Object.values(displayedStakes).reduce((total, value) => total + Number(value || 0), 0);
        const payout = Number(displayedStakes[round.result] || 0) * OUTCOMES[round.result].multiplier;
        window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "roulette", wager, payout } }));
      }
      if (walletRefreshRoundId !== round.id) {
        walletRefreshRoundId = round.id;
        window.gamraceWallet?.request("/wallet").then((response) => window.gamraceWallet.applyGameResult(response)).catch(() => {});
        window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      }
    }
    updateAvailability();
  }

  async function syncRound() {
    if (syncing || !selectedCurrency || !window.gamraceWallet?.request || document.hidden) return;
    syncing = true;
    try {
      const response = await window.gamraceWallet.request(`/games/roulette/live?currency=${encodeURIComponent(selectedCurrency)}`);
      serverOffsetMs = Number(response.serverNow || Date.now()) - Date.now();
      renderRecent(response.recent);
      applyRound(response.round, Number(response.serverNow || Date.now()));
    } catch (error) {
      if (!activeRound) setMessage(error.message || "Live Roulette is reconnecting…");
    } finally {
      syncing = false;
    }
  }

  function clockTick() {
    const serverNow = Date.now() + serverOffsetMs;
    if (!activeRound) {
      status.textContent = selectedCurrency ? "Connecting to live round…" : "Sign in to join live Roulette";
      progress.style.width = "0";
    } else if (serverNow < Number(activeRound.closesAtMs)) {
      const remaining = Math.max(0, Number(activeRound.closesAtMs) - serverNow);
      status.innerHTML = `Rolling in <strong>${(remaining / 1000).toFixed(2)}</strong>`;
      progress.style.width = `${Math.max(0, Math.min(100, (remaining / BETTING_MS) * 100))}%`;
    } else {
      status.textContent = "Rolling…";
      progress.style.width = "0";
      if (activeRound.phase !== "spinning") syncRound();
      if (serverNow >= Number(activeRound.endsAtMs)) syncRound();
    }
    updateAvailability();
    clockFrame = requestAnimationFrame(clockTick);
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    betInput.min = minimumWager().toFixed(displayFiat ? 2 : 8);
    betInput.step = betInput.min;
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-roulette-currency]"), detail);
    if (changed) activeRound = null;
    updateAvailability();
    syncRound();
  }

  function adjustBet(action) {
    const amount = cleanAmount();
    let next = action === "half" ? amount / 2 : action === "double" ? amount * 2 : availableBalance;
    next = Math.min(availableBalance, next);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function placeWager(outcome) {
    const amount = cleanAmount();
    if (placingBet || activeRound?.phase !== "betting" || !OUTCOMES[outcome] || amount < minimumWager() || amount > availableBalance) return;
    if ((outcome === "blue" || outcome === "cyan") && twoXSelection && twoXSelection !== outcome) return;
    placingBet = true;
    setMessage();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/roulette/wagers", {
        method: "POST",
        body: JSON.stringify({
          requestId: requestId(), currency: selectedCurrency, selection: outcome,
          wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat,
        }),
      });
      serverOffsetMs = Number(response.serverNow || Date.now()) - Date.now();
      window.gamraceWallet.applyGameResult(response);
      applyRound(response.round, Number(response.serverNow || Date.now()));
    } catch (error) {
      setMessage(error.message || "That Roulette bet could not be placed.");
      syncRound();
    } finally {
      placingBet = false;
      updateAvailability();
    }
  }

  optionButtons.forEach((button) => button.addEventListener("click", () => placeWager(button.dataset.rouletteOption)));
  game.querySelectorAll("[data-roulette-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.rouletteBetAction)));
  betInput.addEventListener("input", updateAvailability);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncRound(); });
  window.addEventListener("beforeunload", () => { window.clearInterval(syncTimer); cancelAnimationFrame(clockFrame); cancelTrackAnimation(); });

  renderIdleTrack();
  updateAvailability();
  syncTimer = window.setInterval(syncRound, 750);
  clockFrame = requestAnimationFrame(clockTick);
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
