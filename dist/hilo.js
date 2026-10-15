(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "hi-lo") return;
  const game = document.querySelector("#hilo-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Hi-Lo | GamRace";
  document.body.classList.add("hilo-active");
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const SETTINGS_KEY = "gamrace-game-settings-v1";
  const SUITS = ["♠", "♥", "♦", "♣"];
  const betInput = game.querySelector("#hilo-bet-amount");
  const actionButton = game.querySelector("#hilo-action");
  const cashoutButton = game.querySelector("#hilo-cashout");
  const higherButton = game.querySelector("#hilo-higher");
  const lowerButton = game.querySelector("#hilo-lower");
  const cardElement = game.querySelector("#hilo-current-card");
  const cardHistory = game.querySelector("#hilo-card-history");
  const roundLabel = game.querySelector("#hilo-round-label");
  const roundMultiplier = game.querySelector("#hilo-round-multiplier");
  const roundMeta = game.querySelector(".hilo-round-meta");
  const message = game.querySelector("#hilo-message");
  const resultStrip = game.querySelector("[data-hilo-result-strip]");
  const modeButtons = [...game.querySelectorAll("[data-hilo-mode]")];
  const autoOnlyFields = [...game.querySelectorAll("[data-hilo-auto-only]")];
  const autoStrategy = game.querySelector("#hilo-auto-strategy");
  const autoTarget = game.querySelector("#hilo-auto-target");
  const autoRoundCount = game.querySelector("#hilo-auto-round-count");
  const autoInfiniteButton = game.querySelector("#hilo-auto-infinite");
  const turboButton = game.querySelector("#hilo-turbo-toggle");
  const muteButton = game.querySelector("#hilo-mute-toggle");
  const toolButtons = [...game.querySelectorAll("[data-hilo-game-tool]")];
  const toolPanels = [...game.querySelectorAll("[data-hilo-game-tool-panel]")];
  const favoriteButton = game.querySelector('[data-hilo-game-favorite="hi-lo"]');

  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let selectedUsdRate = 0;
  let currentRound = null;
  let mode = "manual";
  let busy = false;
  let recoveryAttempted = false;
  let turbo = false;
  let muted = false;
  let autoRunning = false;
  let autoStopRequested = false;
  let autoInfinite = false;
  const recordedRounds = new Set();
  const displayWagers = new Map();
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0, cumulative: [] };

  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    turbo = Boolean(stored.turbo);
    muted = Boolean(stored.mute);
    autoInfinite = Boolean(stored.hiloAutoInfinite);
    if (["smart", "higher", "lower"].includes(stored.hiloStrategy)) autoStrategy.value = stored.hiloStrategy;
    if ([1, 2, 3, 4, 5, 6, 8, 10].includes(Number(stored.hiloTarget))) autoTarget.value = String(stored.hiloTarget);
  } catch { /* use safe defaults */ }

  function requestId() { return crypto.randomUUID().replaceAll("-", ""); }
  function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
  function minimumWager() { return displayFiat ? 0.01 : 0.00000001; }
  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }
  function rankLabel(rank) { return ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[rank] || String(rank); }
  function formatMultiplier(value) { return `${Number(value || 1).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}×`; }
  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }
  function setMessage(text = "") { message.textContent = text; message.hidden = !text; }
  function cashoutLabel(round) {
    if (!round || Number(round.guesses || 0) < 1) return "Cash Out";
    const originalDisplayWager = displayWagers.get(round.id);
    if (displayFiat && Number.isFinite(originalDisplayWager)) return `Cash Out · ${formatAmount(originalDisplayWager * Number(round.multiplier || 0))}`;
    if (displayFiat && selectedUsdRate > 0) return `Cash Out · ${formatAmount(Number(round.payout || 0) * selectedUsdRate)}`;
    return `Cash Out · ${round.payout} ${selectedSymbol}`;
  }

  function renderCard(card, animate = false) {
    if (!card) {
      cardElement.className = "hilo-card is-empty";
      cardElement.querySelectorAll(".hilo-card-corner strong").forEach((field) => { field.textContent = "?"; });
      return;
    }
    const suit = SUITS[Number(card.suit)] || "♠";
    const red = [1, 2].includes(Number(card.suit));
    cardElement.className = `hilo-card${red ? " is-red" : ""}`;
    cardElement.querySelectorAll(".hilo-card-corner strong").forEach((field) => { field.textContent = rankLabel(Number(card.rank)); });
    cardElement.querySelectorAll(".hilo-card-corner i").forEach((field) => { field.textContent = suit; });
    cardElement.querySelector(".hilo-card-suit").textContent = suit;
    if (animate) {
      cardElement.classList.remove("is-dealing");
      void cardElement.offsetWidth;
      cardElement.classList.add("is-dealing");
    }
  }

  function renderCardHistory(cards = []) {
    const visible = cards.slice(-7, -1);
    cardHistory.replaceChildren(...visible.map((card) => {
      const item = document.createElement("span");
      const suit = SUITS[Number(card.suit)] || "♠";
      item.className = `hilo-mini-card${[1, 2].includes(Number(card.suit)) ? " is-red" : ""}${card.won === false ? " is-loss" : ""}`;
      item.innerHTML = `<strong>${rankLabel(Number(card.rank))}</strong><i>${suit}</i>`;
      return item;
    }));
  }

  function renderRound(round = currentRound, animate = false) {
    currentRound = round;
    const active = round?.status === "active";
    roundMeta.hidden = !round;
    const card = round?.currentCard || null;
    renderCard(card, animate);
    renderCardHistory(round?.cards || []);
    const high = round?.choices?.higher;
    const low = round?.choices?.lower;
    game.querySelector("[data-hilo-high-chance]").textContent = high?.available === false ? "Unavailable on this card" : high ? `${Number(high.chance).toFixed(2)}% chance` : "—";
    game.querySelector("[data-hilo-low-chance]").textContent = low?.available === false ? "Unavailable on this card" : low ? `${Number(low.chance).toFixed(2)}% chance` : "—";
    game.querySelector("[data-hilo-high-multiplier]").textContent = high?.available === false ? "—" : high ? formatMultiplier(high.multiplier) : "—";
    game.querySelector("[data-hilo-low-multiplier]").textContent = low?.available === false ? "—" : low ? formatMultiplier(low.multiplier) : "—";
    roundMultiplier.textContent = round ? formatMultiplier(round.multiplier || 1) : "";
    if (!round) roundLabel.textContent = "";
    else if (active && Number(round.guesses) === 0) roundLabel.textContent = "Will the next card be higher or lower?";
    else if (active) roundLabel.textContent = `${round.guesses} correct · Keep playing or cash out`;
    else if (round.status === "cashed_out") roundLabel.textContent = `Cashed out at ${formatMultiplier(round.multiplier)}`;
    else roundLabel.textContent = "The next card ended this round";
    higherButton.disabled = !active || busy || autoRunning || high?.available === false;
    lowerButton.disabled = !active || busy || autoRunning || low?.available === false;
    cashoutButton.disabled = !active || Number(round?.guesses || 0) < 1 || busy || autoRunning;
    cashoutButton.textContent = active ? cashoutLabel(round) : "Cash Out";
    updateAvailability();
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const active = currentRound?.status === "active";
    const locked = busy || autoRunning || active;
    actionButton.textContent = autoRunning ? (autoStopRequested ? "Stopping…" : "Stop Autobet") : active ? "Round in Progress" : mode === "auto" ? "Start Autobet" : "Start Round";
    actionButton.disabled = autoRunning ? false : locked || !selectedCurrency || amount < minimumWager() || amount > availableBalance;
    betInput.disabled = locked;
    modeButtons.forEach((button) => { button.disabled = locked; });
    autoStrategy.disabled = locked;
    autoTarget.disabled = locked;
    autoRoundCount.disabled = locked || autoInfinite;
    autoInfiniteButton.disabled = locked;
    if (!locked && amount > availableBalance && amount > 0) setMessage("Your available balance is too low for that bet.");
    else if (!locked) setMessage();
  }

  function renderMode() {
    modeButtons.forEach((button) => {
      const active = button.dataset.hiloMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    autoOnlyFields.forEach((field) => { field.hidden = mode !== "auto"; });
    autoInfiniteButton.classList.toggle("active", autoInfinite);
    autoInfiniteButton.setAttribute("aria-pressed", String(autoInfinite));
    updateAvailability();
  }

  async function startRound() {
    const amount = cleanAmount();
    const response = await window.gamraceWallet.request("/games/hi-lo/rounds", {
      method: "POST",
      body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat }),
    });
    displayWagers.set(response.round.id, amount);
    window.gamraceWallet.applyGameResult(response);
    renderRound(response.round, true);
    return response.round;
  }

  async function makeGuess(direction) {
    const response = await window.gamraceWallet.request(`/games/hi-lo/rounds/${encodeURIComponent(currentRound.id)}/guess`, {
      method: "POST", body: JSON.stringify({ direction }),
    });
    window.gamraceWallet.applyGameResult(response);
    renderRound(response.round, true);
    if (response.round.status === "lost") finishRound(response.round);
    return response.round;
  }

  async function cashOut() {
    const response = await window.gamraceWallet.request(`/games/hi-lo/rounds/${encodeURIComponent(currentRound.id)}/cashout`, { method: "POST", body: "{}" });
    window.gamraceWallet.applyGameResult(response);
    renderRound(response.round);
    finishRound(response.round);
    return response.round;
  }

  function addResult(round) {
    if (!resultStrip) return;
    const pill = document.createElement("span");
    pill.className = `game-result-pill${round.status === "cashed_out" ? " win" : ""}`;
    pill.textContent = formatMultiplier(round.status === "cashed_out" ? round.multiplier : 0);
    resultStrip.hidden = false;
    resultStrip.append(pill);
    while (resultStrip.children.length > 10) resultStrip.firstElementChild.remove();
    resultStrip.scrollLeft = resultStrip.scrollWidth;
  }

  function renderSessionStats() {
    const values = { profit: sessionStats.profit, wagered: sessionStats.wagered, wins: sessionStats.wins, losses: sessionStats.losses };
    Object.entries(values).forEach(([name, value]) => {
      const field = game.querySelector(`[data-hilo-stat="${name}"]`);
      if (field) field.textContent = ["wins", "losses"].includes(name) ? String(value) : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    });
    const label = game.querySelector("[data-hilo-chart-label]");
    const line = game.querySelector("[data-hilo-chart-line]");
    const area = game.querySelector("[data-hilo-chart-area]");
    const zero = game.querySelector("[data-hilo-chart-zero]");
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
    zero.setAttribute("y1", zeroY); zero.setAttribute("y2", zeroY);
    label.textContent = `${sessionStats.cumulative.length} completed ${sessionStats.cumulative.length === 1 ? "round" : "rounds"}`;
  }

  function finishRound(round) {
    if (recordedRounds.has(round.id)) return;
    recordedRounds.add(round.id);
    const wager = displayWagers.get(round.id) ?? Number(round.wager || 0);
    const payout = round.status === "cashed_out" ? wager * Number(round.multiplier || 0) : 0;
    sessionStats.wagered += wager;
    sessionStats.profit += payout - wager;
    if (round.status === "cashed_out") sessionStats.wins += 1; else sessionStats.losses += 1;
    sessionStats.cumulative.push(sessionStats.profit);
    renderSessionStats();
    addResult(round);
    window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "hi-lo", wager, payout } }));
    window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
  }

  async function manualStart() {
    if (busy || currentRound?.status === "active" || !window.gamraceWallet?.request) return;
    busy = true; setMessage(); updateAvailability();
    try { await startRound(); await delay(turbo ? 80 : 500); }
    catch (error) { setMessage(error.message || "That Hi-Lo round could not be started."); }
    finally { busy = false; renderRound(currentRound); }
  }

  async function manualGuess(direction) {
    if (busy || autoRunning || currentRound?.status !== "active") return;
    busy = true; setMessage(); renderRound(currentRound);
    try { await makeGuess(direction); await delay(turbo ? 80 : 500); }
    catch (error) { setMessage(error.message || "That prediction could not be completed safely."); }
    finally { busy = false; renderRound(currentRound); }
  }

  async function manualCashout() {
    if (busy || autoRunning || currentRound?.status !== "active" || Number(currentRound.guesses) < 1) return;
    busy = true; setMessage(); renderRound(currentRound);
    try { await cashOut(); }
    catch (error) { setMessage(error.message || "That round could not be cashed out safely."); }
    finally { busy = false; renderRound(currentRound); }
  }

  function automaticDirection(round) {
    const requested = autoStrategy.value;
    if ((requested === "higher" || requested === "lower") && round.choices?.[requested]?.available !== false) return requested;
    const available = ["higher", "lower"].filter((direction) => round.choices?.[direction]?.available !== false);
    return available.sort((left, right) => Number(round.choices?.[right]?.chance || 0) - Number(round.choices?.[left]?.chance || 0))[0];
  }

  async function runAuto() {
    if (autoRunning || busy || currentRound?.status === "active") return;
    const amount = cleanAmount();
    if (!selectedCurrency || amount < minimumWager() || amount > availableBalance) return updateAvailability();
    autoRunning = true; autoStopRequested = false; updateAvailability();
    const rounds = autoInfinite ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(100, Number.parseInt(autoRoundCount.value || "1", 10) || 1));
    const target = Math.max(1, Number(autoTarget.value) || 1);
    try {
      let completed = 0;
      while (!autoStopRequested && completed < rounds) {
        if (cleanAmount() > availableBalance) { setMessage("Autobet stopped because your available balance is too low."); break; }
        try {
          let round = await startRound();
          while (!autoStopRequested && round.status === "active" && Number(round.guesses) < target) {
            await delay(turbo ? 90 : 520);
            round = await makeGuess(automaticDirection(round));
          }
          if (round.status === "active" && Number(round.guesses) >= target) round = await cashOut();
          completed += 1;
          if (!autoStopRequested && completed < rounds) await delay(turbo ? 100 : 420);
        } catch (error) { setMessage(error.message || "Autobet stopped because the round could not be completed."); break; }
      }
    } finally { autoRunning = false; autoStopRequested = false; renderRound(currentRound); }
  }

  async function restoreActiveRound() {
    if (recoveryAttempted || !selectedCurrency || !window.gamraceWallet?.request) return;
    recoveryAttempted = true;
    try {
      const response = await window.gamraceWallet.request(`/games/hi-lo/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.round) renderRound(response.round);
    } catch (error) { setMessage(error.message || "Your unfinished Hi-Lo round could not be restored yet."); recoveryAttempted = false; }
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    selectedUsdRate = Number(detail.balance.available || 0) > 0 ? (Number(detail.balance.usdCents || 0) / 100) / Number(detail.balance.available) : 0;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    betInput.min = minimumWager().toFixed(displayFiat ? 2 : 8);
    betInput.step = betInput.min;
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-hilo-currency]"), detail);
    const balanceLabel = game.querySelector("[data-hilo-balance]");
    if (balanceLabel) balanceLabel.textContent = formatAmount(availableBalance);
    if (changed) { recoveryAttempted = false; if (currentRound?.status === "active" && currentRound.currency !== selectedCurrency) currentRound = null; }
    renderRound(currentRound);
    restoreActiveRound();
  }

  function adjustBet(action) {
    const value = action === "half" ? cleanAmount() / 2 : cleanAmount() * 2;
    betInput.value = Math.min(availableBalance, value).toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  function persistSettings() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { settings = {}; }
    settings.turbo = turbo; settings.mute = muted; settings.hiloAutoInfinite = autoInfinite;
    settings.hiloStrategy = autoStrategy.value; settings.hiloTarget = Number(autoTarget.value);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    turboButton.setAttribute("aria-checked", String(turbo));
    muteButton.setAttribute("aria-checked", String(muted));
  }

  function closeTools() { toolPanels.forEach((panel) => { panel.hidden = true; }); toolButtons.forEach((button) => { button.classList.remove("active"); button.setAttribute("aria-expanded", "false"); }); }
  function toggleTool(name) {
    const panel = game.querySelector(`[data-hilo-game-tool-panel="${name}"]`);
    const button = game.querySelector(`[data-hilo-game-tool="${name}"]`);
    if (!panel || !button) return;
    const open = panel.hidden; closeTools();
    if (open) { panel.hidden = false; button.classList.add("active"); button.setAttribute("aria-expanded", "true"); }
  }
  function favoriteIds() { try { const value = JSON.parse(localStorage.getItem("gamrace-favourites-v1") || "[]"); return new Set(Array.isArray(value) ? value : []); } catch { return new Set(); } }
  function renderFavorite() { const active = favoriteIds().has("hi-lo"); favoriteButton.setAttribute("aria-pressed", String(active)); favoriteButton.setAttribute("aria-label", active ? "Remove Hi-Lo from favourites" : "Add Hi-Lo to favourites"); }
  function toggleFavorite() { const favorites = favoriteIds(); if (favorites.has("hi-lo")) favorites.delete("hi-lo"); else favorites.add("hi-lo"); localStorage.setItem("gamrace-favourites-v1", JSON.stringify([...favorites])); renderFavorite(); }

  persistSettings(); renderMode(); renderFavorite(); renderSessionStats(); renderRound(null);
  modeButtons.forEach((button) => button.addEventListener("click", () => { if (busy || autoRunning || currentRound?.status === "active") return; mode = button.dataset.hiloMode; renderMode(); }));
  autoInfiniteButton.addEventListener("click", () => { if (busy || autoRunning) return; autoInfinite = !autoInfinite; persistSettings(); renderMode(); });
  autoRoundCount.addEventListener("change", () => { autoRoundCount.value = String(Math.max(1, Math.min(100, Number.parseInt(autoRoundCount.value || "1", 10) || 1))); });
  autoStrategy.addEventListener("change", persistSettings); autoTarget.addEventListener("change", persistSettings);
  turboButton.addEventListener("click", () => { turbo = !turbo; persistSettings(); });
  muteButton.addEventListener("click", () => { muted = !muted; persistSettings(); });
  favoriteButton.addEventListener("click", toggleFavorite);
  toolButtons.forEach((button) => button.addEventListener("click", () => toggleTool(button.dataset.hiloGameTool)));
  game.querySelectorAll("[data-close-hilo-tool]").forEach((button) => button.addEventListener("click", closeTools));
  game.querySelectorAll("[data-hilo-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.hiloBetAction)));
  betInput.addEventListener("input", updateAvailability);
  higherButton.addEventListener("click", () => manualGuess("higher"));
  lowerButton.addEventListener("click", () => manualGuess("lower"));
  cashoutButton.addEventListener("click", manualCashout);
  actionButton.addEventListener("click", () => { if (autoRunning) { autoStopRequested = true; updateAvailability(); return; } if (mode === "auto") runAuto(); else manualStart(); });
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
