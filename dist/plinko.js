(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "plinko") return;
  const game = document.querySelector("#plinko-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Plinko | GamRace";
  document.body.classList.add("plinko-active");
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
  let reservedBalance = 0;
  let activeRequests = 0;
  let autoplayRunning = false;
  let stopAutoplayRequested = false;
  let animationFrame = 0;
  let nextBallId = 0;
  const activeBalls = new Map();

  for (let rows = 8; rows <= 16; rows += 1) {
    const option = document.createElement("option");
    option.value = String(rows);
    option.textContent = String(rows);
    option.selected = rows === 12;
    rowsSelect.append(option);
  }

  const historyBody = game.querySelector(".plinko-history tbody");
  while (historyBody && historyBody.rows.length < 5) {
    const row = historyBody.rows[0].cloneNode(true);
    historyBody.append(row);
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

  function spendableBalance() {
    return Math.max(0, Math.round((availableBalance - reservedBalance) * 100000000) / 100000000);
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

  function renderPayouts() {
    const rows = Number(rowsSelect.value);
    const multipliers = multiplierTable(rows, risk);
    payouts.style.setProperty("--plinko-slots", String(rows + 1));
    payouts.replaceChildren(...multipliers.map((multiplier, index) => {
      const slot = document.createElement("span");
      slot.className = "plinko-payout-slot";
      slot.style.setProperty("--slot-color", slotColor(index, rows));
      slot.textContent = multiplierText(multiplier);
      slot.title = `${multiplier.toFixed(6)}×`;
      return slot;
    }));
  }

  function highlightPayout(bucket) {
    const slot = payouts.children[Number(bucket)];
    if (!slot) return;
    const hits = Number(slot.dataset.hits || 0) + 1;
    slot.dataset.hits = String(hits);
    slot.classList.add("hit");
    window.setTimeout(() => {
      const remaining = Math.max(0, Number(slot.dataset.hits || 1) - 1);
      slot.dataset.hits = String(remaining);
      if (!remaining) slot.classList.remove("hit");
    }, 520);
  }

  function boardGeometry(rows) {
    const side = 24;
    const top = 48;
    const pegBottom = canvas.height - 104;
    const slotGap = (canvas.width - side * 2) / (rows + 1);
    return {
      center: canvas.width / 2,
      top,
      pegBottom,
      cupY: canvas.height - 28,
      rowGap: rows > 1 ? (pegBottom - top) / (rows - 1) : 0,
      slotGap,
    };
  }

  function drawPeg(x, y, colour, radius) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
    context.beginPath();
    context.arc(x - radius * .25, y - radius * .28, radius * .32, 0, Math.PI * 2);
    context.fillStyle = "rgba(255,255,255,.46)";
    context.fill();
  }

  function drawBall(ball) {
    if (ball.collision) {
      context.beginPath();
      context.arc(ball.collision.x, ball.collision.y, 8 + 12 * ball.collision.strength, 0, Math.PI * 2);
      context.strokeStyle = `rgba(63, 207, 255, ${.42 * (1 - ball.collision.strength)})`;
      context.lineWidth = 2;
      context.stroke();
    }
    context.beginPath();
    context.arc(ball.x, ball.y, 9, 0, Math.PI * 2);
    const fill = context.createRadialGradient(ball.x - 3, ball.y - 4, 1, ball.x, ball.y, 11);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(.28, "#8eeaff");
    fill.addColorStop(1, "#078bd4");
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = "#58cfff";
    context.stroke();
  }

  function drawBoard(balls = []) {
    const rows = activeBalls.size ? activeBalls.values().next().value.rows : Number(rowsSelect.value);
    const geometry = boardGeometry(rows);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < rows; row += 1) {
      const y = geometry.top + row * geometry.rowGap;
      for (let peg = 0; peg <= row; peg += 1) {
        const x = geometry.center + (peg - row / 2) * geometry.slotGap;
        drawPeg(x, y, "#64bedf", rows > 13 ? 4.1 : 4.8);
      }
    }
    balls.forEach(drawBall);
  }

  function buildBallPoints(path) {
    const rows = path.length;
    const geometry = boardGeometry(rows);
    const points = [{ x: geometry.center, y: geometry.top - 34, peg: null }];
    let rights = 0;
    path.forEach((step, index) => {
      const pegX = geometry.center + (rights - index / 2) * geometry.slotGap;
      const pegY = geometry.top + index * geometry.rowGap;
      points.push({ x: pegX, y: pegY - 10, peg: { x: pegX, y: pegY }, direction: step ? 1 : -1 });
      rights += step;
    });
    points.push({
      x: geometry.center + (rights - rows / 2) * geometry.slotGap,
      y: geometry.cupY,
      peg: null,
      direction: 0,
    });
    return points;
  }

  function ballPosition(ball, timestamp) {
    const progress = Math.min(1, (timestamp - ball.startedAt) / ball.duration);
    const scaled = progress * (ball.points.length - 1);
    const segment = Math.min(ball.points.length - 2, Math.floor(scaled));
    const local = scaled - segment;
    const from = ball.points[segment];
    const to = ball.points[segment + 1];
    const eased = .5 - Math.cos(local * Math.PI) / 2;
    const direction = to.direction || Math.sign(to.x - from.x) || 1;
    const bounce = Math.sin(local * Math.PI);
    const collision = to.peg && local > .78 ? {
      x: to.peg.x,
      y: to.peg.y,
      strength: (local - .78) / .22,
    } : null;
    return {
      x: from.x + (to.x - from.x) * eased + direction * bounce * 4,
      y: from.y + (to.y - from.y) * local - bounce * 3,
      collision,
      complete: progress >= 1,
    };
  }

  function animateBalls(timestamp) {
    const visible = [];
    activeBalls.forEach((ball, id) => {
      const position = ballPosition(ball, timestamp);
      visible.push(position);
      if (position.complete) {
        activeBalls.delete(id);
        highlightPayout(ball.bucket);
        ball.resolve();
      }
    });
    drawBoard(visible);
    if (activeBalls.size) animationFrame = requestAnimationFrame(animateBalls);
    else {
      animationFrame = 0;
      updateAvailability();
    }
  }

  function animatePath(path, bucket) {
    if (!Array.isArray(path) || !path.length) return Promise.resolve();
    const points = buildBallPoints(path);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      highlightPayout(bucket);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const id = ++nextBallId;
      activeBalls.set(id, {
        id,
        rows: path.length,
        bucket: Number(bucket),
        points,
        startedAt: performance.now(),
        duration: Math.max(980, path.length * 96),
        resolve,
      });
      if (!animationFrame) animationFrame = requestAnimationFrame(animateBalls);
      updateAvailability();
    });
  }

  function boardBusy() {
    return activeRequests > 0 || activeBalls.size > 0 || autoplayRunning;
  }

  function updateAvailability() {
    const manual = cleanAmount(betInput);
    const auto = cleanAmount(autoBetInput);
    const minimum = minimumWager();
    const spendable = spendableBalance();
    actionButton.disabled = autoplayRunning || manual < minimum || manual > spendable;
    autoActionButton.disabled = !autoplayRunning && (auto < minimum || auto > spendable);
    balanceLabel.textContent = formatAmount(spendable);
    rowsSelect.disabled = boardBusy();
    game.querySelectorAll("[data-plinko-risk]").forEach((button) => { button.disabled = boardBusy(); });
    const current = mode === "auto" ? auto : manual;
    if (current > spendable && current > 0) {
      balanceMessage.textContent = `Insufficient ${selectedSymbol} balance.`;
      balanceMessage.hidden = false;
    } else if (!balanceMessage.dataset.error) {
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
    [betInput, autoBetInput].forEach((input) => {
      input.min = minimum.toFixed(displayFiat ? 2 : 8);
      input.step = input.min;
    });
    game.querySelectorAll("[data-plinko-currency]").forEach((field) => { field.textContent = displayFiat ? "$" : selectedSymbol.slice(0, 4); });
    updateAvailability();
  }

  function adjustBet(input, action) {
    const amount = cleanAmount(input);
    input.value = Math.min(spendableBalance(), action === "half" ? amount / 2 : amount * 2).toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function dropBall(amount) {
    if (!selectedCurrency || !window.gamraceWallet?.request) {
      balanceMessage.dataset.error = "true";
      balanceMessage.textContent = "Sign in and wait for your wallet to load before betting.";
      balanceMessage.hidden = false;
      return null;
    }
    if (amount < minimumWager() || amount > spendableBalance()) {
      updateAvailability();
      return null;
    }

    const rows = Number(rowsSelect.value);
    const selectedRisk = risk;
    reservedBalance = Math.round((reservedBalance + amount) * 100000000) / 100000000;
    activeRequests += 1;
    delete balanceMessage.dataset.error;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/plinko/bets", {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID().replaceAll("-", ""),
          currency: selectedCurrency,
          wager: amount.toFixed(displayFiat ? 2 : 8),
          displayFiat,
          rows,
          risk: selectedRisk,
        }),
      });
      reservedBalance = Math.max(0, Math.round((reservedBalance - amount) * 100000000) / 100000000);
      activeRequests = Math.max(0, activeRequests - 1);
      window.gamraceWallet.applyGameResult(response);
      const multiplier = Number(response.bet.multiplier || 0);
      const payout = amount * multiplier;
      resultMultiplier.textContent = `${multiplier.toFixed(2)}×`;
      resultPayout.textContent = formatAmount(payout);
      result.classList.toggle("loss", response.bet.outcome !== "win");
      result.hidden = false;
      animatePath(response.bet.path || [], response.bet.bucket);
      updateAvailability();
      return response.bet;
    } catch (error) {
      reservedBalance = Math.max(0, Math.round((reservedBalance - amount) * 100000000) / 100000000);
      activeRequests = Math.max(0, activeRequests - 1);
      balanceMessage.dataset.error = "true";
      balanceMessage.textContent = error.message || "The Plinko bet could not be completed.";
      balanceMessage.hidden = false;
      updateAvailability();
      return null;
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
    if (amount < minimumWager() || amount > spendableBalance()) return;
    autoplayRunning = true;
    stopAutoplayRequested = false;
    autoActionButton.textContent = "Stop Autoplay";
    updateAvailability();
    for (let index = 0; index < rounds && !stopAutoplayRequested; index += 1) {
      if (amount > spendableBalance() || !await dropBall(amount)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 90));
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
    if (boardBusy()) return;
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
  rowsSelect.addEventListener("change", () => {
    if (boardBusy()) return;
    result.hidden = true;
    renderPayouts();
    drawBoard();
  });
  betInput.addEventListener("input", () => { delete balanceMessage.dataset.error; updateAvailability(); });
  autoBetInput.addEventListener("input", () => { delete balanceMessage.dataset.error; updateAvailability(); });
  actionButton.addEventListener("click", () => dropBall(cleanAmount(betInput)));
  autoActionButton.addEventListener("click", runAutoplay);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("resize", () => drawBoard([...activeBalls.values()].map((ball) => ballPosition(ball, performance.now()))));

  renderPayouts();
  drawBoard();
  updateAvailability();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
