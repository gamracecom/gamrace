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
  const STARTING_BALANCE = 1250;
  const STORAGE_KEY = "gamrace-demo-balance-v1";
  const HISTORY_KEY = "gamrace-mines-history-v1";
  const board = document.querySelector("#mines-board");
  const actionButton = document.querySelector("#mines-action");
  const autoActionButton = document.querySelector("#auto-action");
  const betInput = document.querySelector("#bet-amount");
  const autoBetInput = document.querySelector("#auto-bet-amount");
  const mineSelect = document.querySelector("#mine-count");
  const autoMineSelect = document.querySelector("#auto-mine-count");
  const autoPickSelect = document.querySelector("#auto-pick-count");
  const autoRoundInput = document.querySelector("#auto-round-count");
  const headerBalance = document.querySelector("#header-balance");
  const status = document.querySelector("#mines-status");
  const multiplierText = document.querySelector("#current-multiplier");
  const nextMultiplierText = document.querySelector("#next-multiplier");
  const profitText = document.querySelector("#current-profit");
  const result = document.querySelector("#mines-result");
  const resultMultiplier = document.querySelector("#result-multiplier");
  const resultPayout = document.querySelector("#result-payout");
  const historyBody = document.querySelector("#history-body");
  const historyEmpty = document.querySelector("#history-empty");
  const autoProgress = document.querySelector("#auto-progress");
  const autoProfit = document.querySelector("#auto-profit");

  let balance = readNumber(STORAGE_KEY, STARTING_BALANCE);
  let history = readHistory();
  let activeRound = null;
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let historyView = "top";
  let historyPeriod = "Lifetime";

  function readNumber(key, fallback) {
    const value = Number.parseFloat(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function readHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(saved)
        ? saved.filter((item) => item && Number.isFinite(item.amount) && Number.isFinite(item.multiplier) && Number.isFinite(item.payout) && Number.isFinite(new Date(item.date).getTime())).slice(0, 50)
        : [];
    } catch {
      return [];
    }
  }

  function money(value) {
    const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? "-" : ""}$${absolute}`;
  }

  function cleanAmount(input) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  }

  function secureRandomInt(max) {
    if (max <= 1) return 0;
    const limit = Math.floor(0x100000000 / max) * max;
    const data = new Uint32Array(1);
    do crypto.getRandomValues(data); while (data[0] >= limit);
    return data[0] % max;
  }

  function shuffledIndexes() {
    const values = Array.from({ length: TILE_COUNT }, (_, index) => index);
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomInt(index + 1);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  }

  function calculateMultiplier(mines, picks) {
    if (picks === 0) return 1;
    let survivalProbability = 1;
    for (let pick = 0; pick < picks; pick += 1) {
      survivalProbability *= (TILE_COUNT - mines - pick) / (TILE_COUNT - pick);
    }
    return Math.max(1, HOUSE_FACTOR / survivalProbability);
  }

  function setBalance(nextBalance) {
    balance = Math.max(0, Math.round(nextBalance * 100) / 100);
    localStorage.setItem(STORAGE_KEY, String(balance));
    headerBalance.innerHTML = `${money(balance)} <span>[18]</span>`;
  }

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
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

  function updateAutoPickOptions() {
    const maxPicks = TILE_COUNT - Number(autoMineSelect.value);
    const previous = Math.min(Number(autoPickSelect.value) || 3, maxPicks);
    autoPickSelect.innerHTML = "";
    for (let count = 1; count <= maxPicks; count += 1) {
      const option = document.createElement("option");
      option.value = String(count);
      option.textContent = String(count);
      option.selected = count === previous;
      autoPickSelect.append(option);
    }
  }

  function buildBoard() {
    board.innerHTML = "";
    for (let index = 0; index < TILE_COUNT; index += 1) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "mine-tile";
      tile.dataset.index = String(index);
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", `Tile ${index + 1}`);
      tile.disabled = !activeRound || activeRound.finished || autoplayRunning;
      tile.addEventListener("click", () => revealTile(index));
      board.append(tile);
    }
  }

  function startRound({ amount, mines, automated = false }) {
    if (activeRound && !activeRound.finished) return false;
    if (!Number.isFinite(amount) || amount < 0.01) {
      setStatus("Enter a bet of at least $0.01.", "error");
      return false;
    }
    if (amount > balance) {
      setStatus("Your demo balance is too low for that bet.", "error");
      return false;
    }

    const minePositions = new Set(shuffledIndexes().slice(0, mines));
    activeRound = { amount, mines, minePositions, revealed: new Set(), finished: false, automated };
    setBalance(balance - amount);
    result.hidden = true;
    buildBoard();
    updateRoundSummary();
    actionButton.textContent = "Cash Out";
    actionButton.disabled = true;
    mineSelect.disabled = true;
    betInput.disabled = true;
    setStatus(`${mines} mines hidden. Pick a tile.`, "active");
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

    if (activeRound.minePositions.has(index)) {
      tile.classList.add("revealed", "is-mine", "exploded");
      addTileArt(tile, "mine");
      endLoss(index);
      return false;
    }

    activeRound.revealed.add(index);
    tile.classList.add("revealed", "is-gem");
    addTileArt(tile, "gem");
    actionButton.disabled = false;
    updateRoundSummary();
    setStatus(`${activeRound.revealed.size} safe tile${activeRound.revealed.size === 1 ? "" : "s"} revealed.`, "success");
    if (activeRound.revealed.size === TILE_COUNT - activeRound.mines) cashOut(true);
    return true;
  }

  function updateRoundSummary() {
    const picks = activeRound?.revealed.size || 0;
    const mines = activeRound?.mines || Number(mineSelect.value);
    const amount = activeRound?.amount || cleanAmount(betInput);
    const multiplier = calculateMultiplier(mines, picks);
    const next = picks < TILE_COUNT - mines ? calculateMultiplier(mines, picks + 1) : multiplier;
    multiplierText.textContent = `${multiplier.toFixed(2)}×`;
    nextMultiplierText.textContent = `${next.toFixed(2)}×`;
    profitText.textContent = money(Math.max(0, amount * multiplier - amount));
    document.querySelector("#bet-usd-value").textContent = `${money(amount)} demo`;
  }

  function revealRemainingMines(explodedIndex = -1) {
    activeRound.minePositions.forEach((index) => {
      if (index === explodedIndex) return;
      const tile = tileElement(index);
      tile.classList.add("revealed", "is-mine", "mine-preview");
      tile.disabled = true;
      addTileArt(tile, "mine");
    });
    board.querySelectorAll(".mine-tile").forEach((tile) => { tile.disabled = true; });
  }

  function endLoss(explodedIndex) {
    activeRound.finished = true;
    revealRemainingMines(explodedIndex);
    resultMultiplier.textContent = "0.00×";
    resultPayout.textContent = money(0);
    result.hidden = false;
    actionButton.textContent = "Bet";
    actionButton.disabled = false;
    mineSelect.disabled = false;
    betInput.disabled = false;
    updateRoundSummary();
    setStatus("Mine hit. Start a new round when you’re ready.", "error");
  }

  function cashOut(completedBoard = false) {
    if (!activeRound || activeRound.finished || activeRound.revealed.size === 0) return 0;
    const multiplier = calculateMultiplier(activeRound.mines, activeRound.revealed.size);
    const payout = Math.round(activeRound.amount * multiplier * 100) / 100;
    activeRound.finished = true;
    setBalance(balance + payout);
    revealRemainingMines();
    resultMultiplier.textContent = `${multiplier.toFixed(2)}×`;
    resultPayout.textContent = money(payout);
    result.hidden = false;
    actionButton.textContent = "Bet";
    actionButton.disabled = false;
    mineSelect.disabled = false;
    betInput.disabled = false;
    recordWin(activeRound.amount, multiplier, payout);
    setStatus(completedBoard ? `Board cleared — ${money(payout)} added to your demo balance.` : `Cashed out ${money(payout)} at ${multiplier.toFixed(2)}×.`, "success");
    return payout;
  }

  function recordWin(amount, multiplier, payout) {
    history.unshift({ id: Date.now() + secureRandomInt(1000), date: new Date().toISOString(), amount, multiplier, payout });
    history = history.slice(0, 50);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const filtered = history.filter((item) => {
      const timestamp = new Date(item.date).getTime();
      if (historyPeriod === "Today") return timestamp >= startOfToday;
      if (historyPeriod === "This week") return timestamp >= startOfWeek;
      return true;
    });
    const sorted = filtered.sort(historyView === "top" ? (a, b) => b.payout - a.payout : (a, b) => b.multiplier - a.multiplier).slice(0, 8);
    historyBody.innerHTML = "";
    historyEmpty.hidden = sorted.length > 0;
    sorted.forEach((item, index) => {
      const row = document.createElement("tr");
      const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(item.date));
      row.innerHTML = `<td>${index + 1}</td><td>Demo Player</td><td>${date}</td><td>${money(item.amount)}</td><td>${item.multiplier.toFixed(2)}×</td><td>${money(item.payout)}</td>`;
      historyBody.append(row);
    });
  }

  function resetForNewRound() {
    activeRound = null;
    buildBoard();
    updateRoundSummary();
    result.hidden = true;
    actionButton.textContent = "Bet";
    actionButton.disabled = false;
    mineSelect.disabled = false;
    betInput.disabled = false;
  }

  function adjustBet(input, action) {
    const current = cleanAmount(input);
    const next = action === "half" ? current / 2 : current * 2;
    input.value = Math.max(0.01, Math.min(balance, Math.round(next * 100) / 100)).toFixed(2);
    updateRoundSummary();
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function runAutoplay() {
    const amount = cleanAmount(autoBetInput);
    const mines = Number(autoMineSelect.value);
    const picks = Number(autoPickSelect.value);
    const rounds = Math.min(100, Math.max(1, Number.parseInt(autoRoundInput.value, 10) || 1));
    if (amount < 0.01 || amount > balance) {
      setStatus(amount < 0.01 ? "Enter an autoplay bet of at least $0.01." : "Your demo balance is too low for that autoplay bet.", "error");
      return;
    }

    autoplayRunning = true;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Stop Autoplay";
    let totalProfit = 0;

    for (let round = 1; round <= rounds && !stopAutoplayRequested; round += 1) {
      if (amount > balance || !startRound({ amount, mines, automated: true })) break;
      const balanceAfterBet = balance;
      autoProgress.textContent = `${round} / ${rounds}`;
      const choices = shuffledIndexes();
      for (let pick = 0; pick < picks && !activeRound.finished && !stopAutoplayRequested; pick += 1) {
        await delay(220);
        revealTileForRound(choices[pick]);
      }
      if (!activeRound.finished && activeRound.revealed.size > 0) cashOut();
      totalProfit += balance - balanceAfterBet - amount;
      autoProfit.textContent = `${totalProfit >= 0 ? "+" : ""}${money(totalProfit)}`;
      await delay(420);
      resetForNewRound();
    }

    autoplayRunning = false;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Start Autoplay";
    setStatus("Autoplay finished.", "success");
  }

  buildMineOptions(mineSelect);
  buildMineOptions(autoMineSelect);
  updateAutoPickOptions();
  buildBoard();
  setBalance(balance);
  updateRoundSummary();
  renderHistory();

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
  betInput.addEventListener("input", updateRoundSummary);
  mineSelect.addEventListener("change", updateRoundSummary);
  autoMineSelect.addEventListener("change", updateAutoPickOptions);
  autoRoundInput.addEventListener("input", () => { autoProgress.textContent = `0 / ${Math.min(100, Math.max(1, Number.parseInt(autoRoundInput.value, 10) || 1))}`; });

  document.querySelectorAll("[data-mines-mode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      if ((activeRound && !activeRound.finished) || autoplayRunning) {
        setStatus("Finish or cash out the current round before changing mode.", "error");
        return;
      }
      const mode = tab.dataset.minesMode;
      document.querySelectorAll("[data-mines-mode]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      document.querySelectorAll("[data-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.modePanel !== mode; });
      setStatus(mode === "manual" ? "Choose your bet and mine count, then start a round." : "Choose how many automatic rounds and picks to play.");
    });
  });

  document.querySelectorAll("[data-history-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      historyView = tab.dataset.historyView;
      document.querySelectorAll("[data-history-view]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      renderHistory();
    });
  });

  document.querySelector("#history-period").addEventListener("change", (event) => {
    historyPeriod = event.target.value;
    renderHistory();
  });

  document.querySelector("#fairness-button").addEventListener("click", () => {
    setStatus("Every demo round uses cryptographically secure random mine placement in your browser.", "success");
  });
})();
