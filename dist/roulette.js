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
  const balanceLabel = game.querySelector("[data-roulette-balance]");
  const message = game.querySelector("#roulette-message");
  const clearButton = game.querySelector("#roulette-clear");
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
  const ROUND_LENGTH_MS = 8000;
  const queuedBets = { blue: 0, cyan: 0, purple: 0, gold: 0 };

  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let settling = false;
  let roundStartedAt = 0;
  let countdownFrame = 0;
  let recentLoaded = false;

  function iconMarkup(outcome) {
    return `<i class="roulette-tile-icon ${outcome}" aria-hidden="true"></i>`;
  }

  function tile(outcome, compact = false) {
    const element = document.createElement("span");
    element.className = `${compact ? "roulette-recent-tile" : "roulette-track-tile"} ${outcome}`;
    element.innerHTML = iconMarkup(outcome);
    element.title = `${OUTCOMES[outcome].label} · ${OUTCOMES[outcome].multiplier}×`;
    return element;
  }

  function renderIdleTrack() {
    track.classList.remove("is-spinning");
    track.style.transform = "translateX(-46px)";
    track.replaceChildren(...Array.from({ length: 35 }, (_, index) => tile(TRACK_PATTERN[index % TRACK_PATTERN.length])));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function spinToOutcome(outcome) {
    const baseIndex = 42;
    const items = Array.from({ length: 64 }, (_, index) => TRACK_PATTERN[index % TRACK_PATTERN.length]);
    const matchingOffset = TRACK_PATTERN.indexOf(outcome);
    const finalIndex = baseIndex + ((matchingOffset - (baseIndex % TRACK_PATTERN.length) + TRACK_PATTERN.length) % TRACK_PATTERN.length);
    track.classList.remove("is-spinning");
    track.replaceChildren(...items.map((item) => tile(item)));
    const firstTile = track.firstElementChild;
    const tileWidth = firstTile.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = tileWidth + gap;
    const finish = viewport.clientWidth / 2 - (finalIndex * step + tileWidth / 2);
    track.style.transform = `translateX(${finish + step * 23}px)`;
    void track.offsetWidth;
    track.classList.add("is-spinning");
    requestAnimationFrame(() => { track.style.transform = `translateX(${finish}px)`; });
    await delay(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 3520);
    track.classList.remove("is-spinning");
  }

  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function queuedTotal() {
    return Object.values(queuedBets).reduce((total, value) => total + value, 0);
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function setMessage(text = "") {
    message.textContent = text;
    message.hidden = !text;
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const remaining = Math.max(0, availableBalance - queuedTotal());
    balanceLabel.textContent = `${formatAmount(remaining)} available`;
    optionButtons.forEach((button) => {
      button.disabled = settling || !selectedCurrency || amount < minimumWager() || amount > remaining;
    });
    clearButton.disabled = settling || queuedTotal() <= 0;
    Object.entries(queuedBets).forEach(([key, value]) => {
      const field = game.querySelector(`[data-roulette-stake="${key}"]`);
      if (field) field.textContent = formatAmount(value);
    });
    if (amount > remaining && amount > 0 && !settling) setMessage(`Only ${formatAmount(remaining)} is available for this round.`);
    else if (!settling) setMessage();
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
  }

  function adjustBet(action) {
    const amount = cleanAmount();
    const remaining = Math.max(0, availableBalance - queuedTotal());
    let next = action === "half" ? amount / 2 : action === "double" ? amount * 2 : remaining;
    next = Math.min(remaining, next);
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
    roundStartedAt = 0;
    progress.style.width = "0";
  }

  function countdownTick(timestamp) {
    if (!roundStartedAt) roundStartedAt = timestamp;
    const elapsed = timestamp - roundStartedAt;
    const remaining = Math.max(0, ROUND_LENGTH_MS - elapsed);
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
    if (countdownFrame || settling) return;
    roundStartedAt = 0;
    countdownFrame = requestAnimationFrame(countdownTick);
  }

  function queueBet(outcome) {
    const amount = cleanAmount();
    const remaining = availableBalance - queuedTotal();
    if (settling || !OUTCOMES[outcome] || amount < minimumWager() || amount > remaining) return;
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      setMessage("Sign in and wait for your wallet to load before betting.");
      return;
    }
    queuedBets[outcome] = Math.round((queuedBets[outcome] + amount) * 100000000) / 100000000;
    updateAvailability();
    startCountdown();
  }

  function clearBets() {
    if (settling) return;
    Object.keys(queuedBets).forEach((key) => { queuedBets[key] = 0; });
    stopCountdown();
    status.textContent = "Place a bet to start the round";
    updateAvailability();
  }

  async function settleRound() {
    if (settling || queuedTotal() <= 0) return;
    settling = true;
    status.textContent = "Bets closed";
    updateAvailability();
    const submittedBets = Object.fromEntries(Object.entries(queuedBets)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => [key, value.toFixed(displayFiat ? 2 : 8)]));
    try {
      const response = await window.gamraceWallet.request("/games/roulette/bets", {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID().replaceAll("-", ""),
          currency: selectedCurrency,
          bets: submittedBets,
          displayFiat,
        }),
      });
      status.textContent = "Rolling…";
      await spinToOutcome(response.bet.result);
      window.gamraceWallet.applyGameResult(response);
      renderRecent(response.recent);
      const won = response.bet.payout !== "0.00000000";
      status.innerHTML = won
        ? `<strong>${OUTCOMES[response.bet.result].label} wins · ${OUTCOMES[response.bet.result].multiplier}×</strong>`
        : `${OUTCOMES[response.bet.result].label} landed · No winning bet`;
      Object.keys(queuedBets).forEach((key) => { queuedBets[key] = 0; });
    } catch (error) {
      setMessage(error.message || "The Roulette round could not be completed.");
      status.textContent = "Round cancelled — your balance was not charged";
    } finally {
      settling = false;
      progress.style.width = "0";
      updateAvailability();
    }
  }

  optionButtons.forEach((button) => button.addEventListener("click", () => queueBet(button.dataset.rouletteOption)));
  game.querySelectorAll("[data-roulette-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.rouletteBetAction)));
  betInput.addEventListener("input", updateAvailability);
  clearButton.addEventListener("click", clearBets);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));

  renderIdleTrack();
  updateAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
