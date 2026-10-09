(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  const minesGame = document.querySelector("#mines-game");
  const blankState = document.querySelector("#game-blank-state");

  if (gameName !== "mines") {
    document.title = "GamRace";
    blankState.hidden = false;
    return;
  }

  document.title = "Mines | GamRace";
  minesGame.hidden = false;
  blankState.hidden = true;

  const TILE_COUNT = 25;
  const HOUSE_FACTOR = 0.99;
  const board = document.querySelector("#mines-board");
  const actionButton = document.querySelector("#mines-action");
  const autoActionButton = document.querySelector("#auto-action");
  const betInput = document.querySelector("#bet-amount");
  const autoBetInput = document.querySelector("#auto-bet-amount");
  const mineSelect = document.querySelector("#mine-count");
  const autoMineSelect = document.querySelector("#auto-mine-count");
  const autoRoundInput = document.querySelector("#auto-round-count");
  const autoSelectedCount = document.querySelector("#auto-selected-count");
  const result = document.querySelector("#mines-result");
  const resultPayout = document.querySelector("#result-payout");
  const balanceMessage = document.querySelector("#mines-balance-message");
  const gameTools = document.querySelector("[data-game-tools]");
  const toolButtons = [...document.querySelectorAll("[data-game-tool]")];
  const toolPanels = [...document.querySelectorAll("[data-game-tool-panel]")];
  const favoriteButton = document.querySelector('[data-game-favorite="mines"]');
  const FAVORITES_KEY = "gamrace-favourites-v1";
  const SETTINGS_KEY = "gamrace-game-settings-v1";

  let balance = 0;
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let activeRound = null;
  let currentMode = "manual";
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let swipePointerActive = false;
  let swipePointerId = null;
  const selectedAutoTiles = new Set();
  const swipedTiles = new Set();
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0, cumulativeProfit: [] };
  let statCurrency = "";

  function readStoredJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  const storedSettings = readStoredJson(SETTINGS_KEY, {});
  const settings = {
    turbo: Boolean(storedSettings.turbo),
    swipe: Boolean(storedSettings.swipe),
    mute: Boolean(storedSettings.mute),
  };

  // Remove balances created by the earlier local prototype. Real balances must
  // come from the account backend; until then every visitor remains at zero.
  localStorage.removeItem("gamrace-balance-v1");

  function money(value) {
    const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    return `${value < 0 ? "-" : ""}${absolute} ${selectedSymbol}`;
  }

  function cleanAmount(input) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function secureRandomInt(max) {
    if (max <= 1) return 0;
    const limit = Math.floor(0x100000000 / max) * max;
    const data = new Uint32Array(1);
    do crypto.getRandomValues(data); while (data[0] >= limit);
    return data[0] % max;
  }

  function shuffle(values) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomInt(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function shuffledIndexes() {
    return shuffle(Array.from({ length: TILE_COUNT }, (_, index) => index));
  }

  function calculateMultiplier(mines, picks) {
    if (picks === 0) return 1;
    let survivalProbability = 1;
    for (let pick = 0; pick < picks; pick += 1) {
      survivalProbability *= (TILE_COUNT - mines - pick) / (TILE_COUNT - pick);
    }
    return Math.max(1, HOUSE_FACTOR / survivalProbability);
  }

  function renderBalance() {
    document.querySelectorAll(".bet-currency").forEach((label) => { label.textContent = selectedSymbol; });
    updateBetDisplay();
  }

  function setBalanceMessage(message = "") {
    balanceMessage.textContent = message;
    balanceMessage.hidden = !message;
  }

  function showInsufficientBalance() {
    setBalanceMessage(`Insufficient ${selectedSymbol} balance. Deposit funds or select another coin above.`);
  }

  function resetSessionStats() {
    sessionStats.profit = 0;
    sessionStats.wagered = 0;
    sessionStats.wins = 0;
    sessionStats.losses = 0;
    sessionStats.cumulativeProfit = [];
    renderSessionStats();
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    if (statCurrency && statCurrency !== detail.currency) resetSessionStats();
    selectedCurrency = detail.currency;
    statCurrency = selectedCurrency;
    selectedSymbol = detail.asset.symbol || selectedCurrency.toUpperCase();
    balance = Math.max(0, Number(detail.balance.available || 0));
    renderBalance();
    if (balance <= 0) showInsufficientBalance();
    else setBalanceMessage();
    updateWagerAvailability();
  }

  function flashInvalid(element) {
    element.classList.remove("input-invalid");
    requestAnimationFrame(() => element.classList.add("input-invalid"));
    window.setTimeout(() => element.classList.remove("input-invalid"), 420);
  }

  function buildMineOptions(select, selected = 3) {
    select.innerHTML = "";
    for (let count = 1; count <= 24; count += 1) {
      const option = document.createElement("option");
      option.value = String(count);
      option.textContent = String(count);
      option.selected = count === selected;
      select.append(option);
    }
  }

  function maxAutoSelections() {
    return TILE_COUNT - Number(autoMineSelect.value);
  }

  function trimAutoSelections() {
    const maximum = maxAutoSelections();
    while (selectedAutoTiles.size > maximum) {
      selectedAutoTiles.delete([...selectedAutoTiles].at(-1));
    }
  }

  function updateAutoSelectionDisplay() {
    const maximum = maxAutoSelections();
    autoSelectedCount.textContent = `${selectedAutoTiles.size} / ${maximum}`;
    if (!autoplayRunning) autoActionButton.disabled = selectedAutoTiles.size === 0 || cleanAmount(autoBetInput) <= 0;
  }

  function buildBoard() {
    board.innerHTML = "";
    const manualRoundActive = currentMode === "manual" && activeRound && !activeRound.finished && !autoplayRunning;
    const canSelectAutoTiles = currentMode === "auto" && !autoplayRunning && (!activeRound || activeRound.finished);

    for (let index = 0; index < TILE_COUNT; index += 1) {
      const tile = document.createElement("button");
      const selected = currentMode === "auto" && selectedAutoTiles.has(index);
      tile.type = "button";
      tile.className = "mine-tile";
      tile.dataset.index = String(index);
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", currentMode === "auto" ? `Tile ${index + 1}${selected ? ", selected" : ""}` : `Tile ${index + 1}`);
      tile.setAttribute("aria-pressed", currentMode === "auto" ? String(selected) : "false");
      tile.classList.toggle("auto-selectable", canSelectAutoTiles);
      tile.classList.toggle("auto-selected", selected);
      tile.disabled = !(manualRoundActive || canSelectAutoTiles);
      tile.addEventListener("click", () => {
        if (settings.swipe) return;
        handleTileClick(index, tile);
      });
      board.append(tile);
    }
  }

  function handleTileClick(index, tile) {
    if (currentMode === "auto" && !autoplayRunning && (!activeRound || activeRound.finished)) {
      if (selectedAutoTiles.has(index)) {
        selectedAutoTiles.delete(index);
      } else if (selectedAutoTiles.size < maxAutoSelections()) {
        selectedAutoTiles.add(index);
      } else {
        flashInvalid(board);
        return;
      }
      const selected = selectedAutoTiles.has(index);
      tile.classList.toggle("auto-selected", selected);
      tile.setAttribute("aria-pressed", String(selected));
      tile.setAttribute("aria-label", `Tile ${index + 1}${selected ? ", selected" : ""}`);
      updateAutoSelectionDisplay();
      return;
    }
    revealTile(index);
  }

  function startRound({ amount, mines, automated = false }) {
    if (activeRound && !activeRound.finished) return false;
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      if (amount > balance) showInsufficientBalance();
      else setBalanceMessage("Enter a bet amount greater than zero.");
      flashInvalid(automated ? autoBetInput.closest(".bet-input-shell") : betInput.closest(".bet-input-shell"));
      return false;
    }
    setBalanceMessage();

    activeRound = {
      amount,
      mines,
      minePositions: new Set(shuffledIndexes().slice(0, mines)),
      revealed: new Set(),
      finished: false,
      automated,
    };
    result.hidden = true;
    buildBoard();
    updateBetDisplay();
    updateCashoutButton();
    actionButton.disabled = true;
    mineSelect.disabled = true;
    betInput.disabled = true;
    return true;
  }

  function tileElement(index) {
    return board.querySelector(`[data-index="${index}"]`);
  }

  function addTileArt(tile, type) {
    const image = document.createElement("img");
    image.src = type === "mine" ? "assets/games/mines/bomb.png" : "assets/games/mines/gem.png";
    image.alt = type === "mine" ? "Mine" : "Gem";
    tile.replaceChildren(image);
  }

  function revealTile(index) {
    if (!activeRound || activeRound.finished || activeRound.revealed.has(index) || autoplayRunning) return;
    revealTileForRound(index);
  }

  function revealTileForRound(index) {
    const tile = tileElement(index);
    if (!tile || !activeRound || activeRound.finished || activeRound.revealed.has(index)) return false;
    tile.disabled = true;
    tile.classList.remove("auto-selected", "auto-selectable");

    if (activeRound.minePositions.has(index)) {
      tile.classList.add("revealed", "is-mine", "exploded");
      addTileArt(tile, "mine");
      endLoss(index);
      return false;
    }

    activeRound.revealed.add(index);
    tile.classList.add("revealed", "is-gem");
    addTileArt(tile, "gem");
    actionButton.disabled = cleanAmount(betInput) <= 0;
    updateCashoutButton();
    if (!activeRound.automated && activeRound.revealed.size === TILE_COUNT - activeRound.mines) cashOut();
    return true;
  }

  function updateBetDisplay() {
    document.querySelector("#bet-usd-value").textContent = money(activeRound?.amount ?? cleanAmount(betInput));
  }

  function updateCashoutButton() {
    if (!activeRound || activeRound.finished) {
      actionButton.textContent = "Bet";
      return;
    }
    const picks = activeRound.revealed.size;
    const amount = picks > 0
      ? Math.round(activeRound.amount * calculateMultiplier(activeRound.mines, picks) * 100) / 100
      : 0;
    actionButton.textContent = `Cashout ${money(amount)}`;
  }

  function revealRemainingMines(explodedIndex = -1) {
    activeRound.minePositions.forEach((index) => {
      if (index === explodedIndex) return;
      const tile = tileElement(index);
      tile.classList.remove("auto-selected", "auto-selectable");
      tile.classList.add("revealed", "is-mine", "mine-preview");
      tile.disabled = true;
      addTileArt(tile, "mine");
    });
    board.querySelectorAll(".mine-tile").forEach((tile) => { tile.disabled = true; });
  }

  function finishManualControls() {
    actionButton.textContent = "Bet";
    actionButton.disabled = cleanAmount(betInput) <= 0;
    mineSelect.disabled = false;
    betInput.disabled = false;
  }

  function endLoss(explodedIndex) {
    activeRound.finished = true;
    recordCompletedRound(0);
    revealRemainingMines(explodedIndex);
    resultPayout.textContent = money(0);
    result.hidden = false;
    finishManualControls();
    updateBetDisplay();
  }

  function cashOut() {
    if (!activeRound || activeRound.finished || activeRound.revealed.size === 0) return 0;
    const multiplier = calculateMultiplier(activeRound.mines, activeRound.revealed.size);
    const payout = Math.round(activeRound.amount * multiplier * 100) / 100;
    activeRound.finished = true;
    recordCompletedRound(payout);
    revealRemainingMines();
    resultPayout.textContent = money(payout);
    result.hidden = false;
    finishManualControls();
    return payout;
  }

  function resetForNewRound() {
    activeRound = null;
    result.hidden = true;
    actionButton.textContent = "Bet";
    actionButton.disabled = cleanAmount(betInput) <= 0;
    mineSelect.disabled = false;
    betInput.disabled = false;
    buildBoard();
    updateBetDisplay();
    updateAutoSelectionDisplay();
  }

  function adjustBet(input, action) {
    const current = cleanAmount(input);
    const next = action === "half" ? current / 2 : current * 2;
    input.value = Math.max(0, Math.min(balance, Math.round(next * 100000000) / 100000000)).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    if (input === betInput) updateBetDisplay();
    updateWagerAvailability();
  }

  function updateWagerAvailability() {
    if (!activeRound || activeRound.finished) {
      actionButton.disabled = cleanAmount(betInput) <= 0;
    }
    updateAutoSelectionDisplay();
  }

  function lockAutoControls(locked) {
    autoBetInput.disabled = locked;
    autoMineSelect.disabled = locked;
    autoRoundInput.disabled = locked;
    document.querySelectorAll("[data-auto-bet-action]").forEach((button) => { button.disabled = locked; });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function statAmount(value) {
    const decimals = Math.abs(value) >= 100 ? 2 : 4;
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: decimals })} ${selectedSymbol}`;
  }

  function renderStatsChart() {
    const line = document.querySelector("[data-chart-line]");
    const area = document.querySelector("[data-chart-area]");
    const zeroLine = document.querySelector("[data-chart-zero]");
    const label = document.querySelector("[data-chart-label]");
    if (!line || !area || !zeroLine || !label) return;
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
    const xFor = (index) => (index / Math.max(1, values.length - 1)) * 320;
    const yFor = (value) => 108 - ((value - chartMin) / (chartMax - chartMin)) * 100;
    const points = values.map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`);
    const zeroY = yFor(0).toFixed(1);
    line.setAttribute("points", points.join(" "));
    area.setAttribute("d", `M${points.join(" L")} L320,${zeroY} L0,${zeroY} Z`);
    zeroLine.setAttribute("y1", zeroY);
    zeroLine.setAttribute("y2", zeroY);
    label.textContent = `${sessionStats.cumulativeProfit.length} completed ${sessionStats.cumulativeProfit.length === 1 ? "bet" : "bets"}`;
  }

  function renderSessionStats() {
    const fields = {
      profit: statAmount(sessionStats.profit),
      wagered: statAmount(sessionStats.wagered),
      wins: String(sessionStats.wins),
      losses: String(sessionStats.losses),
    };
    Object.entries(fields).forEach(([name, value]) => {
      const field = document.querySelector(`[data-stat="${name}"]`);
      if (!field) return;
      field.textContent = value;
      if (name === "profit") {
        field.classList.toggle("positive", sessionStats.profit > 0);
        field.classList.toggle("negative", sessionStats.profit < 0);
      }
    });
    renderStatsChart();
  }

  function recordCompletedRound(payout) {
    if (!activeRound || activeRound.statsRecorded) return;
    activeRound.statsRecorded = true;
    const profit = payout - activeRound.amount;
    sessionStats.wagered += activeRound.amount;
    sessionStats.profit += profit;
    if (profit >= 0) sessionStats.wins += 1;
    else sessionStats.losses += 1;
    sessionStats.cumulativeProfit.push(sessionStats.profit);
    renderSessionStats();
  }

  function writeSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applySetting(name) {
    if (name === "turbo") minesGame.classList.toggle("turbo-mode", settings.turbo);
    if (name === "swipe") minesGame.classList.toggle("swipe-mode", settings.swipe);
    if (name === "mute") minesGame.dataset.muted = String(settings.mute);
    const control = document.querySelector(`[data-game-setting="${name}"]`);
    if (control) control.setAttribute("aria-checked", String(settings[name]));
  }

  function favoriteIds() {
    const stored = readStoredJson(FAVORITES_KEY, []);
    return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : []);
  }

  function renderFavorite() {
    const selected = favoriteIds().has("mines");
    favoriteButton.setAttribute("aria-pressed", String(selected));
    favoriteButton.setAttribute("aria-label", selected ? "Remove Mines from favourites" : "Add Mines to favourites");
  }

  function toggleFavorite() {
    const favorites = favoriteIds();
    if (favorites.has("mines")) favorites.delete("mines");
    else favorites.add("mines");
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
    const panel = document.querySelector(`[data-game-tool-panel="${name}"]`);
    const button = document.querySelector(`[data-game-tool="${name}"]`);
    if (!panel || !button) return;
    const willOpen = panel.hidden;
    closeToolPanels();
    if (willOpen) {
      panel.hidden = false;
      button.classList.add("active");
      button.setAttribute("aria-expanded", "true");
    }
  }

  function tileFromPointer(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".mine-tile");
    if (!target || !board.contains(target)) return;
    const index = Number(target.dataset.index);
    if (swipedTiles.has(index)) return;
    swipedTiles.add(index);
    handleTileClick(index, target);
  }

  async function runAutoplay() {
    const amount = cleanAmount(autoBetInput);
    const mines = Number(autoMineSelect.value);
    const rounds = Math.min(100, Math.max(1, Number.parseInt(autoRoundInput.value, 10) || 1));
    const selectedTiles = [...selectedAutoTiles];
    if (selectedTiles.length === 0) {
      flashInvalid(board);
      return;
    }
    if (amount <= 0 || amount > balance) {
      if (amount > balance) showInsufficientBalance();
      else setBalanceMessage("Enter an automatic bet amount greater than zero.");
      flashInvalid(autoBetInput.closest(".bet-input-shell"));
      return;
    }

    autoplayRunning = true;
    stopAutoplayRequested = false;
    lockAutoControls(true);
    autoActionButton.disabled = false;
    autoActionButton.textContent = "Stop Autoplay";
    for (let round = 1; round <= rounds && !stopAutoplayRequested; round += 1) {
      if (amount > balance) break;
      if (round > 1) resetForNewRound();
      if (!startRound({ amount, mines, automated: true })) break;
      for (const index of shuffle(selectedTiles)) {
        await delay(260);
        if (activeRound.finished) break;
        revealTileForRound(index);
      }

      if (!activeRound.finished && activeRound.revealed.size === selectedTiles.length) cashOut();
      await delay(420);
    }

    autoplayRunning = false;
    stopAutoplayRequested = false;
    lockAutoControls(false);
    autoActionButton.textContent = "Start Autoplay";
    resetForNewRound();
  }

  buildMineOptions(mineSelect);
  buildMineOptions(autoMineSelect);
  buildBoard();
  renderBalance();
  updateBetDisplay();
  updateAutoSelectionDisplay();
  updateWagerAvailability();
  Object.keys(settings).forEach(applySetting);
  renderFavorite();
  renderSessionStats();

  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);

  actionButton.addEventListener("click", () => {
    if (activeRound && !activeRound.finished) {
      cashOut();
      return;
    }
    resetForNewRound();
    startRound({ amount: cleanAmount(betInput), mines: Number(mineSelect.value) });
  });

  autoActionButton.addEventListener("click", () => {
    if (autoplayRunning) {
      stopAutoplayRequested = true;
      autoActionButton.textContent = "Stopping…";
      return;
    }
    runAutoplay();
  });

  document.querySelectorAll("[data-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(betInput, button.dataset.betAction)));
  document.querySelectorAll("[data-auto-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(autoBetInput, button.dataset.autoBetAction)));
  betInput.addEventListener("input", () => {
    updateBetDisplay();
    updateWagerAvailability();
  });
  autoBetInput.addEventListener("input", updateWagerAvailability);
  autoMineSelect.addEventListener("change", () => {
    trimAutoSelections();
    buildBoard();
    updateAutoSelectionDisplay();
  });

  toolButtons.forEach((button) => button.addEventListener("click", () => toggleToolPanel(button.dataset.gameTool)));
  favoriteButton.addEventListener("click", toggleFavorite);
  document.querySelectorAll("[data-close-game-tool]").forEach((button) => button.addEventListener("click", closeToolPanels));
  document.querySelectorAll("[data-game-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.gameSetting;
      settings[name] = !settings[name];
      applySetting(name);
      writeSettings();
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!gameTools.contains(event.target)) closeToolPanels();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeToolPanels();
  });

  board.addEventListener("pointerdown", (event) => {
    if (!settings.swipe || (event.pointerType === "mouse" && event.button !== 0)) return;
    swipePointerActive = true;
    swipePointerId = event.pointerId;
    swipedTiles.clear();
    event.preventDefault();
    tileFromPointer(event);
  });
  board.addEventListener("pointermove", (event) => {
    if (!settings.swipe || !swipePointerActive || event.pointerId !== swipePointerId) return;
    event.preventDefault();
    tileFromPointer(event);
  });
  const finishSwipe = (event) => {
    if (swipePointerId !== null && event.pointerId !== swipePointerId) return;
    swipePointerActive = false;
    swipePointerId = null;
    swipedTiles.clear();
  };
  window.addEventListener("pointerup", finishSwipe);
  window.addEventListener("pointercancel", finishSwipe);

  document.querySelectorAll("[data-mines-mode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      if ((activeRound && !activeRound.finished) || autoplayRunning) {
        flashInvalid(tab);
        return;
      }
      currentMode = tab.dataset.minesMode;
      document.querySelectorAll("[data-mines-mode]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      document.querySelectorAll("[data-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.modePanel !== currentMode; });
      resetForNewRound();
    });
  });

  document.querySelectorAll("[data-history-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-history-view]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
    });
  });
})();
