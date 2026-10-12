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
  const actionButton = game.querySelector("#roulette-action");
  const balanceLabel = game.querySelector("[data-roulette-balance]");
  const message = game.querySelector("#roulette-message");
  const options = [...game.querySelectorAll("[data-roulette-option]")];

  const OUTCOMES = Object.freeze({
    cyan: { label: "Velocity", multiplier: 2 },
    red: { label: "Rival", multiplier: 2 },
    violet: { label: "Overtake", multiplier: 7 },
    gold: { label: "Pole", multiplier: 14 },
  });
  const TRACK_PATTERN = ["cyan", "red", "cyan", "violet", "red", "cyan", "red", "gold", "cyan", "red", "cyan", "violet", "red", "cyan", "red"];

  let selection = "cyan";
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let pending = false;

  function iconMarkup(outcome) {
    if (outcome === "cyan") return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 5 53 17v25L32 59 11 42V17Z"/><path d="m18 35 10-17 1 13h17L35 48l-1-13Z"/></svg>';
    if (outcome === "red") return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 15h19l8 9H18v25H10Z"/><path d="M54 15H35l-8 9h19v25h8Z"/><circle cx="32" cy="39" r="10"/></svg>';
    if (outcome === "violet") return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="m32 5 6 17 18-3-13 13 13 13-18-3-6 17-6-17-18 3 13-13L8 19l18 3Z"/><circle cx="32" cy="32" r="7"/></svg>';
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="m10 22 13 9 9-18 9 18 13-9-5 25H15Z"/><path d="M17 51h30"/><circle cx="32" cy="36" r="6"/></svg>';
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
    track.style.transform = "translateX(-52px)";
    track.replaceChildren(...Array.from({ length: 24 }, (_, index) => tile(TRACK_PATTERN[index % TRACK_PATTERN.length])));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function spinToOutcome(outcome) {
    const finalIndex = 35;
    const items = Array.from({ length: 44 }, (_, index) => TRACK_PATTERN[index % TRACK_PATTERN.length]);
    items[finalIndex] = outcome;
    track.classList.remove("is-spinning");
    track.replaceChildren(...items.map((item) => tile(item)));
    const firstTile = track.firstElementChild;
    const tileWidth = firstTile.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
    const step = tileWidth + gap;
    const finish = viewport.clientWidth / 2 - (finalIndex * step + tileWidth / 2);
    track.style.transform = `translateX(${finish + step * 18}px)`;
    void track.offsetWidth;
    track.classList.add("is-spinning");
    progress.style.transition = "none";
    progress.style.width = "0";
    void progress.offsetWidth;
    progress.style.transition = "width 3.1s linear";
    progress.style.width = "100%";
    requestAnimationFrame(() => { track.style.transform = `translateX(${finish}px)`; });
    await delay(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 3260);
    track.classList.remove("is-spinning");
    progress.style.transition = "none";
    progress.style.width = "0";
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

  function updateAvailability() {
    const amount = cleanAmount();
    actionButton.disabled = pending || amount < minimumWager() || amount > availableBalance;
    balanceLabel.textContent = formatAmount(availableBalance);
    options.forEach((option) => { option.disabled = pending; });
    if (amount > availableBalance && amount > 0) {
      message.textContent = `Insufficient ${selectedSymbol} balance.`;
      message.hidden = false;
    } else if (!message.dataset.error) {
      message.hidden = true;
    }
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
  }

  function adjustBet(action) {
    const amount = cleanAmount();
    let next = action === "half" ? amount / 2 : action === "double" ? amount * 2 : availableBalance;
    next = Math.min(availableBalance, next);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    delete message.dataset.error;
    updateAvailability();
  }

  function addRecentResult(outcome) {
    recent.append(tile(outcome, true));
    while (recent.children.length > 10) recent.firstElementChild.remove();
  }

  async function placeBet() {
    const amount = cleanAmount();
    if (pending || amount < minimumWager() || amount > availableBalance) return;
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      message.dataset.error = "true";
      message.textContent = "Sign in and wait for your wallet to load before betting.";
      message.hidden = false;
      return;
    }
    pending = true;
    delete message.dataset.error;
    status.textContent = "Rolling…";
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/roulette/bets", {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID().replaceAll("-", ""),
          currency: selectedCurrency,
          wager: amount.toFixed(displayFiat ? 2 : 8),
          displayFiat,
          selection,
        }),
      });
      await spinToOutcome(response.bet.result);
      window.gamraceWallet.applyGameResult(response);
      addRecentResult(response.bet.result);
      const won = response.bet.outcome === "win";
      status.innerHTML = won
        ? `<strong>${OUTCOMES[response.bet.result].label} · ${Number(response.bet.multiplier).toFixed(0)}× win</strong>`
        : `${OUTCOMES[response.bet.result].label} · Better luck next roll`;
    } catch (error) {
      message.dataset.error = "true";
      message.textContent = error.message || "The Roulette bet could not be completed.";
      message.hidden = false;
      status.textContent = "Choose a lane to start";
    } finally {
      pending = false;
      updateAvailability();
    }
  }

  options.forEach((option) => option.addEventListener("click", () => {
    if (pending) return;
    selection = option.dataset.rouletteOption;
    options.forEach((item) => {
      const active = item === option;
      item.classList.toggle("active", active);
      item.setAttribute("aria-checked", String(active));
    });
  }));
  game.querySelectorAll("[data-roulette-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.rouletteBetAction)));
  betInput.addEventListener("input", () => { delete message.dataset.error; updateAvailability(); });
  actionButton.addEventListener("click", placeBet);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));

  renderIdleTrack();
  updateAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
