(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "plinko") return;
  const game = document.querySelector("#plinko-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Plinko | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const canvas = game.querySelector("#plinko-canvas");
  const context = canvas.getContext("2d");
  const payouts = game.querySelector("#plinko-payouts");
  const rowsSelect = game.querySelector("#plinko-rows");
  const betInput = game.querySelector("#plinko-bet-amount");
  const autoBetInput = game.querySelector("#plinko-auto-bet-amount");
  const autoRoundInput = game.querySelector("#plinko-auto-round-count");
  const actionButton = game.querySelector("#plinko-action");
  const autoActionButton = game.querySelector("#plinko-auto-action");
  const balanceLabel = game.querySelector("[data-plinko-balance]");
  const balanceMessage = game.querySelector("#plinko-balance-message");
  const result = game.querySelector("#plinko-result");
  const resultMultiplier = game.querySelector("#plinko-result-multiplier");
  const resultPayout = game.querySelector("#plinko-result-payout");

  let risk = "low";
  let mode = "manual";
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let betPending = false;
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let animationFrame = 0;

  for (let rows = 8; rows <= 16; rows += 1) {
    const option = document.createElement("option");
    option.value = String(rows);
    option.textContent = String(rows);
    option.selected = rows === 12;
    rowsSelect.append(option);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
  }

  function cleanAmount(input) {
    const value = Number.parseFloat(input.value);
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

  function choose(rows, bucket) {
    const k = Math.min(bucket, rows - bucket);
    let value = 1;
    for (let index = 1; index <= k; index += 1) value = value * (rows - k + index) / index;
    return value;
  }

  function multiplierTable(rowsValue, riskValue) {
    const rows = Number(rowsValue);
    let floor;
    let edge;
    let curve;
    if (riskValue === "low") {
      floor = 0.72;
      edge = 5.2 + 1.1 * (rows - 8);
      curve = 4;
    } else if (riskValue === "medium") {
      floor = 0.42;
      edge = 12 * 1.33 ** (rows - 8);
      curve = 6;
    } else {
      floor = 0.2;
      edge = 28 * 1.56 ** (rows - 8);
      curve = 8;
    }
    const raw = Array.from({ length: rows + 1 }, (_, bucket) => {
      const distance = Math.abs((2 * bucket - rows) / rows);
      return floor + (edge - floor) * distance ** curve;
    });
    const expected = raw.reduce((total, multiplier, bucket) => total + choose(rows, bucket) / 2 ** rows * multiplier, 0);
    return raw.map((multiplier) => Math.floor(multiplier * (0.99 / expected) * 1_000_000) / 1_000_000);
  }

  function multiplierText(value) {
    if (value >= 100) return `${value.toFixed(0)}×`;
    if (value >= 10) return `${value.toFixed(1)}×`;
    return `${value.toFixed(2)}×`;
  }

  function slotColor(index, rows) {
    const distance = Math.abs(index - rows / 2) / (rows / 2);
    const hue = 286 - distance * 252;
    return `hsl(${hue} 88% ${47 + distance * 7}%)`;
  }

  function renderPayouts(hitBucket = -1) {
    const rows = Number(rowsSelect.value);
    const multipliers = multiplierTable(rows, risk);
    payouts.style.setProperty("--plinko-slots", String(rows + 1));
    payouts.replaceChildren(...multipliers.map((multiplier, index) => {
      const slot = document.createElement("span");
      slot.className = `plinko-payout-slot${index === hitBucket ? " hit" : ""}`;
      slot.style.setProperty("--slot-color", slotColor(index, rows));
      slot.textContent = multiplierText(multiplier);
      slot.title = `${multiplier.toFixed(6)}×`;
      return slot;
    }));
  }

  function boardGeometry(rows) {
    const left = 96;
    const right = canvas.width - 96;
    const top = 54;
    const bottom = canvas.height - 30;
    return { center: canvas.width / 2, top, bottom, rowGap: (bottom - top) / rows, slotGap: (right - left) / rows };
  }

  function drawBoard(ball = null) {
    const rows = Number(rowsSelect.value);
    const geometry = boardGeometry(rows);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const glow = context.createRadialGradient(geometry.center, canvas.height * .48, 10, geometry.center, canvas.height * .48, canvas.width * .46);
    glow.addColorStop(0, "rgba(113, 47, 255, .12)");
    glow.addColorStop(.55, "rgba(0, 186, 255, .06)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < rows; row += 1) {
      const y = geometry.top + row * geometry.rowGap;
      for (let peg = 0; peg <= row; peg += 1) {
        const x = geometry.center + (peg - row / 2) * geometry.slotGap;
        const colour = slotColor(peg / Math.max(1, row) * rows, rows);
        context.beginPath();
        context.arc(x, y, rows > 13 ? 4.6 : 5.5, 0, Math.PI * 2);
        context.fillStyle = colour;
        context.shadowColor = colour;
        context.shadowBlur = 11;
        context.fill();
      }
    }
    context.shadowBlur = 0;
    if (!ball) return;
    context.beginPath();
    context.arc(ball.x, ball.y, 10, 0, Math.PI * 2);
    const ballFill = context.createRadialGradient(ball.x - 3, ball.y - 4, 1, ball.x, ball.y, 12);
    ballFill.addColorStop(0, "#ffffff");
    ballFill.addColorStop(.25, "#8eeaff");
    ballFill.addColorStop(1, "#078bd4");
    context.fillStyle = ballFill;
    context.shadowColor = "#37d8ff";
    context.shadowBlur = 18;
    context.fill();
    context.shadowBlur = 0;
  }

  function animatePath(path) {
    cancelAnimationFrame(animationFrame);
    const rows = path.length;
    const geometry = boardGeometry(rows);
    const points = [{ x: geometry.center, y: geometry.top - geometry.rowGap * .8 }];
    let rights = 0;
    path.forEach((step, index) => {
      rights += step;
      points.push({
        x: geometry.center + (rights - (index + 1) / 2) * geometry.slotGap,
        y: geometry.top + index * geometry.rowGap,
      });
    });
    points.push({ x: geometry.center + (rights - rows / 2) * geometry.slotGap, y: geometry.bottom });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawBoard(points.at(-1));
      return Promise.resolve();
    }
    const duration = Math.max(900, rows * 92);
    return new Promise((resolve) => {
      const started = performance.now();
      const frame = (timestamp) => {
        const progress = Math.min(1, (timestamp - started) / duration);
        const scaled = progress * (points.length - 1);
        const segment = Math.min(points.length - 2, Math.floor(scaled));
        const local = scaled - segment;
        const eased = .5 - Math.cos(local * Math.PI) / 2;
        const from = points[segment];
        const to = points[segment + 1];
        const arc = Math.sin(local * Math.PI) * Math.min(10, geometry.rowGap * .2);
        drawBoard({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * local - arc });
        if (progress < 1) animationFrame = requestAnimationFrame(frame);
        else resolve();
      };
      animationFrame = requestAnimationFrame(frame);
    });
  }

  function updateAvailability() {
    const manual = cleanAmount(betInput);
    const auto = cleanAmount(autoBetInput);
    const minimum = minimumWager();
    actionButton.disabled = betPending || autoplayRunning || manual < minimum || manual > availableBalance;
    autoActionButton.disabled = betPending || (!autoplayRunning && (auto < minimum || auto > availableBalance));
    balanceLabel.textContent = formatAmount(availableBalance);
    const current = mode === "auto" ? auto : manual;
    if (current > availableBalance && current > 0) {
      balanceMessage.textContent = `Insufficient ${selectedSymbol} balance.`;
      balanceMessage.hidden = false;
    } else {
      balanceMessage.hidden = true;
    }
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    const minimum = minimumWager();
    [betInput, autoBetInput].forEach((input) => { input.min = minimum.toFixed(displayFiat ? 2 : 8); input.step = input.min; });
    game.querySelectorAll("[data-plinko-currency]").forEach((field) => { field.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    updateAvailability();
  }

  function adjustBet(input, action) {
    const amount = cleanAmount(input);
    input.value = Math.min(availableBalance, action === "half" ? amount / 2 : amount * 2).toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function dropBall(amount) {
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      balanceMessage.textContent = "Sign in and wait for your wallet to load before betting.";
      balanceMessage.hidden = false;
      return null;
    }
    if (amount < minimumWager() || amount > availableBalance) return null;
    betPending = true;
    result.hidden = true;
    renderPayouts();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/plinko/bets", {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID().replaceAll("-", ""), currency: selectedCurrency,
          wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat,
          rows: Number(rowsSelect.value), risk,
        }),
      });
      await animatePath(response.bet.path || []);
      window.gamraceWallet.applyGameResult(response);
      const multiplier = Number(response.bet.multiplier || 0);
      const payout = amount * multiplier;
      renderPayouts(Number(response.bet.bucket));
      resultMultiplier.textContent = `${multiplier.toFixed(2)}×`;
      resultPayout.textContent = formatAmount(payout);
      result.classList.toggle("loss", response.bet.outcome !== "win");
      result.hidden = false;
      return response.bet;
    } catch (error) {
      balanceMessage.textContent = error.message || "The Plinko bet could not be completed.";
      balanceMessage.hidden = false;
      return null;
    } finally {
      betPending = false;
      updateAvailability();
    }
  }

  async function runAutoplay() {
    if (autoplayRunning) {
      stopAutoplayRequested = true;
      autoActionButton.textContent = "Stopping…";
      return;
    }
    const rounds = Math.round(clamp(autoRoundInput.value, 1, 100));
    const amount = cleanAmount(autoBetInput);
    if (amount < minimumWager() || amount > availableBalance) return;
    autoplayRunning = true;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Stop Autoplay";
    updateAvailability();
    for (let index = 0; index < rounds && !stopAutoplayRequested; index += 1) {
      if (!await dropBall(amount)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    autoplayRunning = false;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Start Autoplay";
    updateAvailability();
  }

  game.querySelectorAll("[data-plinko-mode]").forEach((tab) => tab.addEventListener("click", () => {
    if (autoplayRunning) return;
    mode = tab.dataset.plinkoMode;
    game.querySelectorAll("[data-plinko-mode]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    game.querySelectorAll("[data-plinko-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.plinkoModePanel !== mode; });
    updateAvailability();
  }));
  game.querySelectorAll("[data-plinko-risk]").forEach((button) => button.addEventListener("click", () => {
    if (betPending || autoplayRunning) return;
    risk = button.dataset.plinkoRisk;
    game.querySelectorAll("[data-plinko-risk]").forEach((item) => item.classList.toggle("active", item === button));
    result.hidden = true;
    renderPayouts();
  }));
  game.querySelectorAll("[data-plinko-history-view]").forEach((tab) => tab.addEventListener("click", () => {
    game.querySelectorAll("[data-plinko-history-view]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
  }));
  game.querySelectorAll("[data-plinko-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(betInput, button.dataset.plinkoBetAction)));
  game.querySelectorAll("[data-plinko-auto-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(autoBetInput, button.dataset.plinkoAutoBetAction)));
  rowsSelect.addEventListener("change", () => { result.hidden = true; renderPayouts(); drawBoard(); });
  betInput.addEventListener("input", updateAvailability);
  autoBetInput.addEventListener("input", updateAvailability);
  actionButton.addEventListener("click", () => dropBall(cleanAmount(betInput)));
  autoActionButton.addEventListener("click", runAutoplay);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("resize", () => drawBoard());

  renderPayouts();
  drawBoard();
  updateAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
