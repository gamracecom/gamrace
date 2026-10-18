(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "moles") return;
  const game = document.querySelector("#moles-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Moles | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const HOLES = 7;
  const MAX_HITS = 8;
  const holes = game.querySelector("#moles-holes");
  const progress = game.querySelector("#moles-progress");
  const arena = game.querySelector("#moles-arena");
  const hammer = game.querySelector("#moles-hammer");
  const betInput = game.querySelector("#moles-bet-amount");
  const autoBetInput = game.querySelector("#moles-auto-bet-amount");
  const actionButton = game.querySelector("#moles-action");
  const autoButton = game.querySelector("#moles-auto-action");
  const autoTargetInput = game.querySelector("#moles-auto-target");
  const autoCountInput = game.querySelector("#moles-auto-count");
  const autoInfiniteButton = game.querySelector("#moles-auto-infinite");
  const balanceLabel = game.querySelector("[data-moles-balance]");
  const message = game.querySelector("#moles-message");
  const modeButtons = [...game.querySelectorAll("[data-moles-mode]")];
  const panels = [...game.querySelectorAll("[data-moles-panel]")];
  const countButtons = [...game.querySelectorAll("[data-moles-count]")];
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let moleCount = 1;
  let round = null;
  let busy = false;
  let mode = "manual";
  let autoRunning = false;
  let autoInfinite = false;
  let showReveal = false;
  let revealTimer = 0;
  let houseFactor = 0.98;
  const recordedRounds = new Set();

  function requestId() { return crypto.randomUUID().replaceAll("-", ""); }
  function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

  function settings() {
    try { return JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}"); }
    catch { return {}; }
  }

  function revealDuration(resultRound = round) {
    const loss = resultRound?.status === "lost";
    if (settings().molesTurbo) return loss ? 700 : 360;
    return loss ? 2400 : 1500;
  }

  function inputAmount(input = betInput) {
    const value = Number.parseFloat(input?.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function minimumWager() { return displayFiat ? 0.01 : 0.00000001; }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function setMessage(text = "", tone = "") {
    message.textContent = text;
    message.dataset.tone = tone;
    message.hidden = !text;
  }

  function localMultipliers() {
    return Array.from({ length: MAX_HITS }, (_, index) => houseFactor * Math.pow(HOLES / moleCount, index + 1));
  }

  function multipliers() {
    return Array.isArray(round?.stepMultipliers) && round.stepMultipliers.length === MAX_HITS ? round.stepMultipliers : localMultipliers();
  }

  function renderProgress() {
    const hits = Number(round?.hits || 0);
    const values = multipliers();
    progress.replaceChildren(...values.map((value, index) => {
      const item = document.createElement("span");
      const fractionDigits = value >= 1000 ? 0 : 2;
      item.className = `${index < hits ? "complete" : ""}${round?.status === "active" && index === hits ? " current" : ""}`;
      item.innerHTML = `<i>${index + 1}</i><strong>${Number(value).toLocaleString("en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}×</strong>`;
      return item;
    }));
  }

  function moleMarkup(index) {
    return `<span class="moles-character" aria-hidden="true" style="--pop-delay:${index * 55}ms"><i class="moles-ear left"></i><i class="moles-ear right"></i><span class="moles-head"><i class="moles-eye left"></i><i class="moles-eye right"></i><i class="moles-nose"></i><i class="moles-tooth left"></i><i class="moles-tooth right"></i></span><span class="moles-suit"><img src="assets/brand/gamrace-icon.png" alt="" /></span></span>`;
  }

  function renderHoles() {
    const active = round?.status === "active";
    const reveal = showReveal ? round?.lastReveal : null;
    const molePositions = new Set(Array.isArray(reveal?.molePositions) ? reveal.molePositions.map(Number) : []);
    holes.replaceChildren(...Array.from({ length: HOLES }, (_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "moles-hole";
      button.dataset.hole = String(index);
      button.setAttribute("aria-label", `Choose hole ${index + 1}`);
      if (molePositions.has(index)) {
        button.classList.add("has-mole");
        button.insertAdjacentHTML("beforeend", moleMarkup(index));
      }
      if (reveal && index === Number(reveal.selectedHole)) button.classList.add(reveal.hit ? "hit" : "miss");
      button.disabled = busy || !active || showReveal;
      if (!button.disabled) button.addEventListener("click", () => choose(index));
      return button;
    }));
  }

  function renderRound(nextRound, reveal = false) {
    round = nextRound || null;
    showReveal = Boolean(reveal && round?.lastReveal);
    if (round?.moleCount) selectMoleCount(Number(round.moleCount), false);
    renderProgress();
    renderHoles();
    if (round && round.status !== "active") {
      const wager = Number(round.wager || 0);
      const payout = Number(round.payout || 0);
      setMessage();
      if (!recordedRounds.has(round.id)) {
        recordedRounds.add(round.id);
        window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "moles", wager, payout } }));
        window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      }
    } else setMessage();
    updateAvailability();
  }

  function selectMoleCount(value, update = true) {
    if (!Number.isInteger(value) || value < 1 || value > 6 || round?.status === "active") return;
    moleCount = value;
    countButtons.forEach((button) => {
      const selected = Number(button.dataset.molesCount) === value;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (update) { renderProgress(); updateAvailability(); }
  }

  function switchMode(nextMode) {
    if (!['manual', 'auto'].includes(nextMode) || autoRunning) return;
    mode = nextMode;
    modeButtons.forEach((button) => {
      const selected = button.dataset.molesMode === mode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.molesPanel !== mode; });
    updateAvailability();
  }

  function updateAvailability() {
    const active = round?.status === "active";
    const manualAmount = inputAmount(betInput);
    const autoAmount = inputAmount(autoBetInput);
    betInput.disabled = busy || active || autoRunning;
    autoBetInput.disabled = busy || active || autoRunning;
    countButtons.forEach((button) => { button.disabled = busy || active || autoRunning; });
    balanceLabel.textContent = formatAmount(availableBalance);
    const canCashout = active && Number(round?.hits || 0) > 0;
    actionButton.classList.toggle("cashout", canCashout);
    actionButton.textContent = active ? `Cash Out ${Number(round?.multiplier || 1).toFixed(2)}×` : "Bet";
    actionButton.disabled = busy || autoRunning || (active ? !canCashout : !selectedCurrency || manualAmount < minimumWager() || manualAmount > availableBalance);
    autoButton.textContent = autoRunning ? "Stop Autoplay" : "Start Autoplay";
    autoButton.disabled = !autoRunning && (busy || active || !selectedCurrency || autoAmount < minimumWager() || autoAmount > availableBalance);
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    [betInput, autoBetInput].forEach((input) => { input.min = minimumWager().toFixed(displayFiat ? 2 : 8); input.step = input.min; });
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-moles-currency]"), detail);
    if (changed) round = null;
    updateAvailability();
    syncActive();
  }

  function adjustBet(action) {
    const value = inputAmount(betInput);
    const next = Math.min(availableBalance, action === "half" ? value / 2 : value * 2);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function syncActive() {
    if (!selectedCurrency || busy || autoRunning || !window.gamraceWallet?.request) return;
    try {
      const response = await window.gamraceWallet.request(`/games/moles/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.wallet) window.gamraceWallet.applyGameResult(response);
      if (response.round || !round || round.currency !== selectedCurrency) renderRound(response.round);
    } catch (error) { if (!round) setMessage(error.message || "Moles is reconnecting."); }
  }

  async function start(amount = inputAmount(betInput)) {
    if (busy || round?.status === "active" || amount < minimumWager() || amount > availableBalance) return null;
    busy = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/moles/rounds", {
        method: "POST",
        body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, moleCount }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
      return response.round;
    } catch (error) { setMessage(error.message || "That Moles round could not be started."); return null; }
    finally { busy = false; updateAvailability(); renderHoles(); }
  }

  function strike(hole) {
    const target = holes.querySelector(`[data-hole="${hole}"]`);
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();
    hammer.style.setProperty("--hammer-x", `${targetRect.left - arenaRect.left + targetRect.width / 2}px`);
    hammer.style.setProperty("--hammer-y", `${targetRect.top - arenaRect.top + targetRect.height / 2}px`);
    hammer.classList.remove("strike");
    void hammer.offsetWidth;
    hammer.classList.add("strike");
  }

  async function choose(hole) {
    if (busy || round?.status !== "active") return null;
    busy = true;
    showReveal = false;
    strike(hole);
    updateAvailability();
    renderHoles();
    try {
      const response = await window.gamraceWallet.request(`/games/moles/rounds/${encodeURIComponent(round.id)}/choose`, {
        method: "POST", body: JSON.stringify({ actionId: requestId(), hole }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round, true);
      window.clearTimeout(revealTimer);
      const pause = revealDuration(response.round);
      revealTimer = window.setTimeout(() => { showReveal = false; renderHoles(); }, pause);
      return response.round;
    } catch (error) { setMessage(error.message || "That hole could not be checked."); return null; }
    finally { busy = false; updateAvailability(); }
  }

  async function cashout() {
    if (busy || round?.status !== "active" || Number(round.hits || 0) < 1) return null;
    busy = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/moles/rounds/${encodeURIComponent(round.id)}/cashout`, {
        method: "POST", body: JSON.stringify({ actionId: requestId() }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
      return response.round;
    } catch (error) { setMessage(error.message || "That Moles round could not be cashed out."); return null; }
    finally { busy = false; updateAvailability(); renderHoles(); }
  }

  async function autoplay() {
    if (autoRunning) { autoRunning = false; updateAvailability(); return; }
    autoRunning = true;
    const baseAmount = inputAmount(autoBetInput);
    const target = Math.max(1, Math.min(MAX_HITS, Math.floor(Number(autoTargetInput.value) || 1)));
    let remaining = autoInfinite ? Infinity : Math.max(1, Math.min(100, Math.floor(Number(autoCountInput.value) || 1)));
    updateAvailability();
    while (autoRunning && remaining > 0) {
      if (baseAmount > availableBalance) break;
      const started = await start(baseAmount);
      if (!started) break;
      while (autoRunning && round?.status === "active" && Number(round.hits || 0) < target) {
        const result = await choose(Math.floor(Math.random() * HOLES));
        if (!result) { autoRunning = false; break; }
        await delay(revealDuration(result));
      }
      if (autoRunning && round?.status === "active") await cashout();
      remaining -= 1;
      await delay(settings().molesTurbo ? 120 : 500);
    }
    autoRunning = false;
    updateAvailability();
  }

  async function loadHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.moles?.houseFactorMicros);
      if (Number.isInteger(factor) && factor >= 900_000 && factor <= 1_000_000) {
        houseFactor = factor / 1_000_000;
        if (!round) renderProgress();
      }
    } catch { /* Keep the documented default until the live setting is available. */ }
  }

  actionButton.addEventListener("click", () => round?.status === "active" ? cashout() : start());
  autoButton.addEventListener("click", autoplay);
  autoInfiniteButton.addEventListener("click", () => {
    autoInfinite = !autoInfinite;
    autoInfiniteButton.setAttribute("aria-pressed", String(autoInfinite));
    autoCountInput.disabled = autoInfinite;
  });
  [betInput, autoBetInput, autoTargetInput, autoCountInput].forEach((input) => input.addEventListener("input", updateAvailability));
  modeButtons.forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.molesMode)));
  countButtons.forEach((button) => button.addEventListener("click", () => selectMoleCount(Number(button.dataset.molesCount))));
  game.querySelectorAll("[data-moles-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.molesBetAction)));
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("focus", syncActive);

  renderRound(null);
  loadHouseEdge();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
