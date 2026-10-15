(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  const minesGame = document.querySelector("#mines-game");
  const blankState = document.querySelector("#game-blank-state");

  if (gameName !== "mines") {
    if (!["dice", "plinko", "roulette", "keno", "wheel", "hi-lo", "coinflip", "crash", "blackjack", "towers", "limbo"].includes(gameName)) {
      document.title = "GamRace";
      blankState.hidden = false;
    }
    return;
  }

  document.title = "Mines | GamRace";
  minesGame.hidden = false;
  blankState.hidden = true;

  const TILE_COUNT = 25;
  let houseFactor = 0.99;
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
  let selectedAssetIcon = "usdt";
  let displayFiat = true;
  let activeRound = null;
  let betPending = false;
  let currentMode = "manual";
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let swipePointerActive = false;
  let swipePointerId = null;
  const selectedAutoTiles = new Set();
  const swipedTiles = new Set();
  const revealingTiles = new Set();
  let revealQueue = Promise.resolve();
  let roundPending = false;
  let activeRoundCheckCurrency = "";
  let activeRoundRestorePromise = null;
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
    if (displayFiat) return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    return `${value < 0 ? "-" : ""}${absolute} ${selectedSymbol}`;
  }

  function cleanAmount(input) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
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
    return Math.max(1, houseFactor / survivalProbability);
  }

  async function loadLiveHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.mines?.houseFactorMicros);
      if (!Number.isInteger(factor) || factor < 900_000 || factor > 1_000_000) return;
      houseFactor = factor / 1_000_000;
      updateCashoutButton();
    } catch { /* Keep the safe default until live configuration is reachable. */ }
  }

  function renderBalance() {
    window.GamRaceBetCurrency?.render(document.querySelectorAll(".bet-currency"), {
      displayFiat,
      asset: { symbol: selectedSymbol, icon: selectedAssetIcon },
    });
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
    const previousCurrency = selectedCurrency;
    const nextDisplayFiat = detail.displayFiat !== false;
    const selectionChanged = statCurrency && (statCurrency !== detail.currency || displayFiat !== nextDisplayFiat);
    selectedCurrency = detail.currency;
    statCurrency = selectedCurrency;
    displayFiat = nextDisplayFiat;
    selectedSymbol = detail.asset.symbol || selectedCurrency.toUpperCase();
    selectedAssetIcon = detail.asset.icon || selectedCurrency;
    balance = Math.max(0, displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0));
    if (previousCurrency && previousCurrency !== selectedCurrency) {
      activeRound = null;
      activeRoundCheckCurrency = "";
      result.hidden = true;
      buildBoard();
    }
    const minimum = minimumWager();
    [betInput, autoBetInput].forEach((input) => {
      input.min = minimum.toFixed(displayFiat ? 2 : 8);
      input.step = input.min;
    });
    if (selectionChanged) resetSessionStats();
    renderBalance();
    if (balance <= 0) showInsufficientBalance();
    else setBalanceMessage();
    updateWagerAvailability();
    void restoreActiveRound();
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
    const amount = cleanAmount(autoBetInput);
    if (!autoplayRunning) autoActionButton.disabled = betPending || selectedAutoTiles.size === 0 || amount < minimumWager() || amount > balance;
  }

  function setMinesMode(mode) {
    currentMode = mode;
    document.querySelectorAll("[data-mines-mode]").forEach((item) => {
      const selected = item.dataset.minesMode === mode;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll("[data-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.modePanel !== mode; });
  }

  function restoredRoundAmount(round, fallback = 0) {
    const value = displayFiat ? Number(round?.wagerUsdCents || 0) / 100 : Number(round?.wager || 0);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function renderRevealedSafeTiles() {
    if (!activeRound) return;
    activeRound.revealed.forEach((index) => {
      const tile = tileElement(index);
      if (!tile) return;
      tile.disabled = true;
      tile.classList.add("revealed", "is-gem");
      addTileArt(tile, "gem");
    });
  }

  function adoptActiveRound(round, { fallbackAmount = 0, automated = false, forceManual = false } = {}) {
    if (!round || round.status !== "active") return false;
    if (forceManual) setMinesMode("manual");
    const amount = restoredRoundAmount(round, fallbackAmount);
    activeRound = {
      id: round.id,
      currency: round.currency || selectedCurrency,
      amount,
      mines: Number(round.mineCount),
      minePositions: new Set(),
      revealed: new Set(round.revealed || []),
      finished: false,
      automated,
      multiplier: Number(round.multiplier || 1),
    };
    if (forceManual) betInput.value = amount.toFixed(displayFiat ? 2 : 8);
    result.hidden = true;
    buildBoard();
    renderRevealedSafeTiles();
    updateBetDisplay();
    updateCashoutButton();
    actionButton.disabled = activeRound.revealed.size === 0;
    mineSelect.disabled = true;
    betInput.disabled = true;
    return true;
  }

  async function restoreActiveRound() {
    const currency = selectedCurrency;
    if (!currency || !window.gamraceWallet?.request || activeRoundCheckCurrency === currency || (activeRound && !activeRound.finished && activeRound.currency === currency)) return;
    activeRoundCheckCurrency = currency;
    betPending = true;
    updateWagerAvailability();
    const restore = (async () => {
      try {
        const response = await window.gamraceWallet.request(`/games/mines/rounds/active?currency=${encodeURIComponent(currency)}`);
        if (selectedCurrency !== currency) return;
        window.gamraceWallet.applyGameResult(response);
        if (response.round) {
          adoptActiveRound(response.round, { forceManual: true });
          setBalanceMessage("Your active Mines round was restored.");
        }
      } catch (error) {
        if (selectedCurrency === currency) {
          activeRoundCheckCurrency = "";
          setBalanceMessage(error.message || "Your active Mines round could not be restored.");
        }
      }
    })();
    activeRoundRestorePromise = restore;
    try { await restore; }
    finally {
      if (activeRoundRestorePromise === restore) activeRoundRestorePromise = null;
      betPending = false;
      updateWagerAvailability();
    }
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

  async function startRound({ amount, mines, automated = false }) {
    if (activeRound && !activeRound.finished) return false;
    if (!Number.isFinite(amount) || amount < minimumWager() || amount > balance) {
      if (amount > balance) showInsufficientBalance();
      else setBalanceMessage(`Enter at least ${displayFiat ? "$0.01" : `0.00000001 ${selectedSymbol}`}.`);
      flashInvalid(automated ? autoBetInput.closest(".bet-input-shell") : betInput.closest(".bet-input-shell"));
      return false;
    }
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      setBalanceMessage("Sign in and wait for your wallet to load before betting.");
      return false;
    }
    setBalanceMessage();
    betPending = true;
    updateWagerAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/mines/rounds", {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID().replaceAll("-", ""), currency: selectedCurrency,
          wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, mineCount: mines,
        }),
      });
      window.gamraceWallet.applyGameResult(response);
      if (response.round?.status !== "active") window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      adoptActiveRound(response.round, { fallbackAmount: amount, automated });
      return true;
    } catch (error) {
      setBalanceMessage(error.message || "The bet could not be started.");
      return false;
    } finally {
      betPending = false;
      updateWagerAvailability();
    }
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
    revealQueue = revealQueue.then(() => revealTileForRound(index));
    return revealQueue;
  }

  async function revealTileForRound(index) {
    const tile = tileElement(index);
    if (!tile || !activeRound || activeRound.finished || activeRound.revealed.has(index) || revealingTiles.has(index)) return false;
    revealingTiles.add(index);
    roundPending = true;
    actionButton.disabled = true;
    tile.disabled = true;
    tile.classList.remove("auto-selected", "auto-selectable");
    try {
      const response = await window.gamraceWallet.request(`/games/mines/rounds/${encodeURIComponent(activeRound.id)}/reveal`, {
        method: "POST", body: JSON.stringify({ tile: index }),
      });
      window.gamraceWallet.applyGameResult(response);
      window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      activeRound.revealed = new Set(response.round.revealed || []);
      activeRound.minePositions = new Set(response.round.minePositions || []);
      activeRound.multiplier = Number(response.round.multiplier || 1);
      if (response.hitMine || response.round.status === "lost") {
        tile.classList.add("revealed", "is-mine", "exploded");
        addTileArt(tile, "mine");
        endLoss(index);
        return false;
      }
      tile.classList.add("revealed", "is-gem");
      addTileArt(tile, "gem");
      actionButton.disabled = cleanAmount(betInput) <= 0;
      updateCashoutButton();
      if (response.round.status === "won") finishWin(response.round);
      return true;
    } catch (error) {
      tile.disabled = false;
      setBalanceMessage(error.message || "That tile could not be revealed.");
      return false;
    } finally {
      revealingTiles.delete(index);
      roundPending = false;
      if (activeRound && !activeRound.finished) {
        updateCashoutButton();
        actionButton.disabled = activeRound.revealed.size === 0;
      }
    }
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
    const precision = displayFiat ? 100 : 100000000;
    const amount = picks > 0
      ? Math.round(activeRound.amount * calculateMultiplier(activeRound.mines, picks) * precision) / precision
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
    actionButton.disabled = cleanAmount(betInput) < minimumWager();
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

  function finishWin(round) {
    if (!activeRound || activeRound.finished) return 0;
    const multiplier = Number(round.multiplier || activeRound.multiplier || 1);
    const payout = activeRound.amount * multiplier;
    activeRound.multiplier = multiplier;
    activeRound.minePositions = new Set(round.minePositions || []);
    activeRound.finished = true;
    recordCompletedRound(payout);
    revealRemainingMines();
    resultPayout.textContent = money(payout);
    result.hidden = false;
    finishManualControls();
    return payout;
  }

  async function cashOut() {
    if (!activeRound || activeRound.finished || roundPending || activeRound.revealed.size === 0) return 0;
    roundPending = true;
    actionButton.disabled = true;
    try {
      const response = await window.gamraceWallet.request(`/games/mines/rounds/${encodeURIComponent(activeRound.id)}/cashout`, { method: "POST", body: "{}" });
      window.gamraceWallet.applyGameResult(response);
      return finishWin(response.round);
    } catch (error) {
      setBalanceMessage(error.message || "The cashout could not be completed.");
      return 0;
    } finally {
      roundPending = false;
      if (activeRound && !activeRound.finished) {
        updateCashoutButton();
        actionButton.disabled = activeRound.revealed.size === 0;
      }
    }
  }

  function resetForNewRound() {
    activeRound = null;
    result.hidden = true;
    actionButton.textContent = "Bet";
    actionButton.disabled = cleanAmount(betInput) < minimumWager();
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
      actionButton.disabled = betPending || cleanAmount(betInput) < minimumWager() || cleanAmount(betInput) > balance;
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
    return money(value);
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
    window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "mines", wager: activeRound.amount, payout } }));
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
    if (amount < minimumWager() || amount > balance) {
      if (amount > balance) showInsufficientBalance();
      else setBalanceMessage(`Enter at least ${displayFiat ? "$0.01" : `0.00000001 ${selectedSymbol}`}.`);
      flashInvalid(autoBetInput.closest(".bet-input-shell"));
      return;
    }

    autoplayRunning = true;
    stopAutoplayRequested = false;
    lockAutoControls(true);
    autoActionButton.disabled = false;
    autoActionButton.textContent = "Stop Autoplay";
    let interrupted = false;
    for (let round = 1; round <= rounds && !stopAutoplayRequested; round += 1) {
      if (amount > balance) break;
      if (round > 1) resetForNewRound();
      if (!await startRound({ amount, mines, automated: true })) break;
      for (const index of shuffle(selectedTiles)) {
        await delay(260);
        if (activeRound.finished) break;
        const revealed = await revealTileForRound(index);
        if (!revealed && activeRound && !activeRound.finished) {
          interrupted = true;
          break;
        }
      }

      if (interrupted) break;
      if (!activeRound.finished && activeRound.revealed.size === selectedTiles.length) await cashOut();
      await delay(420);
    }

    autoplayRunning = false;
    stopAutoplayRequested = false;
    lockAutoControls(false);
    autoActionButton.textContent = "Start Autoplay";
    if (activeRound && !activeRound.finished) {
      activeRound.automated = false;
      setMinesMode("manual");
      buildBoard();
      renderRevealedSafeTiles();
      updateCashoutButton();
      actionButton.disabled = activeRound.revealed.size === 0;
      mineSelect.disabled = true;
      betInput.disabled = true;
      setBalanceMessage("Autoplay paused. Continue this round manually or cash out.");
    } else {
      resetForNewRound();
    }
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
  loadLiveHouseEdge();

  actionButton.addEventListener("click", async () => {
    if (activeRound && !activeRound.finished) {
      await cashOut();
      return;
    }
    resetForNewRound();
    await startRound({ amount: cleanAmount(betInput), mines: Number(mineSelect.value) });
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
      setMinesMode(tab.dataset.minesMode);
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
