(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "dice") return;

  const diceGame = document.querySelector("#dice-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!diceGame) return;

  document.title = "Dice | GamRace";
  diceGame.hidden = false;
  if (blankState) blankState.hidden = true;

  const HOUSE_FACTOR = 0.99;
  const FAVORITES_KEY = "gamrace-favourites-v1";
  const SETTINGS_KEY = "gamrace-dice-settings-v1";
  const slider = diceGame.querySelector("#dice-roll-target");
  const sliderShell = diceGame.querySelector("#dice-slider-shell");
  const multiplierInput = diceGame.querySelector("#dice-multiplier");
  const targetInput = diceGame.querySelector("#dice-roll-over");
  const chanceInput = diceGame.querySelector("#dice-chance");
  const directionLabel = diceGame.querySelector("#dice-direction-label");
  const directionToggle = diceGame.querySelector("#dice-direction-toggle");
  const betInput = diceGame.querySelector("#dice-bet-amount");
  const autoBetInput = diceGame.querySelector("#dice-auto-bet-amount");
  const autoRoundInput = diceGame.querySelector("#dice-auto-round-count");
  const autoWinInput = diceGame.querySelector("#dice-auto-win");
  const autoLossInput = diceGame.querySelector("#dice-auto-loss");
  const actionButton = diceGame.querySelector("#dice-action");
  const autoActionButton = diceGame.querySelector("#dice-auto-action");
  const profitOutput = diceGame.querySelector("#dice-profit");
  const profitLabel = diceGame.querySelector("[data-dice-profit-label]");
  const balanceLabel = diceGame.querySelector("[data-dice-balance]");
  const balanceMessage = diceGame.querySelector("#dice-balance-message");
  const resultCard = diceGame.querySelector("#dice-result-card");
  const resultValue = diceGame.querySelector("#dice-result-value");
  const resultOutcome = diceGame.querySelector("#dice-result-outcome");
  const tools = diceGame.querySelector("[data-dice-game-tools]");
  const toolButtons = [...diceGame.querySelectorAll("[data-dice-game-tool]")];
  const toolPanels = [...diceGame.querySelectorAll("[data-dice-game-tool-panel]")];
  const favoriteButton = diceGame.querySelector('[data-dice-game-favorite="dice"]');

  let direction = "over";
  let currentMode = "manual";
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0, cumulativeProfit: [] };

  function readStoredJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  const settings = { turbo: false, mute: false, ...readStoredJson(SETTINGS_KEY, {}) };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
  }

  function cleanAmount(input) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function formatAmount(value, signed = false) {
    const amount = Number(value) || 0;
    const sign = signed && amount > 0 ? "+" : "";
    if (displayFiat) return `${sign}${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${sign}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function availableText() {
    return formatAmount(availableBalance);
  }

  function chanceValue() {
    const target = clamp(slider.value, 1, 98);
    return direction === "over" ? 100 - target : target;
  }

  function multiplierValue() {
    return HOUSE_FACTOR * 100 / chanceValue();
  }

  function updateSliderVisuals() {
    const target = clamp(slider.value, 1, 98);
    const cut = `${target}%`;
    sliderShell.style.setProperty("--dice-cut", cut);
    sliderShell.dataset.direction = direction;
    targetInput.value = target.toFixed(2);
    chanceInput.value = chanceValue().toFixed(4);
    multiplierInput.value = multiplierValue().toFixed(4);
    directionLabel.textContent = direction === "over" ? "Roll Over" : "Roll Under";
    targetInput.setAttribute("aria-label", `${directionLabel.textContent} target`);
    updateProfit();
  }

  function updateProfit() {
    const amount = cleanAmount(currentMode === "auto" ? autoBetInput : betInput);
    const profit = amount * Math.max(0, multiplierValue() - 1);
    profitOutput.value = profit.toFixed(displayFiat ? 2 : 8);
    profitOutput.textContent = profitOutput.value;
    profitLabel.textContent = formatAmount(profit);
  }

  function updateWagerAvailability() {
    const manualAmount = cleanAmount(betInput);
    const autoAmount = cleanAmount(autoBetInput);
    actionButton.disabled = autoplayRunning || manualAmount < 0.01 || manualAmount > availableBalance;
    autoActionButton.disabled = !autoplayRunning && (autoAmount < 0.01 || autoAmount > availableBalance);
    balanceLabel.textContent = availableText();
    updateProfit();

    const activeAmount = currentMode === "auto" ? autoAmount : manualAmount;
    if (activeAmount > availableBalance && activeAmount > 0) {
      balanceMessage.textContent = `Insufficient ${selectedSymbol} balance.`;
      balanceMessage.hidden = false;
    } else {
      balanceMessage.hidden = true;
    }
  }

  function secureRoll() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] % 10000) / 100;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function renderResult(roll, won) {
    resultValue.textContent = roll.toFixed(2);
    resultOutcome.textContent = won ? "Win" : "Loss";
    resultCard.hidden = false;
    resultCard.classList.remove("win", "loss", "dice-result-pop");
    void resultCard.offsetWidth;
    resultCard.classList.add(won ? "win" : "loss", "dice-result-pop");
    sliderShell.style.setProperty("--dice-result-position", `${roll}%`);
    sliderShell.classList.remove("show-result", "result-win", "result-loss");
    void sliderShell.offsetWidth;
    sliderShell.classList.add("show-result", won ? "result-win" : "result-loss");
  }

  function recordRoll(amount, profit) {
    sessionStats.wagered += amount;
    sessionStats.profit += profit;
    if (profit > 0) sessionStats.wins += 1;
    else sessionStats.losses += 1;
    sessionStats.cumulativeProfit.push(sessionStats.profit);
    renderSessionStats();
  }

  function runRoll(amount) {
    if (!Number.isFinite(amount) || amount < 0.01 || amount > availableBalance) {
      updateWagerAvailability();
      return null;
    }
    const roll = secureRoll();
    const target = Number(slider.value);
    const won = direction === "over" ? roll > target : roll < target;
    const profit = won ? amount * (multiplierValue() - 1) : -amount;
    availableBalance = Math.max(0, availableBalance + profit);
    renderResult(roll, won);
    recordRoll(amount, profit);
    updateWagerAvailability();
    return { won, profit };
  }

  async function runManualRoll() {
    actionButton.disabled = true;
    if (!settings.turbo) await delay(220);
    runRoll(cleanAmount(betInput));
  }

  async function runAutoplay() {
    if (autoplayRunning) {
      stopAutoplayRequested = true;
      autoActionButton.textContent = "Stopping…";
      return;
    }
    const rounds = Math.round(clamp(autoRoundInput.value, 1, 100));
    let amount = cleanAmount(autoBetInput);
    if (amount < 0.01 || amount > availableBalance) return updateWagerAvailability();

    autoplayRunning = true;
    stopAutoplayRequested = false;
    autoActionButton.disabled = false;
    autoActionButton.textContent = "Stop Autoplay";
    actionButton.disabled = true;

    for (let index = 0; index < rounds && !stopAutoplayRequested; index += 1) {
      const result = runRoll(amount);
      if (!result) break;
      const change = result.won ? clamp(autoWinInput.value, 0, 1000) : clamp(autoLossInput.value, 0, 1000);
      if (change > 0) amount = Math.round(amount * (1 + change / 100) * 100000000) / 100000000;
      autoBetInput.value = amount.toFixed(displayFiat ? 2 : 8);
      updateProfit();
      if (amount > availableBalance) break;
      if (index < rounds - 1) await delay(settings.turbo ? 90 : 520);
    }

    autoplayRunning = false;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Start Autoplay";
    updateWagerAvailability();
  }

  function adjustBet(input, action) {
    const value = cleanAmount(input);
    const next = action === "half" ? value / 2 : value * 2;
    input.value = Math.min(availableBalance, Math.max(0, next)).toFixed(displayFiat ? 2 : 8);
    updateWagerAvailability();
  }

  function setTargetFromChance(value) {
    const chance = clamp(value, 1, 98);
    slider.value = (direction === "over" ? 100 - chance : chance).toFixed(2);
    updateSliderVisuals();
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    const coinAmount = Number(detail.balance.available || 0);
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : coinAmount;
    diceGame.querySelectorAll("[data-dice-currency]").forEach((field) => { field.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    betInput.value = "0.00";
    autoBetInput.value = "0.00";
    sessionStats.profit = 0;
    sessionStats.wagered = 0;
    sessionStats.wins = 0;
    sessionStats.losses = 0;
    sessionStats.cumulativeProfit = [];
    renderSessionStats();
    updateWagerAvailability();
  }

  function favoriteIds() {
    const stored = readStoredJson(FAVORITES_KEY, []);
    return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : []);
  }

  function renderFavorite() {
    const selected = favoriteIds().has("dice");
    favoriteButton.setAttribute("aria-pressed", String(selected));
    favoriteButton.setAttribute("aria-label", selected ? "Remove Dice from favourites" : "Add Dice to favourites");
  }

  function toggleFavorite() {
    const favorites = favoriteIds();
    if (favorites.has("dice")) favorites.delete("dice");
    else favorites.add("dice");
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    renderFavorite();
  }

  function closeToolPanels() {
    toolPanels.forEach((panel) => { panel.hidden = true; });
    toolButtons.forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-expanded", "false");
    });
  }

  function toggleToolPanel(name) {
    const panel = diceGame.querySelector(`[data-dice-game-tool-panel="${name}"]`);
    const button = diceGame.querySelector(`[data-dice-game-tool="${name}"]`);
    if (!panel || !button) return;
    const opening = panel.hidden;
    closeToolPanels();
    if (opening) {
      panel.hidden = false;
      button.classList.add("active");
      button.setAttribute("aria-expanded", "true");
    }
  }

  function renderStatsChart() {
    const line = diceGame.querySelector("[data-dice-chart-line]");
    const area = diceGame.querySelector("[data-dice-chart-area]");
    const zeroLine = diceGame.querySelector("[data-dice-chart-zero]");
    const label = diceGame.querySelector("[data-dice-chart-label]");
    const values = [0, ...sessionStats.cumulativeProfit];
    if (values.length === 1) {
      line.setAttribute("points", "0,58 320,58");
      area.setAttribute("d", "M0 58 L320 58 L320 58 L0 58 Z");
      zeroLine.setAttribute("y1", "58");
      zeroLine.setAttribute("y2", "58");
      label.textContent = "No completed bets yet";
      return;
    }
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const spread = Math.max(maximum - minimum, Math.abs(maximum || minimum) * .25, .00000001);
    const chartMin = minimum - spread * .12;
    const chartMax = maximum + spread * .12;
    const xFor = (index) => index / Math.max(1, values.length - 1) * 320;
    const yFor = (value) => 108 - (value - chartMin) / (chartMax - chartMin) * 100;
    const points = values.map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`);
    const zeroY = yFor(0).toFixed(1);
    line.setAttribute("points", points.join(" "));
    area.setAttribute("d", `M${points.join(" L")} L320,${zeroY} L0,${zeroY} Z`);
    zeroLine.setAttribute("y1", zeroY);
    zeroLine.setAttribute("y2", zeroY);
    label.textContent = `${sessionStats.cumulativeProfit.length} completed ${sessionStats.cumulativeProfit.length === 1 ? "bet" : "bets"}`;
  }

  function renderSessionStats() {
    const values = {
      profit: formatAmount(sessionStats.profit, true),
      wagered: formatAmount(sessionStats.wagered),
      wins: String(sessionStats.wins),
      losses: String(sessionStats.losses),
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = diceGame.querySelector(`[data-dice-stat="${name}"]`);
      if (!field) return;
      field.textContent = value;
      if (name === "profit") {
        field.classList.toggle("positive", sessionStats.profit > 0);
        field.classList.toggle("negative", sessionStats.profit < 0);
      }
    });
    renderStatsChart();
  }

  function applySetting(name) {
    diceGame.classList.toggle(`${name}-mode`, Boolean(settings[name]));
    const control = diceGame.querySelector(`[data-dice-game-setting="${name}"]`);
    if (control) control.setAttribute("aria-checked", String(Boolean(settings[name])));
  }

  slider.addEventListener("input", updateSliderVisuals);
  targetInput.addEventListener("change", () => {
    slider.value = clamp(targetInput.value, 1, 98).toFixed(2);
    updateSliderVisuals();
  });
  chanceInput.addEventListener("change", () => setTargetFromChance(chanceInput.value));
  multiplierInput.addEventListener("change", () => setTargetFromChance(HOUSE_FACTOR * 100 / clamp(multiplierInput.value, 1.0102, 99)));
  directionToggle.addEventListener("click", () => {
    const chance = chanceValue();
    direction = direction === "over" ? "under" : "over";
    setTargetFromChance(chance);
  });
  betInput.addEventListener("input", updateWagerAvailability);
  autoBetInput.addEventListener("input", updateWagerAvailability);
  actionButton.addEventListener("click", runManualRoll);
  autoActionButton.addEventListener("click", runAutoplay);
  diceGame.querySelectorAll("[data-dice-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(betInput, button.dataset.diceBetAction)));
  diceGame.querySelectorAll("[data-dice-auto-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(autoBetInput, button.dataset.diceAutoBetAction)));

  diceGame.querySelectorAll("[data-dice-mode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (autoplayRunning) return;
      currentMode = tab.dataset.diceMode;
      diceGame.querySelectorAll("[data-dice-mode]").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      diceGame.querySelectorAll("[data-dice-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.diceModePanel !== currentMode; });
      updateWagerAvailability();
    });
  });

  toolButtons.forEach((button) => button.addEventListener("click", () => toggleToolPanel(button.dataset.diceGameTool)));
  favoriteButton.addEventListener("click", toggleFavorite);
  diceGame.querySelectorAll("[data-close-dice-tool]").forEach((button) => button.addEventListener("click", closeToolPanels));
  diceGame.querySelectorAll("[data-dice-game-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.diceGameSetting;
      settings[name] = !settings[name];
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      applySetting(name);
    });
  });
  document.addEventListener("pointerdown", (event) => { if (tools && !tools.contains(event.target)) closeToolPanels(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeToolPanels(); });
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));

  Object.keys(settings).forEach(applySetting);
  renderFavorite();
  renderSessionStats();
  updateSliderVisuals();
  updateWagerAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
