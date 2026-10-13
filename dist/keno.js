(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "keno") return;
  const game = document.querySelector("#keno-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Keno | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const RISK_MODELS = Object.freeze({
    easy: { thresholds: [0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4], growth: 1.6 },
    medium: { thresholds: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5], growth: 3 },
    hard: { thresholds: [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6], growth: 5 },
    extreme: { thresholds: [0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6], growth: 4 },
  });
  const TARGET_RTP = 0.99;
  const MAX_MULTIPLIER_MICROS = 1_000_000_000;

  function combinations(total, chosen) {
    if (chosen < 0 || chosen > total) return 0;
    let value = 1;
    const count = Math.min(chosen, total - chosen);
    for (let index = 1; index <= count; index += 1) value = value * (total - count + index) / index;
    return value;
  }

  function buildPaytable(model) {
    const table = {};
    const totalDraws = combinations(40, 10);
    for (let selected = 1; selected <= 10; selected += 1) {
      const threshold = model.thresholds[selected];
      const outcomes = [];
      for (let hits = threshold; hits <= selected; hits += 1) {
        const probability = combinations(selected, hits) * combinations(40 - selected, 10 - hits) / totalDraws;
        outcomes.push({ hits, probability, weight: model.growth ** (hits - threshold) });
      }
      const expectedReturn = (scale) => outcomes.reduce((total, outcome) => (
        total + outcome.probability * Math.min(MAX_MULTIPLIER_MICROS, Math.floor(scale * outcome.weight * 1_000_000)) / 1_000_000
      ), 0);
      let lower = 0;
      let upper = 1;
      while (expectedReturn(upper) < TARGET_RTP && upper < 1_000_000_000) upper *= 2;
      for (let iteration = 0; iteration < 96; iteration += 1) {
        const middle = (lower + upper) / 2;
        if (expectedReturn(middle) < TARGET_RTP) lower = middle;
        else upper = middle;
      }
      table[selected] = {};
      for (const outcome of outcomes) {
        table[selected][outcome.hits] = Math.min(MAX_MULTIPLIER_MICROS, Math.floor(lower * outcome.weight * 1_000_000)) / 1_000_000;
      }
    }
    return table;
  }

  const PAYTABLES = Object.freeze(Object.fromEntries(Object.entries(RISK_MODELS).map(([name, model]) => [name, buildPaytable(model)])));
  const SETTINGS_KEY = "gamrace-game-settings-v1";
  const board = game.querySelector("#keno-board");
  const drawStrip = game.querySelector("#keno-draw-strip");
  const betInput = game.querySelector("#keno-bet-amount");
  const pickCount = game.querySelector("#keno-pick-count");
  const autoPickButton = game.querySelector("#keno-auto-pick");
  const clearButton = game.querySelector("#keno-clear-picks");
  const riskButtons = [...game.querySelectorAll("[data-keno-risk]")];
  const turboButton = game.querySelector("#keno-turbo-toggle");
  const muteButton = game.querySelector("#keno-mute-toggle");
  const toolButtons = [...game.querySelectorAll("[data-keno-game-tool]")];
  const toolPanels = [...game.querySelectorAll("[data-keno-game-tool-panel]")];
  const favoriteButton = game.querySelector('[data-keno-game-favorite="keno"]');
  const actionButton = game.querySelector("#keno-action");
  const message = game.querySelector("#keno-message");
  const result = game.querySelector("#keno-result");
  const resultTitle = game.querySelector("#keno-result-title");
  const resultPayout = game.querySelector("#keno-result-payout");
  const paytable = game.querySelector("#keno-paytable");
  const selectedNumbers = new Set();
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let busy = false;
  let recoveryAttempted = false;
  let turbo = false;
  let muted = false;
  let risk = "medium";
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0, cumulative: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    turbo = Boolean(stored.turbo);
    muted = Boolean(stored.mute);
    if (Object.hasOwn(PAYTABLES, stored.kenoRisk)) risk = stored.kenoRisk;
  } catch { turbo = false; muted = false; risk = "medium"; }

  function requestId() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
  }

  function setMessage(text = "") {
    message.textContent = text;
    message.hidden = !text;
  }

  function formatMultiplier(value) {
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}×`;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function formatCoinAmount(value) {
    return `${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function renderPaytable(highlightedHits = null) {
    const selectedCount = selectedNumbers.size;
    const table = PAYTABLES[risk]?.[selectedCount];
    paytable.style.setProperty("--keno-picks", String(Math.max(1, selectedCount)));
    if (!table) {
      const empty = document.createElement("p");
      empty.textContent = "Select numbers to see the payout table";
      paytable.replaceChildren(empty);
      return;
    }
    paytable.replaceChildren(...Array.from({ length: selectedCount }, (_, index) => {
      const hits = index + 1;
      const cell = document.createElement("div");
      cell.className = `keno-paytable-cell${highlightedHits === hits ? " is-hit" : ""}`;
      const label = document.createElement("span");
      label.textContent = `${hits} hit${hits === 1 ? "" : "s"}`;
      const multiplier = document.createElement("strong");
      multiplier.textContent = table[hits] ? formatMultiplier(table[hits]) : "0×";
      cell.append(label, multiplier);
      return cell;
    }));
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const valid = selectedNumbers.size >= 1 && selectedNumbers.size <= 10;
    actionButton.disabled = busy || !selectedCurrency || !valid || amount < minimumWager() || amount > availableBalance;
    autoPickButton.disabled = busy;
    clearButton.disabled = busy || selectedNumbers.size === 0;
    riskButtons.forEach((button) => { button.disabled = busy; });
    board.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    if (!busy && amount > availableBalance && amount > 0) setMessage("Your available balance is too low for that bet.");
    else if (!busy) setMessage();
    renderPaytable();
  }

  function clearDraw() {
    board.querySelectorAll("button").forEach((button) => button.classList.remove("drawn", "hit", "miss"));
    drawStrip.replaceChildren();
    result.hidden = true;
    renderPaytable();
  }

  function renderSelection() {
    board.querySelectorAll("button").forEach((button) => button.classList.toggle("selected", selectedNumbers.has(Number(button.dataset.number))));
    updateAvailability();
  }

  function selectNumber(number) {
    if (busy) return;
    clearDraw();
    if (selectedNumbers.has(number)) selectedNumbers.delete(number);
    else if (selectedNumbers.size < 10) selectedNumbers.add(number);
    else setMessage("You can select up to 10 numbers.");
    renderSelection();
  }

  function secureAutoPick() {
    if (busy) return;
    const count = Number(pickCount.value);
    const numbers = Array.from({ length: 40 }, (_, index) => index + 1);
    for (let index = numbers.length - 1; index > 0; index -= 1) {
      const sample = new Uint32Array(1);
      crypto.getRandomValues(sample);
      const other = sample[0] % (index + 1);
      [numbers[index], numbers[other]] = [numbers[other], numbers[index]];
    }
    selectedNumbers.clear();
    numbers.slice(0, count).forEach((number) => selectedNumbers.add(number));
    clearDraw();
    renderSelection();
  }

  function renderBoard() {
    board.replaceChildren(...Array.from({ length: 40 }, (_, index) => {
      const button = document.createElement("button");
      const number = index + 1;
      button.type = "button";
      button.className = "keno-tile";
      button.dataset.number = String(number);
      button.setAttribute("aria-label", `Select number ${number}`);
      const frame = document.createElement("span");
      frame.textContent = String(number);
      button.append(frame);
      button.addEventListener("click", () => selectNumber(number));
      return button;
    }));
  }

  async function revealDraw(bet) {
    clearDraw();
    const selected = new Set(bet.selectedNumbers.map(Number));
    for (const number of bet.drawnNumbers) {
      const tile = board.querySelector(`[data-number="${number}"]`);
      const hit = selected.has(Number(number));
      tile?.classList.add("drawn", hit ? "hit" : "miss");
      const drawn = document.createElement("span");
      drawn.className = hit ? "hit" : "miss";
      drawn.textContent = String(number);
      drawStrip.append(drawn);
      if (!turbo) await delay(260);
    }
    resultTitle.textContent = `${bet.hits} hit${bet.hits === 1 ? "" : "s"}`;
    resultPayout.textContent = `${formatMultiplier(bet.multiplier)} · ${formatCoinAmount(bet.payout)}`;
    result.classList.toggle("win", bet.outcome === "win");
    result.classList.toggle("loss", bet.outcome !== "win");
    result.hidden = false;
    renderPaytable(bet.hits);
  }

  async function settleBet(bet) {
    const response = await window.gamraceWallet.request(`/games/keno/bets/${encodeURIComponent(bet.id)}/settle`, { method: "POST", body: "{}" });
    window.gamraceWallet.applyGameResult(response);
    window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
    return response.bet;
  }

  function renderSessionStats() {
    const values = { profit: sessionStats.profit, wagered: sessionStats.wagered, wins: sessionStats.wins, losses: sessionStats.losses };
    Object.entries(values).forEach(([name, value]) => {
      const field = game.querySelector(`[data-keno-stat="${name}"]`);
      if (field) field.textContent = ["wins", "losses"].includes(name) ? String(value) : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    });
    const label = game.querySelector("[data-keno-chart-label]");
    const line = game.querySelector("[data-keno-chart-line]");
    const area = game.querySelector("[data-keno-chart-area]");
    const zero = game.querySelector("[data-keno-chart-zero]");
    if (!label || !line || !area || !zero || !sessionStats.cumulative.length) return;
    const valuesWithZero = [0, ...sessionStats.cumulative];
    const minimum = Math.min(...valuesWithZero);
    const maximum = Math.max(...valuesWithZero);
    const spread = Math.max(1, maximum - minimum);
    const y = (value) => 108 - ((value - (minimum - spread * .1)) / (spread * 1.2)) * 100;
    const points = valuesWithZero.map((value, index) => `${(index / Math.max(1, valuesWithZero.length - 1) * 320).toFixed(1)},${y(value).toFixed(1)}`);
    const zeroY = y(0).toFixed(1);
    line.setAttribute("points", points.join(" "));
    area.setAttribute("d", `M${points.join(" L")} L320,${zeroY} L0,${zeroY} Z`);
    zero.setAttribute("y1", zeroY);
    zero.setAttribute("y2", zeroY);
    label.textContent = `${sessionStats.cumulative.length} completed ${sessionStats.cumulative.length === 1 ? "bet" : "bets"}`;
  }

  function recordBet(amount, bet) {
    const payout = amount * Number(bet.multiplier || 0);
    const profit = payout - amount;
    sessionStats.wagered += amount;
    sessionStats.profit += profit;
    if (bet.outcome === "win") sessionStats.wins += 1;
    else sessionStats.losses += 1;
    sessionStats.cumulative.push(sessionStats.profit);
    renderSessionStats();
  }

  async function play(existingBet = null) {
    if (busy || !window.gamraceWallet?.request) return;
    const amount = cleanAmount();
    if (!existingBet && (selectedNumbers.size < 1 || selectedNumbers.size > 10 || amount < minimumWager() || amount > availableBalance)) return;
    busy = true;
    setMessage();
    updateAvailability();
    try {
      let bet = existingBet;
      if (!bet) {
        const response = await window.gamraceWallet.request("/games/keno/bets", {
          method: "POST",
          body: JSON.stringify({
            requestId: requestId(), currency: selectedCurrency,
            wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat,
            selectedNumbers: [...selectedNumbers].sort((left, right) => left - right),
            risk,
          }),
        });
        bet = response.bet;
        window.gamraceWallet.applyGameResult(response);
      } else {
        if (Object.hasOwn(PAYTABLES, bet.risk)) risk = bet.risk;
        selectedNumbers.clear();
        bet.selectedNumbers.forEach((number) => selectedNumbers.add(Number(number)));
        renderSelection();
      }
      const displayedWager = existingBet ? Number(bet.wager || 0) : amount;
      await revealDraw(bet);
      const settledBet = await settleBet(bet);
      recordBet(displayedWager, settledBet);
    } catch (error) {
      setMessage(error.message || "That Keno bet could not be completed. It will be restored safely.");
    } finally {
      busy = false;
      updateAvailability();
    }
  }

  async function restoreActiveBet() {
    if (recoveryAttempted || !selectedCurrency || !window.gamraceWallet?.request) return;
    recoveryAttempted = true;
    try {
      const response = await window.gamraceWallet.request(`/games/keno/bets/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.bet) await play(response.bet);
    } catch (error) {
      setMessage(error.message || "Your unfinished Keno bet could not be restored yet.");
      recoveryAttempted = false;
    }
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
    game.querySelectorAll("[data-keno-currency]").forEach((element) => { element.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    const balanceLabel = game.querySelector("[data-keno-balance]");
    if (balanceLabel) balanceLabel.textContent = formatAmount(availableBalance);
    if (changed) recoveryAttempted = false;
    updateAvailability();
    restoreActiveBet();
  }

  function adjustBet(action) {
    const value = action === "half" ? cleanAmount() / 2 : cleanAmount() * 2;
    betInput.value = Math.min(availableBalance, value).toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  function persistSettings() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { settings = {}; }
    settings.turbo = turbo;
    settings.mute = muted;
    settings.kenoRisk = risk;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    turboButton.setAttribute("aria-checked", String(turbo));
    muteButton.setAttribute("aria-checked", String(muted));
    game.dataset.muted = String(muted);
    riskButtons.forEach((button) => {
      const active = button.dataset.kenoRisk === risk;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function closeTools() {
    toolPanels.forEach((panel) => { panel.hidden = true; });
    toolButtons.forEach((button) => { button.classList.remove("active"); button.setAttribute("aria-expanded", "false"); });
  }

  function toggleTool(name) {
    const panel = game.querySelector(`[data-keno-game-tool-panel="${name}"]`);
    const button = game.querySelector(`[data-keno-game-tool="${name}"]`);
    if (!panel || !button) return;
    const open = panel.hidden;
    closeTools();
    if (open) { panel.hidden = false; button.classList.add("active"); button.setAttribute("aria-expanded", "true"); }
  }

  function favoriteIds() {
    try { const value = JSON.parse(localStorage.getItem("gamrace-favourites-v1") || "[]"); return new Set(Array.isArray(value) ? value : []); }
    catch { return new Set(); }
  }

  function renderFavorite() {
    const active = favoriteIds().has("keno");
    favoriteButton.setAttribute("aria-pressed", String(active));
    favoriteButton.setAttribute("aria-label", active ? "Remove Keno from favourites" : "Add Keno to favourites");
  }

  function toggleFavorite() {
    const favorites = favoriteIds();
    if (favorites.has("keno")) favorites.delete("keno"); else favorites.add("keno");
    localStorage.setItem("gamrace-favourites-v1", JSON.stringify([...favorites]));
    renderFavorite();
  }

  renderBoard();
  persistSettings();
  renderFavorite();
  renderSessionStats();
  autoPickButton.addEventListener("click", secureAutoPick);
  clearButton.addEventListener("click", () => { selectedNumbers.clear(); clearDraw(); renderSelection(); });
  riskButtons.forEach((button) => button.addEventListener("click", () => {
    if (busy || !Object.hasOwn(PAYTABLES, button.dataset.kenoRisk)) return;
    risk = button.dataset.kenoRisk;
    clearDraw();
    persistSettings();
    renderPaytable();
  }));
  turboButton.addEventListener("click", () => { turbo = !turbo; persistSettings(); });
  muteButton.addEventListener("click", () => { muted = !muted; persistSettings(); });
  favoriteButton.addEventListener("click", toggleFavorite);
  toolButtons.forEach((button) => button.addEventListener("click", () => toggleTool(button.dataset.kenoGameTool)));
  game.querySelectorAll("[data-close-keno-tool]").forEach((button) => button.addEventListener("click", closeTools));
  actionButton.addEventListener("click", () => play());
  betInput.addEventListener("input", updateAvailability);
  game.querySelectorAll("[data-keno-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.kenoBetAction)));
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  renderSelection();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
