(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "limbo") return;
  const game = document.querySelector("#limbo-game");
  const blank = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Limbo | GamRace";
  game.hidden = false;
  if (blank) blank.hidden = true;

  const betInput = game.querySelector("#limbo-bet-amount");
  const autoBetInput = game.querySelector("#limbo-auto-bet-amount");
  const targetInput = game.querySelector("#limbo-target");
  const chanceOutput = game.querySelector("#limbo-chance");
  const profitOutput = game.querySelector("#limbo-profit");
  const profitLabel = game.querySelector("[data-limbo-profit-label]");
  const balanceLabel = game.querySelector("[data-limbo-balance]");
  const action = game.querySelector("#limbo-action");
  const autoAction = game.querySelector("#limbo-auto-action");
  const autoCount = game.querySelector("#limbo-auto-count");
  const infiniteButton = game.querySelector("#limbo-auto-infinite");
  const autoWin = game.querySelector("#limbo-auto-win");
  const autoLoss = game.querySelector("#limbo-auto-loss");
  const stopProfit = game.querySelector("#limbo-stop-profit");
  const stopLoss = game.querySelector("#limbo-stop-loss");
  const message = game.querySelector("#limbo-message");
  const readout = game.querySelector("#limbo-readout");
  const resultOutput = game.querySelector("#limbo-result");
  const resultStrip = game.querySelector("#limbo-result-strip");

  let mode = "manual";
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let houseFactor = .99;
  let pending = false;
  let autoplay = false;
  let stopRequested = false;
  let infinite = false;
  let turbo = false;
  const ruleActions = { win: "reset", loss: "reset" };

  try { turbo = Boolean(JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}").limboTurbo); } catch {}

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
  const clean = (input) => Math.max(0, Math.round((Number.parseFloat(input.value) || 0) * 100000000) / 100000000);
  const minimumWager = () => displayFiat ? .01 : .00000001;
  const target = () => clamp(targetInput.value, 1.01, 1_000_000);
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function amountText(value) {
    const number = Number(value) || 0;
    if (displayFiat) return `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function multiplierText(value) {
    const number = Number(value) || 1;
    if (number >= 1000) return `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}×`;
    return `${number.toFixed(2)}×`;
  }

  function updateCalculated() {
    const nextTarget = target();
    targetInput.value = nextTarget.toFixed(nextTarget < 100 ? 2 : 0);
    chanceOutput.value = Math.min(99, houseFactor / nextTarget * 100).toFixed(4);
    chanceOutput.textContent = chanceOutput.value;
    const wager = clean(mode === "auto" ? autoBetInput : betInput);
    const profit = wager * (nextTarget - 1);
    profitOutput.value = profit.toFixed(displayFiat ? 2 : 8);
    profitOutput.textContent = profitOutput.value;
    profitLabel.textContent = amountText(profit);
    updateAvailability();
  }

  function updateAvailability() {
    const manual = clean(betInput);
    const automatic = clean(autoBetInput);
    action.disabled = pending || autoplay || manual < minimumWager() || manual > availableBalance || !selectedCurrency;
    autoAction.disabled = pending || (!autoplay && (automatic < minimumWager() || automatic > availableBalance || !selectedCurrency));
    autoCount.disabled = autoplay || infinite;
    infiniteButton.disabled = autoplay;
    balanceLabel.textContent = amountText(availableBalance);
  }

  async function loadHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.limbo?.houseFactorMicros);
      if (Number.isInteger(factor) && factor >= 900_000 && factor <= 1_000_000) houseFactor = factor / 1_000_000;
      updateCalculated();
    } catch { /* Keep the safe default until live settings reconnect. */ }
  }

  function addResult(value, won) {
    resultStrip.hidden = false;
    const pill = document.createElement("span");
    pill.className = `game-result-pill${won ? " win" : ""}`;
    pill.textContent = multiplierText(value);
    resultStrip.append(pill);
    while (resultStrip.children.length > 10) resultStrip.firstElementChild.remove();
    resultStrip.scrollLeft = resultStrip.scrollWidth;
  }

  async function animateResult(finalValue) {
    readout.classList.remove("win", "loss");
    if (turbo || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resultOutput.textContent = multiplierText(finalValue);
      return;
    }
    const duration = 820;
    const started = performance.now();
    await new Promise((resolve) => {
      const frame = (time) => {
        const progress = Math.min(1, (time - started) / duration);
        const eased = 1 - (1 - progress) ** 4;
        const jitter = progress < .7 ? (1 + Math.random() * Math.max(1.2, Math.min(finalValue, 18))) : finalValue;
        const shown = progress < .7 ? jitter : jitter + (finalValue - jitter) * eased;
        resultOutput.textContent = multiplierText(shown);
        if (progress < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    resultOutput.textContent = multiplierText(finalValue);
  }

  async function placeBet(amount) {
    message.hidden = true;
    if (pending || amount < minimumWager() || amount > availableBalance || !window.gamraceWallet?.request) return null;
    pending = true;
    updateAvailability();
    try {
      const targetMultiplier = target();
      const response = await window.gamraceWallet.request("/games/limbo/bets", {
        method: "POST",
        body: JSON.stringify({ requestId: crypto.randomUUID().replaceAll("-", ""), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, targetMultiplier }),
      });
      const won = response.bet.outcome === "win";
      const result = Number(response.bet.resultMultiplier);
      await animateResult(result);
      readout.classList.add(won ? "win" : "loss");
      addResult(result, won);
      window.gamraceWallet.applyGameResult(response);
      window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      const payout = won ? amount * targetMultiplier : 0;
      window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "limbo", wager: amount, payout } }));
      return { won, profit: payout - amount };
    } catch (error) {
      message.textContent = error.message || "The bet could not be completed.";
      message.hidden = false;
      return null;
    } finally {
      pending = false;
      updateAvailability();
    }
  }

  async function runAutoplay() {
    if (autoplay) { stopRequested = true; autoAction.textContent = "Stopping…"; return; }
    const rounds = infinite ? Infinity : Math.round(clamp(autoCount.value, 1, 100));
    const base = clean(autoBetInput);
    let amount = base;
    let sessionProfit = 0;
    if (base < minimumWager() || base > availableBalance) return;
    autoplay = true;
    stopRequested = false;
    autoAction.textContent = "Stop Autoplay";
    updateAvailability();
    for (let index = 0; index < rounds && !stopRequested; index += 1) {
      const result = await placeBet(amount);
      if (!result) break;
      sessionProfit += result.profit;
      const type = result.won ? "win" : "loss";
      const percentage = clamp((result.won ? autoWin : autoLoss).value, 0, 1000);
      amount = ruleActions[type] === "reset" ? base : Math.round(amount * (1 + percentage / 100) * 100000000) / 100000000;
      autoBetInput.value = amount.toFixed(displayFiat ? 2 : 8);
      if ((clean(stopProfit) > 0 && sessionProfit >= clean(stopProfit)) || (clean(stopLoss) > 0 && sessionProfit <= -clean(stopLoss)) || amount > availableBalance) break;
      await delay(turbo ? 90 : 480);
    }
    autoplay = false;
    stopRequested = false;
    autoAction.textContent = "Start Autoplay";
    updateAvailability();
  }

  function applyWallet(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency !== detail.currency || displayFiat !== (detail.displayFiat !== false);
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-limbo-currency]"), detail);
    [betInput, autoBetInput, stopProfit, stopLoss].forEach((input) => { input.min = minimumWager(); input.step = minimumWager(); });
    if (changed) {
      [betInput, autoBetInput, stopProfit, stopLoss].forEach((input) => { input.value = displayFiat ? "0.00" : "0.00000000"; });
      resultStrip.replaceChildren();
      resultStrip.hidden = true;
    }
    updateCalculated();
  }

  function adjust(input, operation) {
    const next = operation === "half" ? clean(input) / 2 : clean(input) * 2;
    input.value = Math.min(availableBalance, next).toFixed(displayFiat ? 2 : 8);
    updateCalculated();
  }

  game.querySelectorAll("[data-limbo-mode]").forEach((button) => button.addEventListener("click", () => {
    if (autoplay) return;
    mode = button.dataset.limboMode;
    game.querySelectorAll("[data-limbo-mode]").forEach((tab) => { const active = tab === button; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    game.querySelectorAll("[data-limbo-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.limboModePanel !== mode; });
    updateCalculated();
  }));
  game.querySelectorAll("[data-limbo-bet-action]").forEach((button) => button.addEventListener("click", () => adjust(betInput, button.dataset.limboBetAction)));
  game.querySelectorAll("[data-limbo-auto-bet-action]").forEach((button) => button.addEventListener("click", () => adjust(autoBetInput, button.dataset.limboAutoBetAction)));
  game.querySelectorAll("[data-limbo-rule-action]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.limboRuleResult;
    ruleActions[type] = "reset";
    game.querySelector(`[data-limbo-rule="${type}"]`).classList.remove("increase-active");
    button.classList.add("active");
  }));
  [autoWin, autoLoss].forEach((input) => input.addEventListener("focus", () => {
    const type = input === autoWin ? "win" : "loss";
    ruleActions[type] = "increase";
    const section = game.querySelector(`[data-limbo-rule="${type}"]`);
    section.classList.add("increase-active");
    section.querySelector("button").classList.remove("active");
  }));
  infiniteButton.addEventListener("click", () => { infinite = !infinite; infiniteButton.classList.toggle("active", infinite); infiniteButton.setAttribute("aria-pressed", String(infinite)); updateAvailability(); });
  [betInput, autoBetInput].forEach((input) => input.addEventListener("input", updateCalculated));
  targetInput.addEventListener("change", updateCalculated);
  action.addEventListener("click", () => placeBet(clean(betInput)));
  autoAction.addEventListener("click", runAutoplay);
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWallet(event.detail));
  window.addEventListener("gamrace:game-setting-changed", (event) => { if (event.detail?.game === "limbo" && event.detail.name === "turbo") turbo = Boolean(event.detail.value); });

  updateCalculated();
  loadHouseEdge();
  if (window.gamraceWalletSelection) applyWallet(window.gamraceWalletSelection);
})();
