(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "towers") return;
  const game = document.querySelector("#towers-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Towers | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const CONFIG = Object.freeze({
    easy: { columns: 4, traps: 1 },
    medium: { columns: 3, traps: 1 },
    hard: { columns: 2, traps: 1 },
    extreme: { columns: 3, traps: 2 },
  });
  const ROWS = 8;
  const board = game.querySelector("#towers-board");
  const betInput = game.querySelector("#towers-bet-amount");
  const actionButton = game.querySelector("#towers-action");
  const balanceLabel = game.querySelector("[data-towers-balance]");
  const multiplierLabel = game.querySelector("#towers-multiplier");
  const message = game.querySelector("#towers-message");
  const difficultyButtons = [...game.querySelectorAll("[data-towers-difficulty]")];
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let difficulty = "medium";
  let houseFactor = 0.99;
  let round = null;
  let busy = false;
  const recordedRounds = new Set();

  function requestId() { return crypto.randomUUID().replaceAll("-", ""); }

  function settings() {
    try { return JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}"); }
    catch { return {}; }
  }

  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function minimumWager() { return displayFiat ? 0.01 : 0.00000001; }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function multiplierFor(config, level) {
    if (!level) return 1;
    return houseFactor / Math.pow((config.columns - config.traps) / config.columns, level);
  }

  function setMessage(text = "", tone = "") {
    message.textContent = text;
    message.dataset.tone = tone;
    message.hidden = !text;
  }

  function levelMultipliers() {
    if (Array.isArray(round?.levelMultipliers) && round.levelMultipliers.length === ROWS) return round.levelMultipliers;
    const config = CONFIG[difficulty];
    return Array.from({ length: ROWS }, (_, index) => multiplierFor(config, index + 1));
  }

  function renderBoard(animateRow = -1) {
    const config = round ? { columns: Number(round.columns), traps: Number(round.trapsPerRow) } : CONFIG[difficulty];
    const cleared = Number(round?.clearedRows || 0);
    const active = round?.status === "active";
    const picks = Array.isArray(round?.picks) ? round.picks.map(Number) : [];
    const revealed = round?.revealedTraps || {};
    const multipliers = levelMultipliers();
    board.replaceChildren();
    for (let rowIndex = ROWS - 1; rowIndex >= 0; rowIndex -= 1) {
      const row = document.createElement("div");
      row.className = "towers-row";
      row.style.setProperty("--columns", String(config.columns));
      if (rowIndex < cleared) row.classList.add("cleared");
      if (active && rowIndex === cleared) row.classList.add("current");
      if (picks[rowIndex] !== undefined && revealed[String(rowIndex)]?.includes(picks[rowIndex])) row.classList.add("failed");
      if (rowIndex === animateRow && !settings().towersTurbo) row.classList.add("reveal");
      const multiplier = document.createElement("span");
      multiplier.className = "towers-row-multiplier";
      multiplier.textContent = `${Number(multipliers[rowIndex] || 1).toFixed(2)}×`;
      row.append(multiplier);
      for (let column = 0; column < config.columns; column += 1) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "towers-tile";
        tile.setAttribute("aria-label", `Row ${rowIndex + 1}, tile ${column + 1}`);
        const isTrap = Array.isArray(revealed[String(rowIndex)]) && revealed[String(rowIndex)].includes(column);
        const selected = picks[rowIndex] === column;
        if (isTrap) tile.classList.add("trap");
        else if (selected) tile.classList.add("safe");
        if (selected) tile.classList.add("selected");
        tile.disabled = busy || !active || rowIndex !== cleared;
        if (!tile.disabled) tile.addEventListener("click", () => choose(column));
        row.append(tile);
      }
      board.append(row);
    }
  }

  function updateAvailability() {
    const active = round?.status === "active";
    const amount = cleanAmount();
    betInput.disabled = busy || active;
    difficultyButtons.forEach((button) => { button.disabled = busy || active; });
    balanceLabel.textContent = formatAmount(availableBalance);
    multiplierLabel.textContent = `${Number(round?.multiplier || 1).toFixed(2)}×`;
    actionButton.classList.toggle("cashout", active && Number(round?.clearedRows || 0) > 0);
    actionButton.textContent = active ? `Cash Out ${Number(round.multiplier || 1).toFixed(2)}×` : "Start";
    actionButton.disabled = busy || (active ? Number(round.clearedRows || 0) < 1 : !selectedCurrency || amount < minimumWager() || amount > availableBalance);
  }

  function renderRound(nextRound, animateRow = -1) {
    round = nextRound || null;
    if (round?.difficulty && CONFIG[round.difficulty]) {
      difficulty = round.difficulty;
      difficultyButtons.forEach((button) => button.classList.toggle("active", button.dataset.towersDifficulty === difficulty));
    }
    renderBoard(animateRow);
    if (round && round.status !== "active") {
      const wager = Number(round.wager || 0);
      const payout = Number(round.payout || 0);
      setMessage(round.outcome === "win" ? `${Number(round.multiplier).toFixed(2)}× · ${payout.toFixed(8)} ${selectedSymbol}` : "Round lost", round.outcome);
      if (!recordedRounds.has(round.id)) {
        recordedRounds.add(round.id);
        window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "towers", wager, payout } }));
        window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      }
    } else setMessage();
    updateAvailability();
  }

  function selectDifficulty(value) {
    if (round?.status === "active" || !CONFIG[value]) return;
    difficulty = value;
    difficultyButtons.forEach((button) => button.classList.toggle("active", button.dataset.towersDifficulty === value));
    renderBoard();
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
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-towers-currency]"), detail);
    if (changed) round = null;
    updateAvailability();
    syncActive();
  }

  function adjustBet(action) {
    const value = cleanAmount();
    const next = Math.min(availableBalance, action === "half" ? value / 2 : value * 2);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function syncActive() {
    if (!selectedCurrency || busy || !window.gamraceWallet?.request) return;
    try {
      const response = await window.gamraceWallet.request(`/games/towers/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.wallet) window.gamraceWallet.applyGameResult(response);
      if (response.round || !round || round.currency !== selectedCurrency) renderRound(response.round);
    } catch (error) { if (!round) setMessage(error.message || "Towers is reconnecting."); }
  }

  async function start() {
    const amount = cleanAmount();
    if (busy || round?.status === "active" || amount < minimumWager() || amount > availableBalance) return;
    busy = true;
    setMessage();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/towers/rounds", {
        method: "POST",
        body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, difficulty }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Towers round could not be started."); }
    finally { busy = false; updateAvailability(); renderBoard(); }
  }

  async function choose(column) {
    if (busy || round?.status !== "active") return;
    busy = true;
    updateAvailability();
    const rowIndex = Number(round.clearedRows || 0);
    try {
      const response = await window.gamraceWallet.request(`/games/towers/rounds/${encodeURIComponent(round.id)}/choose`, {
        method: "POST", body: JSON.stringify({ actionId: requestId(), column }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round, rowIndex);
    } catch (error) { setMessage(error.message || "That tile could not be opened."); }
    finally {
      busy = false;
      updateAvailability();
      window.setTimeout(() => renderBoard(), settings().towersTurbo ? 0 : 300);
    }
  }

  async function cashout() {
    if (busy || round?.status !== "active" || Number(round.clearedRows || 0) < 1) return;
    busy = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/towers/rounds/${encodeURIComponent(round.id)}/cashout`, {
        method: "POST", body: JSON.stringify({ actionId: requestId() }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Towers round could not be cashed out."); }
    finally { busy = false; updateAvailability(); renderBoard(); }
  }

  async function loadHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.towers?.houseFactorMicros);
      if (Number.isInteger(factor) && factor >= 900_000 && factor <= 1_000_000) {
        houseFactor = factor / 1_000_000;
        if (!round) renderBoard();
      }
    } catch { /* Default remains until the live setting is available. */ }
  }

  actionButton.addEventListener("click", () => round?.status === "active" ? cashout() : start());
  betInput.addEventListener("input", updateAvailability);
  difficultyButtons.forEach((button) => button.addEventListener("click", () => selectDifficulty(button.dataset.towersDifficulty)));
  game.querySelectorAll("[data-towers-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.towersBetAction)));
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("focus", syncActive);
  window.addEventListener("gamrace:game-setting-changed", (event) => {
    if (event.detail?.game === "towers" && event.detail?.name === "turbo") renderBoard();
  });

  renderRound(null);
  loadHouseEdge();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
