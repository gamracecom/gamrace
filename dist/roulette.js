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
  const ROUND_LENGTH_MS = 12000;
  const displayedStakes = { blue: 0, cyan: 0, purple: 0, gold: 0 };

  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let roundId = "";
  let roundClosesAt = 0;
  let roundCurrency = "";
  let twoXSelection = null;
  let settling = false;
  let placingBet = false;
  let countdownFrame = 0;
  let recentLoaded = false;
  let recoveryAttempted = false;
  let recoveredAssetStakes = false;

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

  function renderIdleTrack() {
    track.classList.remove("is-spinning", "is-centering");
    track.style.transform = "translateX(-46px)";
    track.replaceChildren(...Array.from({ length: 35 }, (_, index) => tile(TRACK_PATTERN[index % TRACK_PATTERN.length])));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function spinToOutcome(outcome, landingBasisPoints = 0) {
    const items = Array.from({ length: 72 }, (_, index) => TRACK_PATTERN[index % TRACK_PATTERN.length]);
    const matching = items.map((item, index) => item === outcome ? index : -1).filter((index) => index >= 42);
    const finalIndex = matching[Math.abs(Number(landingBasisPoints) || 0) % Math.min(matching.length, 6)];
    track.classList.remove("is-spinning", "is-centering");
    track.replaceChildren(...items.map((item) => tile(item)));
    const firstTile = track.firstElementChild;
    const tileWidth = firstTile.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = tileWidth + gap;
    const centre = viewport.clientWidth / 2 - (finalIndex * step + tileWidth / 2);
    const landed = centre - (Math.max(-3200, Math.min(3200, Number(landingBasisPoints) || 0)) / 10000) * tileWidth;
    track.style.transform = `translateX(${landed + step * 24}px)`;
    void track.offsetWidth;
    track.classList.add("is-spinning");
    requestAnimationFrame(() => { track.style.transform = `translateX(${landed}px)`; });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    await delay(reducedMotion ? 80 : 5100);
    track.classList.remove("is-spinning");
    track.classList.add("is-centering");
    track.style.transform = `translateX(${centre}px)`;
    await delay(reducedMotion ? 40 : 920);
    track.classList.remove("is-centering");
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
    const currencyChanged = hasStakes() && roundCurrency && selectedCurrency !== roundCurrency;
    optionButtons.forEach((button) => {
      const outcome = button.dataset.rouletteOption;
      const oppositeTwoX = (outcome === "blue" || outcome === "cyan") && twoXSelection && twoXSelection !== outcome;
      button.disabled = settling || placingBet || !roundId || !selectedCurrency || currencyChanged || oppositeTwoX || amount < minimumWager() || amount > availableBalance;
      button.closest(".roulette-option")?.classList.toggle("is-locked", Boolean(oppositeTwoX));
    });
    Object.entries(displayedStakes).forEach(([key, value]) => {
      const field = game.querySelector(`[data-roulette-stake="${key}"]`);
      if (field) field.textContent = formatStake(value);
    });
    if (amount > availableBalance && amount > 0 && !settling) setMessage("Your available balance is too low for that bet.");
    else if (currencyChanged && !settling) setMessage(`This spin is using ${roundCurrency}. Switch back to place another bet.`);
    else if (!settling && !placingBet) setMessage();
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    betInput.min = minimumWager().toFixed(displayFiat ? 2 : 8);
    betInput.step = betInput.min;
    game.querySelectorAll("[data-roulette-currency]").forEach((field) => { field.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    updateAvailability();
    if (!recentLoaded) loadRecent();
    if (!recoveryAttempted) restoreActiveRound();
  }

  function adjustBet(action) {
    const amount = cleanAmount();
    let next = action === "half" ? amount / 2 : action === "double" ? amount * 2 : availableBalance;
    next = Math.min(availableBalance, next);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  function renderRecent(payload) {
    const results = Array.isArray(payload?.results) ? payload.results.filter((item) => OUTCOMES[item]) : [];
    const counts = payload?.counts || {};
    Object.keys(countFields).forEach((key) => { countFields[key].textContent = String(Number(counts[key]) || 0); });
    recent.replaceChildren(...results.slice(0, 10).map((outcome) => tile(outcome, true)));
  }

  async function loadRecent() {
    if (recentLoaded || !window.gamraceWallet?.request) return;
    recentLoaded = true;
    try {
      const response = await window.gamraceWallet.request("/games/roulette/recent");
      renderRecent(response.recent);
    } catch {
      recentLoaded = false;
    }
  }

  function stopCountdown() {
    if (countdownFrame) cancelAnimationFrame(countdownFrame);
    countdownFrame = 0;
  }

  function countdownTick() {
    const remaining = Math.max(0, roundClosesAt - Date.now());
    status.innerHTML = `Rolling in <strong>${(remaining / 1000).toFixed(2)}</strong>`;
    progress.style.width = `${Math.max(0, Math.min(100, (remaining / ROUND_LENGTH_MS) * 100))}%`;
    if (remaining <= 0) {
      countdownFrame = 0;
      settleRound();
      return;
    }
    countdownFrame = requestAnimationFrame(countdownTick);
  }

  function startCountdown() {
    stopCountdown();
    countdownFrame = requestAnimationFrame(countdownTick);
  }

  function resetRoundStakes() {
    Object.keys(displayedStakes).forEach((key) => { displayedStakes[key] = 0; });
    twoXSelection = null;
    recoveredAssetStakes = false;
  }

  function startNewRound() {
    settling = false;
    roundId = requestId();
    roundClosesAt = Date.now() + ROUND_LENGTH_MS;
    roundCurrency = selectedCurrency;
    resetRoundStakes();
    progress.style.width = "100%";
    updateAvailability();
    startCountdown();
  }

  async function restoreActiveRound() {
    recoveryAttempted = true;
    if (!selectedCurrency || !window.gamraceWallet?.request) return;
    placingBet = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/roulette/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.round) {
        stopCountdown();
        roundId = response.round.id;
        roundClosesAt = Number(response.round.closesAtMs);
        roundCurrency = response.round.currency;
        twoXSelection = response.round.twoXSelection;
        Object.keys(displayedStakes).forEach((key) => { displayedStakes[key] = Number(response.round.bets?.[key] || 0); });
        recoveredAssetStakes = displayFiat && hasStakes();
      }
    } catch (error) {
      setMessage(error.message || "Your previous Roulette spin could not be restored.");
    } finally {
      placingBet = false;
      if (!roundId || Number.isNaN(roundClosesAt)) startNewRound();
      else if (roundClosesAt <= Date.now()) settleRound();
      else startCountdown();
      updateAvailability();
    }
  }

  async function placeWager(outcome) {
    const amount = cleanAmount();
    if (settling || placingBet || !OUTCOMES[outcome] || amount < minimumWager() || amount > availableBalance) return;
    if ((outcome === "blue" || outcome === "cyan") && twoXSelection && twoXSelection !== outcome) return;
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      setMessage("Sign in and wait for your wallet to load before betting.");
      return;
    }
    placingBet = true;
    setMessage();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/roulette/wagers", {
        method: "POST",
        body: JSON.stringify({
          requestId: requestId(),
          roundId,
          closesAt: roundClosesAt,
          currency: selectedCurrency,
          selection: outcome,
          wager: amount.toFixed(displayFiat ? 2 : 8),
          displayFiat,
        }),
      });
      roundCurrency = response.round.currency;
      twoXSelection = response.round.twoXSelection;
      displayedStakes[outcome] = Math.round((displayedStakes[outcome] + amount) * 100000000) / 100000000;
      recoveredAssetStakes = false;
      window.gamraceWallet.applyGameResult(response);
    } catch (error) {
      setMessage(error.message || "That Roulette bet could not be placed.");
    } finally {
      placingBet = false;
      updateAvailability();
    }
  }

  async function settleRound() {
    if (settling || !roundId) return;
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      settling = true;
      status.textContent = "Rolling…";
      progress.style.width = "0";
      updateAvailability();
      const previewOutcome = TRACK_PATTERN[Math.floor(Date.now() / ROUND_LENGTH_MS) % TRACK_PATTERN.length];
      await spinToOutcome(previewOutcome, 0);
      startNewRound();
      return;
    }
    settling = true;
    status.textContent = "Rolling…";
    progress.style.width = "0";
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/roulette/rounds/${encodeURIComponent(roundId)}/settle`, {
        method: "POST",
        body: JSON.stringify({ currency: roundCurrency || selectedCurrency, closesAt: roundClosesAt }),
      });
      await spinToOutcome(response.round.result, response.round.landingBasisPoints);
      window.gamraceWallet.applyGameResult(response);
      renderRecent(response.recent);
      window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      startNewRound();
    } catch (error) {
      settling = false;
      setMessage(error.message || "The Roulette spin could not be completed. Retrying…");
      updateAvailability();
      window.setTimeout(settleRound, 1000);
    }
  }

  optionButtons.forEach((button) => button.addEventListener("click", () => placeWager(button.dataset.rouletteOption)));
  game.querySelectorAll("[data-roulette-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.rouletteBetAction)));
  game.querySelectorAll("[data-roulette-history-view]").forEach((button) => button.addEventListener("click", () => {
    game.querySelectorAll("[data-roulette-history-view]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }));
  betInput.addEventListener("input", updateAvailability);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));

  renderIdleTrack();
  startNewRound();
  updateAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
