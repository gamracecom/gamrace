(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "wheel") return;
  const game = document.querySelector("#wheel-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Wheel | GamRace";
  document.body.classList.add("wheel-active");
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const SETTINGS_KEY = "gamrace-game-settings-v1";
  const TAU = Math.PI * 2;
  const SEGMENT_OPTIONS = [10, 20, 30, 40, 50];
  const LOW_PATTERN = [1.08, 1.12, 1.18, 1.07, 0.5];
  const MEDIUM_PATTERN = [1.5, 0, 1.8, 0, 2.4, 0, 1.5, 0, 2.7, 0];
  const canvas = game.querySelector("#wheel-canvas");
  const context = canvas.getContext("2d");
  const betInput = game.querySelector("#wheel-bet-amount");
  const segmentsSelect = game.querySelector("#wheel-segments");
  const modeButtons = [...game.querySelectorAll("[data-wheel-mode]")];
  const riskButtons = [...game.querySelectorAll("[data-wheel-risk]")];
  const autoOnlyFields = [...game.querySelectorAll("[data-wheel-auto-only]")];
  const autoRoundCount = game.querySelector("#wheel-auto-round-count");
  const autoInfiniteButton = game.querySelector("#wheel-auto-infinite");
  const actionButton = game.querySelector("#wheel-action");
  const message = game.querySelector("#wheel-message");
  const result = game.querySelector("#wheel-result");
  const resultMultiplier = game.querySelector("#wheel-result-multiplier");
  const resultPayout = game.querySelector("#wheel-result-payout");
  const legend = game.querySelector("#wheel-legend");
  const turboButton = game.querySelector("#wheel-turbo-toggle");
  const muteButton = game.querySelector("#wheel-mute-toggle");
  const toolButtons = [...game.querySelectorAll("[data-wheel-game-tool]")];
  const toolPanels = [...game.querySelectorAll("[data-wheel-game-tool-panel]")];
  const favoriteButton = game.querySelector('[data-wheel-game-favorite="wheel"]');
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let mode = "manual";
  let risk = "low";
  let segmentCount = 20;
  let rotation = 0;
  let busy = false;
  let recoveryAttempted = false;
  let turbo = false;
  let muted = false;
  let autoRunning = false;
  let autoStopRequested = false;
  let autoInfinite = false;
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0, cumulative: [] };

  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    turbo = Boolean(stored.turbo);
    muted = Boolean(stored.mute);
    autoInfinite = Boolean(stored.wheelAutoInfinite);
    if (["low", "medium", "high"].includes(stored.wheelRisk)) risk = stored.wheelRisk;
    if (SEGMENT_OPTIONS.includes(Number(stored.wheelSegments))) segmentCount = Number(stored.wheelSegments);
  } catch { /* use safe defaults */ }

  function multipliersFor(segments = segmentCount, level = risk) {
    if (level === "low") return Array.from({ length: segments }, (_, index) => LOW_PATTERN[index % LOW_PATTERN.length]);
    if (level === "medium") return Array.from({ length: segments }, (_, index) => MEDIUM_PATTERN[index % MEDIUM_PATTERN.length]);
    return Array.from({ length: segments }, (_, index) => index === segments - 1 ? segments * 0.99 : 0);
  }

  function formatMultiplier(value) {
    return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function formatCoinAmount(value) {
    return `${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function requestId() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
  }

  function cleanAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function setMessage(text = "") {
    message.textContent = text;
    message.hidden = !text;
  }

  function segmentPalette(multiplier, index) {
    if (risk === "high") return multiplier > 0 ? ["#f5b942", "#bf7d16"] : index % 2 ? ["#20252d", "#171b21"] : ["#292f38", "#1d2229"];
    if (multiplier === 0) return index % 2 ? ["#262b33", "#1b1f25"] : ["#313741", "#22272e"];
    if (multiplier < 1) return ["#4e3037", "#342126"];
    const palettes = risk === "medium"
      ? [["#2f80ff", "#1858bd"], ["#15c7d9", "#087e91"], ["#8b5cf6", "#5834ad"]]
      : [["#249cff", "#176eb2"], ["#25c5d8", "#117d8d"], ["#5972e8", "#34469e"]];
    return palettes[index % palettes.length];
  }

  function drawWheel(angle = rotation) {
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 18;
    const values = multipliersFor();
    const arc = TAU / values.length;
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(center, center);
    context.rotate(angle);
    values.forEach((multiplier, index) => {
      const start = -Math.PI / 2 + index * arc;
      const end = start + arc;
      const [outer, inner] = segmentPalette(multiplier, index);
      const gradient = context.createRadialGradient(0, 0, radius * .18, 0, 0, radius);
      gradient.addColorStop(0, inner);
      gradient.addColorStop(1, outer);
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius, start, end);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.strokeStyle = "#0d1014";
      context.lineWidth = values.length >= 40 ? 2 : 4;
      context.stroke();

      const shouldLabel = values.length <= 20 || multiplier > 2.7 || (values.length <= 30 && index % 2 === 0);
      if (shouldLabel) {
        const labelAngle = start + arc / 2;
        context.save();
        context.rotate(labelAngle);
        context.translate(radius * .67, 0);
        if (Math.cos(labelAngle) < 0) context.rotate(Math.PI);
        context.fillStyle = multiplier > 0 ? "#ffffff" : "#9ba2ad";
        context.font = `800 ${values.length >= 30 ? 15 : values.length >= 20 ? 18 : 22}px Inter, Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(multiplier === 0 ? "0×" : formatMultiplier(multiplier), 0, 0);
        context.restore();
      }
    });
    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.strokeStyle = "#3b424d";
    context.lineWidth = 8;
    context.stroke();
    context.restore();
  }

  function renderLegend() {
    const counts = new Map();
    multipliersFor().forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    legend.replaceChildren(...[...counts.entries()].sort((left, right) => right[0] - left[0]).map(([value, count]) => {
      const item = document.createElement("span");
      item.innerHTML = `<i style="--wheel-key:${segmentPalette(value, 0)[0]}"></i><strong>${formatMultiplier(value)}</strong><small>${count} segment${count === 1 ? "" : "s"}</small>`;
      return item;
    }));
    canvas.setAttribute("aria-label", `Wheel with ${segmentCount} payout segments at ${risk} risk`);
  }

  function renderWheel() {
    drawWheel(rotation);
    renderLegend();
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const locked = busy || autoRunning;
    actionButton.textContent = autoRunning ? (autoStopRequested ? "Stopping…" : "Stop Autobet") : mode === "auto" ? "Start Autobet" : "Spin Wheel";
    actionButton.disabled = autoRunning ? false : busy || !selectedCurrency || amount < minimumWager() || amount > availableBalance;
    betInput.disabled = locked;
    segmentsSelect.disabled = locked;
    riskButtons.forEach((button) => { button.disabled = locked; });
    modeButtons.forEach((button) => { button.disabled = locked; });
    if (autoRoundCount) autoRoundCount.disabled = locked || autoInfinite;
    if (autoInfiniteButton) autoInfiniteButton.disabled = locked;
    if (!locked && amount > availableBalance && amount > 0) setMessage("Your available balance is too low for that bet.");
    else if (!locked) setMessage();
  }

  function renderMode() {
    modeButtons.forEach((button) => {
      const active = button.dataset.wheelMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    autoOnlyFields.forEach((field) => { field.hidden = mode !== "auto"; });
    autoInfiniteButton.classList.toggle("active", autoInfinite);
    autoInfiniteButton.setAttribute("aria-pressed", String(autoInfinite));
    game.dataset.wheelMode = mode;
    updateAvailability();
  }

  function deterministicOffset(id, arc) {
    let hash = 0;
    for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return (((hash % 1001) / 1000) - .5) * arc * .46;
  }

  function animateWheel(bet) {
    const segments = Number(bet.segments);
    const arc = TAU / segments;
    const offset = deterministicOffset(bet.id, arc);
    const targetModulo = ((-(Number(bet.resultIndex) + .5) * arc - offset) % TAU + TAU) % TAU;
    const currentModulo = ((rotation % TAU) + TAU) % TAU;
    const turns = turbo || reduceMotion.matches ? 1 : 7;
    const target = rotation + ((targetModulo - currentModulo + TAU) % TAU) + turns * TAU;
    const duration = turbo || reduceMotion.matches ? 520 : 4200;
    const started = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const elapsed = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - elapsed) ** 4;
        const start = target - (((targetModulo - currentModulo + TAU) % TAU) + turns * TAU);
        rotation = start + (target - start) * eased;
        drawWheel(rotation);
        if (elapsed < 1) requestAnimationFrame(frame);
        else {
          rotation = ((target % TAU) + TAU) % TAU;
          drawWheel(rotation);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function settleBet(bet) {
    const response = await window.gamraceWallet.request(`/games/wheel/bets/${encodeURIComponent(bet.id)}/settle`, { method: "POST", body: "{}" });
    window.gamraceWallet.applyGameResult(response);
    window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
    return response.bet;
  }

  function showResult(bet) {
    resultMultiplier.textContent = formatMultiplier(bet.multiplier);
    resultPayout.textContent = formatCoinAmount(bet.payout);
    result.classList.toggle("win", bet.outcome === "win");
    result.classList.toggle("loss", bet.outcome !== "win");
    result.hidden = false;
  }

  function renderSessionStats() {
    const values = { profit: sessionStats.profit, wagered: sessionStats.wagered, wins: sessionStats.wins, losses: sessionStats.losses };
    Object.entries(values).forEach(([name, value]) => {
      const field = game.querySelector(`[data-wheel-stat="${name}"]`);
      if (field) field.textContent = ["wins", "losses"].includes(name) ? String(value) : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    });
    const label = game.querySelector("[data-wheel-chart-label]");
    const line = game.querySelector("[data-wheel-chart-line]");
    const area = game.querySelector("[data-wheel-chart-area]");
    const zero = game.querySelector("[data-wheel-chart-zero]");
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
    sessionStats.wagered += amount;
    sessionStats.profit += payout - amount;
    if (bet.outcome === "win") sessionStats.wins += 1;
    else sessionStats.losses += 1;
    sessionStats.cumulative.push(sessionStats.profit);
    renderSessionStats();
  }

  async function play(existingBet = null) {
    if (busy || !window.gamraceWallet?.request) return false;
    const amount = cleanAmount();
    if (!existingBet && (amount < minimumWager() || amount > availableBalance)) return false;
    busy = true;
    result.hidden = true;
    setMessage();
    updateAvailability();
    try {
      let bet = existingBet;
      if (!bet) {
        const response = await window.gamraceWallet.request("/games/wheel/bets", {
          method: "POST",
          body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, risk, segments: segmentCount }),
        });
        bet = response.bet;
        window.gamraceWallet.applyGameResult(response);
      } else {
        if (["low", "medium", "high"].includes(bet.risk)) risk = bet.risk;
        if (SEGMENT_OPTIONS.includes(Number(bet.segments))) segmentCount = Number(bet.segments);
        segmentsSelect.value = String(segmentCount);
        persistSettings();
        renderWheel();
      }
      const displayedWager = existingBet ? Number(bet.wager || 0) : amount;
      await animateWheel(bet);
      const settled = await settleBet(bet);
      showResult(settled);
      recordBet(displayedWager, settled);
      return true;
    } catch (error) {
      setMessage(error.message || "That Wheel bet could not be completed. It will be restored safely.");
      return false;
    } finally {
      busy = false;
      updateAvailability();
    }
  }

  async function runAuto() {
    if (autoRunning || busy) return;
    const amount = cleanAmount();
    if (!selectedCurrency || amount < minimumWager() || amount > availableBalance) return updateAvailability();
    autoRunning = true;
    autoStopRequested = false;
    const rounds = autoInfinite ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(100, Number.parseInt(autoRoundCount.value || "1", 10) || 1));
    if (!autoInfinite) autoRoundCount.value = String(rounds);
    updateAvailability();
    try {
      let completed = 0;
      while (!autoStopRequested && completed < rounds) {
        if (cleanAmount() > availableBalance) {
          setMessage("Autobet stopped because your available balance is too low.");
          break;
        }
        if (!await play()) break;
        completed += 1;
        if (!autoStopRequested && completed < rounds) await delay(turbo ? 80 : 260);
      }
    } finally {
      autoRunning = false;
      autoStopRequested = false;
      updateAvailability();
    }
  }

  async function restoreActiveBet() {
    if (recoveryAttempted || !selectedCurrency || !window.gamraceWallet?.request) return;
    recoveryAttempted = true;
    try {
      const response = await window.gamraceWallet.request(`/games/wheel/bets/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.bet) await play(response.bet);
    } catch (error) {
      setMessage(error.message || "Your unfinished Wheel bet could not be restored yet.");
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
    game.querySelectorAll("[data-wheel-currency]").forEach((element) => { element.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    const balanceLabel = game.querySelector("[data-wheel-balance]");
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
    settings.wheelRisk = risk;
    settings.wheelSegments = segmentCount;
    settings.wheelAutoInfinite = autoInfinite;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    turboButton.setAttribute("aria-checked", String(turbo));
    muteButton.setAttribute("aria-checked", String(muted));
    game.dataset.muted = String(muted);
    riskButtons.forEach((button) => {
      const active = button.dataset.wheelRisk === risk;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function closeTools() {
    toolPanels.forEach((panel) => { panel.hidden = true; });
    toolButtons.forEach((button) => { button.classList.remove("active"); button.setAttribute("aria-expanded", "false"); });
  }

  function toggleTool(name) {
    const panel = game.querySelector(`[data-wheel-game-tool-panel="${name}"]`);
    const button = game.querySelector(`[data-wheel-game-tool="${name}"]`);
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
    const active = favoriteIds().has("wheel");
    favoriteButton.setAttribute("aria-pressed", String(active));
    favoriteButton.setAttribute("aria-label", active ? "Remove Wheel from favourites" : "Add Wheel to favourites");
  }

  function toggleFavorite() {
    const favorites = favoriteIds();
    if (favorites.has("wheel")) favorites.delete("wheel"); else favorites.add("wheel");
    localStorage.setItem("gamrace-favourites-v1", JSON.stringify([...favorites]));
    renderFavorite();
  }

  segmentsSelect.value = String(segmentCount);
  persistSettings();
  renderMode();
  renderFavorite();
  renderSessionStats();
  renderWheel();

  riskButtons.forEach((button) => button.addEventListener("click", () => {
    if (busy || autoRunning || !["low", "medium", "high"].includes(button.dataset.wheelRisk)) return;
    risk = button.dataset.wheelRisk;
    result.hidden = true;
    persistSettings();
    renderWheel();
  }));
  segmentsSelect.addEventListener("change", () => {
    if (busy || autoRunning) return;
    const selected = Number(segmentsSelect.value);
    if (SEGMENT_OPTIONS.includes(selected)) segmentCount = selected;
    rotation = 0;
    result.hidden = true;
    persistSettings();
    renderWheel();
  });
  modeButtons.forEach((button) => button.addEventListener("click", () => {
    if (busy || autoRunning || !["manual", "auto"].includes(button.dataset.wheelMode)) return;
    mode = button.dataset.wheelMode;
    renderMode();
  }));
  autoInfiniteButton.addEventListener("click", () => {
    if (busy || autoRunning) return;
    autoInfinite = !autoInfinite;
    persistSettings();
    renderMode();
  });
  autoRoundCount.addEventListener("change", () => { autoRoundCount.value = String(Math.max(1, Math.min(100, Number.parseInt(autoRoundCount.value || "1", 10) || 1))); });
  turboButton.addEventListener("click", () => { turbo = !turbo; persistSettings(); });
  muteButton.addEventListener("click", () => { muted = !muted; persistSettings(); });
  favoriteButton.addEventListener("click", toggleFavorite);
  toolButtons.forEach((button) => button.addEventListener("click", () => toggleTool(button.dataset.wheelGameTool)));
  game.querySelectorAll("[data-close-wheel-tool]").forEach((button) => button.addEventListener("click", closeTools));
  game.querySelectorAll("[data-wheel-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.wheelBetAction)));
  betInput.addEventListener("input", updateAvailability);
  actionButton.addEventListener("click", () => {
    if (autoRunning) { autoStopRequested = true; updateAvailability(); return; }
    if (mode === "auto") runAuto(); else play();
  });
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
