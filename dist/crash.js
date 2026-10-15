(() => {
  "use strict";
  if (new URLSearchParams(location.search).get("game")?.toLowerCase() !== "crash") return;
  const game = document.querySelector("#crash-game");
  const blank = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Crash | GamRace";
  document.body.classList.add("crash-active");
  game.hidden = false;
  if (blank) blank.hidden = true;

  const canvas = game.querySelector("#crash-canvas");
  const multiplierNode = game.querySelector("#crash-multiplier");
  const phaseNode = game.querySelector("#crash-phase-label");
  const countdownNode = game.querySelector("#crash-countdown");
  const rocket = game.querySelector("#crash-rocket");
  const explosion = game.querySelector("#crash-explosion");
  const line = game.querySelector("#crash-line");
  const area = game.querySelector("#crash-area");
  const recentNode = game.querySelector("#crash-recent");
  const messageNode = game.querySelector("#crash-message");
  const slips = [...game.querySelectorAll("[data-crash-slip]")].map((root) => ({
    root,
    slot: Number(root.dataset.crashSlip),
    wagerInput: root.querySelector("[data-crash-wager]"),
    autoInput: root.querySelector("[data-crash-auto]"),
    infiniteButton: root.querySelector("[data-crash-auto-infinite]"),
    button: root.querySelector("[data-crash-action]"),
    state: root.querySelector("[data-crash-slip-state]"),
    busy: false,
  }));
  const modeButtons = [...game.querySelectorAll("[data-crash-mode]")];
  let mode = "manual";
  let round = null;
  let serverOffset = 0;
  let polling = false;
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let reducedMotion = false;
  let muted = false;
  let previousPhase = "";
  let previousRoundId = "";
  let lastExplosionRound = "";
  let audioContext = null;
  const recordedWagers = new Set();
  const knownStatuses = new Map();
  const displayWagers = new Map();
  const autoTriggered = new Set();

  try {
    const settings = JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}");
    reducedMotion = Boolean(settings.crashReducedMotion);
    muted = Boolean(settings.crashMute);
  } catch {}

  const requestId = () => crypto.randomUUID().replaceAll("-", "");
  const logicalNow = () => Date.now() + serverOffset;
  const cleanAmount = (input) => Math.max(0, Math.round((Number(input.value) || 0) * 1e8) / 1e8);
  const minBet = () => displayFiat ? 0.01 : 0.00000001;
  const fmtX = (value) => `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Number(value) >= 100 ? 2 : 3 })}×`;
  const fmtAmount = (value) => displayFiat ? `$${Number(value || 0).toFixed(2)}` : `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${selectedSymbol}`;
  const currentMultiplier = (timestamp = logicalNow()) => {
    if (!round || timestamp < round.launchesAtMs) return 1;
    if (round.phase === "crashed") return Number(round.crashMultiplier || 1);
    const progress = Math.max(0, Math.min(1, (timestamp - round.launchesAtMs) / 80000));
    return Math.min(1000, Math.exp(Math.log(1000) * progress));
  };
  const currentPhase = (timestamp = logicalNow()) => !round ? "betting" : round.phase === "crashed" ? "crashed" : timestamp < round.launchesAtMs ? "betting" : "flying";
  function setMessage(text = "") { messageNode.textContent = text; messageNode.hidden = !text; }

  function playTone(type) {
    if (muted) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const timestamp = audioContext.currentTime;
      oscillator.type = type === "crash" ? "sawtooth" : "sine";
      oscillator.frequency.setValueAtTime(type === "crash" ? 190 : 330, timestamp);
      oscillator.frequency.exponentialRampToValueAtTime(type === "crash" ? 48 : 720, timestamp + (type === "crash" ? .34 : .2));
      gain.gain.setValueAtTime(.0001, timestamp);
      gain.gain.exponentialRampToValueAtTime(.055, timestamp + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, timestamp + (type === "crash" ? .38 : .24));
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(timestamp); oscillator.stop(timestamp + .42);
    } catch {}
  }

  function renderRecent(values) {
    recentNode.replaceChildren();
    values.slice(0, 10).reverse().forEach((value) => {
      const pill = document.createElement("span");
      pill.className = `game-result-pill${Number(value) >= 2 ? " win" : ""}`;
      pill.textContent = fmtX(value);
      recentNode.append(pill);
    });
  }

  function wagerFor(slot) {
    return round?.wagers?.find((wager) => Number(wager.slot) === slot) || null;
  }

  function recordSettlement(wager) {
    if (!wager || wager.status === "open" || recordedWagers.has(wager.id)) return;
    recordedWagers.add(wager.id);
    const displayedWager = displayWagers.get(wager.id) ?? Number(wager.wager || 0);
    const displayedPayout = displayFiat && displayWagers.has(wager.id)
      ? displayedWager * Number(wager.multiplier || 0)
      : Number(wager.payout || 0);
    window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "crash", wager: displayedWager, payout: displayedPayout } }));
    window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
  }

  function renderSlips() {
    const phase = currentPhase();
    slips.forEach((slip) => {
      const wager = wagerFor(slip.slot);
      if (wager) {
        const oldStatus = knownStatuses.get(wager.id);
        knownStatuses.set(wager.id, wager.status);
        if (oldStatus === "open" && wager.status !== "open") recordSettlement(wager);
      }
      const placed = wager?.status === "open";
      const awaitingAuto = placed && autoTriggered.has(wager.id);
      const canPlace = phase === "betting" && !wager && !slip.busy && selectedCurrency && cleanAmount(slip.wagerInput) >= minBet() && cleanAmount(slip.wagerInput) <= availableBalance;
      const canCashout = phase === "flying" && placed && !awaitingAuto && !slip.busy;
      slip.wagerInput.disabled = Boolean(wager) || phase !== "betting" || slip.busy;
      slip.autoInput.disabled = Boolean(wager) || phase !== "betting" || slip.busy;
      slip.infiniteButton.disabled = Boolean(wager) || phase !== "betting" || slip.busy;
      slip.root.querySelectorAll("[data-crash-amount-action]").forEach((button) => { button.disabled = Boolean(wager) || phase !== "betting" || slip.busy; });
      slip.button.classList.toggle("is-cashout", canCashout);
      if (awaitingAuto) slip.button.textContent = "Auto Cashing Out…";
      else if (canCashout) {
        const amount = displayWagers.get(wager.id);
        slip.button.textContent = `Cash Out · ${Number.isFinite(amount) ? fmtAmount(amount * currentMultiplier()) : fmtX(currentMultiplier())}`;
      } else if (wager?.status === "cashed_out") slip.button.textContent = `Cashed Out · ${fmtX(wager.multiplier)}`;
      else if (wager?.status === "lost") slip.button.textContent = "Crashed";
      else if (placed) slip.button.textContent = phase === "betting" ? "Bet Placed" : "Flying";
      else slip.button.textContent = phase === "betting" ? "Place Bet" : "Next Round";
      slip.button.disabled = !(canPlace || canCashout);
      slip.state.textContent = wager?.status === "cashed_out" ? fmtX(wager.multiplier) : wager?.status === "lost" ? "Lost" : awaitingAuto ? "Auto cashing out…" : placed ? "Active" : "Ready";
    });
  }

  function flightPoint(multiplier) {
    const progress = Math.max(0, Math.min(1, Math.log(Math.max(1, multiplier)) / Math.log(1000)));
    const x = 40 + 900 * Math.pow(progress, .72);
    const y = 455 - 390 * Math.pow(progress, .62);
    return { x, y, progress };
  }

  function renderFlight() {
    if (!round) { requestAnimationFrame(renderFlight); return; }
    const timestamp = logicalNow();
    const phase = currentPhase(timestamp);
    const multiplier = phase === "crashed" ? Number(round.crashMultiplier || currentMultiplier(timestamp)) : currentMultiplier(timestamp);
    const point = flightPoint(multiplier);
    canvas.dataset.phase = phase;
    canvas.dataset.power = multiplier >= 10 ? "overdrive" : multiplier >= 5 ? "streak" : multiplier >= 2 ? "boost" : "normal";
    canvas.style.setProperty("--crash-intensity", String(point.progress));
    multiplierNode.textContent = phase === "betting" ? "1.00×" : fmtX(multiplier);
    if (phase === "betting") {
      const seconds = Math.max(0, (round.launchesAtMs - timestamp) / 1000);
      phaseNode.textContent = "Next flight";
      countdownNode.textContent = `Taking off in ${seconds.toFixed(1)}s`;
    } else if (phase === "flying") {
      phaseNode.textContent = "Live";
      countdownNode.textContent = "Cash out before the crash";
      slips.forEach((slip) => {
        const wager = wagerFor(slip.slot);
        const target = Number(wager?.autoCashout);
        if (wager?.status === "open" && target > 1 && multiplier >= target && !autoTriggered.has(wager.id)) {
          autoTriggered.add(wager.id);
          slip.state.textContent = "Auto cashing out…";
          refreshLive();
        }
      });
    } else {
      phaseNode.textContent = "Crashed at";
      countdownNode.textContent = "Next round incoming";
    }
    const points = [];
    const steps = reducedMotion ? 8 : 28;
    for (let index = 0; index <= steps; index += 1) {
      const sample = flightPoint(1 + (multiplier - 1) * index / steps);
      points.push(`${sample.x.toFixed(1)} ${sample.y.toFixed(1)}`);
    }
    const path = `M${points.join(" L")}`;
    line.setAttribute("d", path);
    area.setAttribute("d", `${path} L${point.x.toFixed(1)} 455 L40 455 Z`);
    rocket.style.left = `${point.x / 10}%`;
    rocket.style.bottom = `${(520 - point.y) / 5.2}%`;
    if (!explosion.hidden) {
      explosion.style.left = `${point.x / 10}%`;
      explosion.style.top = `${point.y / 5.2}%`;
    }
    if (phase !== previousPhase) {
      if (phase === "flying") {
        rocket.classList.remove("is-taking-off"); void rocket.offsetWidth; rocket.classList.add("is-taking-off"); playTone("launch");
      }
      if (phase === "crashed" && lastExplosionRound !== round.id) {
        lastExplosionRound = round.id;
        explosion.hidden = false;
        void explosion.offsetWidth;
        playTone("crash");
        window.setTimeout(() => { explosion.hidden = true; }, reducedMotion ? 80 : 900);
      }
      previousPhase = phase;
    }
    renderSlips();
    requestAnimationFrame(renderFlight);
  }

  async function placeBet(slip) {
    const amount = cleanAmount(slip.wagerInput);
    if (slip.busy || amount < minBet()) return;
    slip.busy = true; setMessage(); renderSlips();
    try {
      const response = await window.gamraceWallet.request("/games/crash/wagers", { method: "POST", body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, slot: slip.slot, autoCashout: slip.autoInput.value || null }) });
      serverOffset = Number(response.serverNow || Date.now()) - Date.now();
      round = response.round;
      const wager = wagerFor(slip.slot);
      if (wager) { displayWagers.set(wager.id, amount); knownStatuses.set(wager.id, wager.status); }
      window.gamraceWallet.applyGameResult(response);
    } catch (error) { setMessage(error.message || "That bet could not be placed."); }
    finally { slip.busy = false; renderSlips(); }
  }

  async function cashout(slip, wager) {
    if (slip.busy || !wager) return;
    slip.busy = true; setMessage(); renderSlips();
    try {
      const response = await window.gamraceWallet.request(`/games/crash/wagers/${encodeURIComponent(wager.id)}/cashout`, { method: "POST", body: "{}" });
      serverOffset = Number(response.serverNow || Date.now()) - Date.now();
      round = response.round;
      window.gamraceWallet.applyGameResult(response);
      recordSettlement(response.wager);
    } catch (error) { setMessage(error.message || "That wager could not be cashed out."); }
    finally { slip.busy = false; renderSlips(); }
  }

  async function refreshLive() {
    if (polling || document.hidden || !selectedCurrency || !window.gamraceWallet?.request) return;
    polling = true;
    try {
      const response = await window.gamraceWallet.request(`/games/crash/live?currency=${encodeURIComponent(selectedCurrency)}`);
      serverOffset = Number(response.serverNow || Date.now()) - Date.now();
      const changedRound = response.round?.id !== previousRoundId;
      round = response.round;
      if (changedRound) { previousRoundId = round?.id || ""; previousPhase = ""; autoTriggered.clear(); setMessage(); }
      (round?.wagers || []).forEach((wager) => {
        const oldStatus = knownStatuses.get(wager.id);
        if (oldStatus === "open" && wager.status !== "open") recordSettlement(wager);
        knownStatuses.set(wager.id, wager.status);
      });
      renderRecent(Array.isArray(response.recent) ? response.recent : []);
      if (response.wallet) window.gamraceWallet.applyGameResult(response);
      renderSlips();
    } catch (error) {
      if (round) setMessage(error.message || "Reconnecting to the live round…");
    } finally { polling = false; }
  }

  function applyWallet(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency;
    selectedSymbol = detail.asset.symbol || "COIN";
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    slips.forEach((slip) => {
      slip.wagerInput.min = minBet().toFixed(displayFiat ? 2 : 8);
      slip.wagerInput.step = slip.wagerInput.min;
    });
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-crash-currency]"), detail);
    if (changed) { round = null; previousRoundId = ""; knownStatuses.clear(); displayWagers.clear(); autoTriggered.clear(); }
    renderSlips(); refreshLive();
  }

  modeButtons.forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.crashMode === "dual" ? "dual" : "manual";
    game.classList.toggle("is-dual", mode === "dual");
    modeButtons.forEach((item) => item.classList.toggle("active", item === button));
  }));
  slips.forEach((slip) => {
    slip.button.addEventListener("click", () => {
      const wager = wagerFor(slip.slot);
      if (wager?.status === "open" && currentPhase() === "flying") cashout(slip, wager); else placeBet(slip);
    });
    slip.wagerInput.addEventListener("input", renderSlips);
    slip.autoInput.addEventListener("input", () => slip.root.classList.toggle("auto-infinite", !slip.autoInput.value));
    slip.infiniteButton.addEventListener("click", () => {
      slip.autoInput.value = "";
      slip.autoInput.placeholder = "∞";
      slip.root.classList.add("auto-infinite");
    });
    slip.root.querySelectorAll("[data-crash-amount-action]").forEach((button) => button.addEventListener("click", () => {
      const next = button.dataset.crashAmountAction === "half" ? cleanAmount(slip.wagerInput) / 2 : cleanAmount(slip.wagerInput) * 2;
      slip.wagerInput.value = Math.min(availableBalance, next).toFixed(displayFiat ? 2 : 8);
      renderSlips();
    }));
  });
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWallet(event.detail));
  window.addEventListener("gamrace:game-setting-changed", (event) => {
    if (event.detail?.game !== "crash") return;
    if (event.detail.name === "mute") muted = Boolean(event.detail.value);
    if (event.detail.name === "reducedMotion") reducedMotion = Boolean(event.detail.value);
  });
  if (window.gamraceWalletSelection) applyWallet(window.gamraceWalletSelection);
  // The flight animation is rendered locally from the server timestamps. One
  // authoritative sync per second keeps every client aligned without turning
  // animation frames into database reads.
  window.setInterval(refreshLive, 1000);
  window.addEventListener("focus", refreshLive);
  renderFlight();
})();
