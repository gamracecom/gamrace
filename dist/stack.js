(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "stack") return;
  const game = document.querySelector("#stack-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Stack | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const MAX_LEVELS = 24;
  const SUCCESS = { easy: 0.9, medium: 0.78, hard: 0.65, extreme: 0.57 };
  const betInput = game.querySelector("#stack-bet-amount");
  const actionButton = game.querySelector("#stack-action");
  const cashoutButton = game.querySelector("#stack-cashout");
  const balanceLabel = game.querySelector("[data-stack-balance]");
  const multiplierLabel = game.querySelector("#stack-multiplier");
  const levelLabel = game.querySelector("#stack-level");
  const message = game.querySelector("#stack-message");
  const progress = game.querySelector("#stack-progress");
  const scene = game.querySelector("#stack-scene");
  const tower = game.querySelector("#stack-tower");
  const moving = game.querySelector("#stack-moving-platform");
  const difficultyButtons = [...game.querySelectorAll("[data-stack-difficulty]")];
  let selectedCurrency = "";
  let displayFiat = true;
  let availableBalance = 0;
  let difficulty = "medium";
  let round = null;
  let busy = false;
  let houseFactor = 0.99;
  let audioContext = null;
  const recordedRounds = new Set();

  function requestId() { return crypto.randomUUID().replaceAll("-", ""); }
  function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

  function settings() {
    try { return JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}"); }
    catch { return {}; }
  }

  function minimumWager() { return displayFiat ? 0.01 : 0.00000001; }
  function inputAmount() {
    const value = Number.parseFloat(betInput.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    return displayFiat
      ? `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }

  function formatMultiplier(value) {
    const multiplier = Number(value) || 1;
    const digits = multiplier >= 1000 ? 0 : multiplier >= 100 ? 1 : 2;
    return `${multiplier.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}×`;
  }

  function setMessage(text = "", tone = "") {
    message.textContent = text;
    message.dataset.tone = tone;
    message.hidden = !text;
  }

  function platformWidth(level) { return Math.max(34, 82 - level * 1.9); }

  function localMultiplier(level) {
    if (!level) return 1;
    return Math.min(1_000_000, houseFactor / (SUCCESS[difficulty] ** level));
  }

  function renderProgress() {
    const completed = Number(round?.completedLevels || 0);
    progress.replaceChildren(...Array.from({ length: MAX_LEVELS }, (_, index) => {
      const marker = document.createElement("i");
      if (index < completed) marker.className = "complete";
      else if (round?.status === "active" && index === completed) marker.className = "current";
      marker.title = `Level ${index + 1} · ${formatMultiplier(round?.levelMultipliers?.[index] || localMultiplier(index + 1))}`;
      return marker;
    }));
  }

  function createPlatform(level, offset = 0, base = false) {
    const platform = document.createElement("span");
    platform.className = `stack-platform${base ? " base" : ""}`;
    platform.style.setProperty("--stack-level", String(level));
    platform.style.setProperty("--stack-width", `${base ? 86 : platformWidth(level)}%`);
    platform.style.setProperty("--stack-x", `${base ? 0 : Math.max(-4, Math.min(4, Number(offset || 0) * 0.12))}%`);
    platform.setAttribute("aria-hidden", "true");
    return platform;
  }

  function renderTower() {
    const landed = Array.isArray(round?.drops) ? round.drops.filter((drop) => drop.landed) : [];
    tower.replaceChildren(createPlatform(0, 0, true), ...landed.map((drop, index) => createPlatform(index + 1, drop.offset)));
    const active = round?.status === "active";
    const nextLevel = Number(round?.completedLevels || 0) + 1;
    moving.style.setProperty("--next-width", `${platformWidth(nextLevel)}%`);
    moving.classList.toggle("hidden", !active || nextLevel > MAX_LEVELS);
    moving.classList.remove("dropping", "miss");
  }

  function selectDifficulty(value, update = true) {
    if (!SUCCESS[value] || round?.status === "active") return;
    difficulty = value;
    difficultyButtons.forEach((button) => {
      const selected = button.dataset.stackDifficulty === difficulty;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (update) renderProgress();
  }

  function renderRound(nextRound) {
    round = nextRound || null;
    if (round?.difficulty) selectDifficulty(round.difficulty, false);
    const completed = Number(round?.completedLevels || 0);
    levelLabel.textContent = `${completed} / ${MAX_LEVELS}`;
    multiplierLabel.textContent = formatMultiplier(round?.multiplier || 1);
    renderProgress();
    renderTower();
    if (round && round.status !== "active") {
      const wager = Number(round.wager || 0);
      const payout = Number(round.payout || 0);
      if (round.outcome === "win") setMessage(`${formatMultiplier(round.multiplier)} · ${formatAmount(payout)}`, "win");
      else setMessage(`Missed on level ${completed + 1}`, "loss");
      if (!recordedRounds.has(round.id)) {
        recordedRounds.add(round.id);
        window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "stack", wager, payout } }));
        window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      }
    } else setMessage();
    updateAvailability();
  }

  function updateAvailability() {
    const active = round?.status === "active";
    const completed = Number(round?.completedLevels || 0);
    const amount = inputAmount();
    betInput.disabled = busy || active;
    difficultyButtons.forEach((button) => { button.disabled = busy || active; });
    balanceLabel.textContent = formatAmount(availableBalance);
    actionButton.textContent = active ? "Drop Platform" : "Start";
    actionButton.disabled = busy || (active ? false : !selectedCurrency || amount < minimumWager() || amount > availableBalance);
    cashoutButton.textContent = completed > 0 ? `Cash Out ${formatMultiplier(round?.multiplier || 1)}` : "Cash Out";
    cashoutButton.disabled = busy || !active || completed < 1;
  }

  function applyWalletSelection(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency;
    displayFiat = detail.displayFiat !== false;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    betInput.min = minimumWager().toFixed(displayFiat ? 2 : 8);
    betInput.step = betInput.min;
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-stack-currency]"), detail);
    if (changed) round = null;
    updateAvailability();
    syncActive();
  }

  function adjustBet(action) {
    const value = inputAmount();
    const next = Math.min(availableBalance, action === "half" ? value / 2 : value * 2);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  function sound(landed) {
    if (settings().stackMute) return;
    try {
      audioContext ||= new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = landed ? "sine" : "sawtooth";
      oscillator.frequency.setValueAtTime(landed ? 310 + Number(round?.completedLevels || 0) * 14 : 120, audioContext.currentTime);
      gain.gain.setValueAtTime(0.045, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + (landed ? 0.16 : 0.34));
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + (landed ? 0.16 : 0.34));
    } catch { /* Audio remains optional. */ }
  }

  async function syncActive() {
    if (!selectedCurrency || busy || !window.gamraceWallet?.request) return;
    try {
      const response = await window.gamraceWallet.request(`/games/stack/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.wallet) window.gamraceWallet.applyGameResult(response);
      if (response.round || !round || round.currency !== selectedCurrency) renderRound(response.round);
    } catch (error) { if (!round) setMessage(error.message || "Stack is reconnecting."); }
  }

  async function start() {
    const amount = inputAmount();
    if (busy || round?.status === "active" || amount < minimumWager() || amount > availableBalance) return;
    busy = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/stack/rounds", {
        method: "POST",
        body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, difficulty }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Stack round could not be started."); }
    finally { busy = false; updateAvailability(); }
  }

  async function animateDrop(previousRound, nextRound) {
    const drop = nextRound?.lastDrop;
    if (!drop || !moving) return;
    const level = Number(previousRound?.completedLevels || 0) + 1;
    const mobile = window.matchMedia("(max-width:520px)").matches;
    const step = mobile ? 15 : 20;
    const targetY = Math.max(70, scene.clientHeight - 36 - (18 + level * step) - 25);
    const landingX = drop.landed ? Math.max(-5, Math.min(5, Number(drop.offset || 0) * 0.15)) : (Number(drop.offset || 1) < 0 ? -118 : 118);
    moving.style.setProperty("--drop-y", `${targetY}px`);
    moving.style.setProperty("--landing-x", `${landingX}%`);
    moving.style.setProperty("--next-width", `${platformWidth(level)}%`);
    moving.classList.remove("hidden", "dropping", "miss");
    void moving.offsetWidth;
    moving.classList.add("dropping");
    if (!drop.landed) moving.classList.add("miss");
    const turbo = Boolean(settings().stackTurbo);
    await delay(turbo ? 300 : drop.landed ? 860 : 1280);
    sound(drop.landed);
  }

  async function drop() {
    if (busy || round?.status !== "active") return;
    busy = true;
    const previousRound = round;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/stack/rounds/${encodeURIComponent(round.id)}/drop`, {
        method: "POST", body: JSON.stringify({ actionId: requestId() }),
      });
      window.gamraceWallet.applyGameResult(response);
      await animateDrop(previousRound, response.round);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That platform could not be dropped."); }
    finally { busy = false; updateAvailability(); }
  }

  async function cashout() {
    if (busy || round?.status !== "active" || Number(round.completedLevels || 0) < 1) return;
    busy = true;
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/stack/rounds/${encodeURIComponent(round.id)}/cashout`, {
        method: "POST", body: JSON.stringify({ actionId: requestId() }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Stack round could not be cashed out."); }
    finally { busy = false; updateAvailability(); }
  }

  async function loadHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.stack?.houseFactorMicros);
      if (Number.isInteger(factor) && factor >= 900_000 && factor <= 1_000_000) {
        houseFactor = factor / 1_000_000;
        if (!round) renderProgress();
      }
    } catch { /* Keep the documented default until the live setting is available. */ }
  }

  actionButton.addEventListener("click", () => round?.status === "active" ? drop() : start());
  cashoutButton.addEventListener("click", cashout);
  betInput.addEventListener("input", updateAvailability);
  difficultyButtons.forEach((button) => button.addEventListener("click", () => selectDifficulty(button.dataset.stackDifficulty)));
  game.querySelectorAll("[data-stack-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.stackBetAction)));
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("focus", syncActive);

  renderRound(null);
  loadHouseEdge();
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
