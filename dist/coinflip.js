(() => {
  "use strict";
  if (new URLSearchParams(location.search).get("game")?.toLowerCase() !== "coinflip") return;
  const game = document.querySelector("#coinflip-game");
  const blank = document.querySelector("#game-blank-state");
  if (!game) return;
  document.title = "Coinflip | GamRace";
  document.body.classList.add("coinflip-active");
  game.hidden = false;
  if (blank) blank.hidden = true;

  const betInput = game.querySelector("#coinflip-bet-amount");
  const actionButton = game.querySelector("#coinflip-action");
  const headsButton = game.querySelector("#coinflip-heads");
  const tailsButton = game.querySelector("#coinflip-tails");
  const cashoutButton = game.querySelector("#coinflip-cashout");
  const coin = game.querySelector("#coinflip-coin");
  const message = game.querySelector("#coinflip-message");
  const resultStrip = game.querySelector("[data-coinflip-result-strip]");
  const modeButtons = [...game.querySelectorAll("[data-coinflip-mode]")];
  const autoFields = [...game.querySelectorAll("[data-coinflip-auto-only]")];
  const autoSide = game.querySelector("#coinflip-auto-side");
  const autoTarget = game.querySelector("#coinflip-auto-target");
  const autoCount = game.querySelector("#coinflip-auto-count");
  const turboButton = game.querySelector("#coinflip-turbo");
  const favoriteButton = game.querySelector("[data-coinflip-favorite]");
  const toolButtons = [...game.querySelectorAll("[data-coinflip-tool]")];
  const toolPanels = [...game.querySelectorAll("[data-coinflip-tool-panel]")];
  let selectedCurrency = "", selectedSymbol = "COIN", displayFiat = true, availableBalance = 0, usdRate = 0;
  let currentRound = null, mode = "manual", busy = false, autoRunning = false, stopAuto = false, turbo = false, restored = false, alternatingSide = "heads";
  let houseFactor = 0.99;
  const displayWagers = new Map();
  const recordedRounds = new Set();
  const sessionStats = { profit: 0, wagered: 0, wins: 0, losses: 0 };

  try { turbo = Boolean(JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}").turbo); } catch {}
  const requestId = () => crypto.randomUUID().replaceAll("-", "");
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanAmount = () => Math.max(0, Math.round((Number(betInput.value) || 0) * 1e8) / 1e8);
  const minBet = () => displayFiat ? .01 : .00000001;
  const fmtX = (value) => `${Number(value || 1).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}×`;
  const fmtAmount = (value) => displayFiat ? `$${Number(value || 0).toFixed(2)}` : `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${selectedSymbol}`;
  function setMessage(text = "") { message.textContent = text; message.hidden = !text; }

  function updateAvailability() {
    const active = currentRound?.status === "active";
    actionButton.textContent = autoRunning ? (stopAuto ? "Stopping…" : "Stop Autobet") : active ? "Round in Progress" : mode === "auto" ? "Start Autobet" : "Start Round";
    actionButton.disabled = autoRunning ? false : busy || active || !selectedCurrency || cleanAmount() < minBet() || cleanAmount() > availableBalance;
    headsButton.disabled = !active || currentRound?.canFlip === false || busy || autoRunning;
    tailsButton.disabled = !active || currentRound?.canFlip === false || busy || autoRunning;
    cashoutButton.disabled = !active || busy || autoRunning || Number(currentRound?.streak || 0) < 1;
    betInput.disabled = busy || autoRunning || active;
    modeButtons.forEach((button) => { button.disabled = busy || autoRunning || active; });
  }

  function renderRound(round = currentRound) {
    currentRound = round;
    const active = round?.status === "active";
    game.querySelectorAll("[data-coinflip-next]").forEach((node) => { node.textContent = fmtX(round?.nextMultiplier || houseFactor * 2); });
    const wager = displayWagers.get(round?.id);
    if (active && round.streak > 0) cashoutButton.textContent = `Cash Out · ${displayFiat && Number.isFinite(wager) ? fmtAmount(wager * round.multiplier) : `${round.payout} ${selectedSymbol}`}`;
    else cashoutButton.textContent = "Cash Out";
    updateAvailability();
  }
  async function loadLiveHouseEdge() {
    try {
      const response = await fetch("https://gamrace-wallet-api.gamracecom.workers.dev/games/settings", { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const factor = Number(payload?.games?.coinflip?.houseFactorMicros);
      if (!Number.isInteger(factor) || factor < 900_000 || factor > 1_000_000) return;
      houseFactor = factor / 1_000_000;
      renderRound();
    } catch { /* Keep the safe default until live configuration is reachable. */ }
  }

  async function animateCoin(result) {
    coin.classList.remove("flip-heads", "flip-tails");
    void coin.offsetWidth;
    coin.classList.add(result === "heads" ? "flip-heads" : "flip-tails");
    await delay(turbo ? 360 : 1350);
  }

  async function startRound() {
    const amount = cleanAmount();
    const response = await window.gamraceWallet.request("/games/coinflip/rounds", { method: "POST", body: JSON.stringify({ requestId: requestId(), currency: selectedCurrency, wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat }) });
    displayWagers.set(response.round.id, amount);
    window.gamraceWallet.applyGameResult(response);
    renderRound(response.round);
    return response.round;
  }
  async function flip(choice) {
    const response = await window.gamraceWallet.request(`/games/coinflip/rounds/${encodeURIComponent(currentRound.id)}/guess`, { method: "POST", body: JSON.stringify({ choice }) });
    await animateCoin(response.round.lastResult);
    window.gamraceWallet.applyGameResult(response);
    renderRound(response.round);
    if (response.round.status !== "active") finish(response.round);
    return response.round;
  }
  async function cashout() {
    const response = await window.gamraceWallet.request(`/games/coinflip/rounds/${encodeURIComponent(currentRound.id)}/cashout`, { method: "POST", body: "{}" });
    window.gamraceWallet.applyGameResult(response); renderRound(response.round); finish(response.round); return response.round;
  }
  function finish(round) {
    if (recordedRounds.has(round.id)) return;
    recordedRounds.add(round.id);
    const pill = document.createElement("span");
    pill.className = `game-result-pill${round.status === "cashed_out" ? " win" : ""}`;
    pill.textContent = fmtX(round.status === "cashed_out" ? round.multiplier : 0);
    resultStrip.hidden = false; resultStrip.append(pill);
    while (resultStrip.children.length > 10) resultStrip.firstElementChild.remove();
    const wager = displayWagers.get(round.id) ?? Number(round.wager || 0);
    const payout = round.status === "cashed_out" ? wager * Number(round.multiplier || 0) : 0;
    sessionStats.wagered += wager; sessionStats.profit += payout - wager;
    if (round.status === "cashed_out") sessionStats.wins += 1; else sessionStats.losses += 1;
    Object.entries(sessionStats).forEach(([key, value]) => { const field = game.querySelector(`[data-coinflip-stat="${key}"]`); if (field) field.textContent = ["wins", "losses"].includes(key) ? String(value) : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }); });
    window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
  }
  async function manualStart() { if (busy || currentRound?.status === "active") return; busy = true; setMessage(); updateAvailability(); try { await startRound(); } catch (error) { setMessage(error.message); } finally { busy = false; renderRound(); } }
  async function manualFlip(side) { if (busy || currentRound?.status !== "active") return; busy = true; setMessage(); updateAvailability(); try { await flip(side); } catch (error) { setMessage(error.message); } finally { busy = false; renderRound(); } }
  async function manualCashout() { if (busy || currentRound?.status !== "active") return; busy = true; setMessage(); updateAvailability(); try { await cashout(); } catch (error) { setMessage(error.message); } finally { busy = false; renderRound(); } }
  function nextAutoSide() { if (autoSide.value !== "alternate") return autoSide.value; const side = alternatingSide; alternatingSide = side === "heads" ? "tails" : "heads"; return side; }
  async function runAuto() {
    if (busy || autoRunning || currentRound?.status === "active") return;
    autoRunning = true; stopAuto = false; updateAvailability();
    const rounds = Math.max(1, Math.min(100, Number.parseInt(autoCount.value || "1", 10) || 1));
    const target = Math.max(1, Math.min(10, Number(autoTarget.value) || 1));
    try {
      for (let index = 0; index < rounds && !stopAuto; index += 1) {
        if (cleanAmount() > availableBalance) { setMessage("Autobet stopped because your available balance is too low."); break; }
        let round = await startRound();
        while (!stopAuto && round.status === "active" && round.streak < target) round = await flip(nextAutoSide());
        if (round.status === "active" && round.streak >= target) await cashout();
        if (!stopAuto) await delay(turbo ? 80 : 300);
      }
    } catch (error) { setMessage(error.message || "Autobet stopped safely."); }
    finally { autoRunning = false; stopAuto = false; renderRound(); }
  }
  async function restore() {
    if (restored || !selectedCurrency || !window.gamraceWallet?.request) return;
    restored = true;
    try { const response = await window.gamraceWallet.request(`/games/coinflip/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`); if (response.round) renderRound(response.round); }
    catch (error) { restored = false; setMessage(error.message || "Your active Coinflip round could not be restored yet."); }
  }
  function applyWallet(detail) {
    if (!detail?.asset || !detail?.balance) return;
    const changed = selectedCurrency && selectedCurrency !== detail.currency;
    selectedCurrency = detail.currency; selectedSymbol = detail.asset.symbol || "COIN"; displayFiat = detail.displayFiat !== false;
    usdRate = Number(detail.balance.available || 0) > 0 ? Number(detail.balance.usdCents || 0) / 100 / Number(detail.balance.available) : 0;
    availableBalance = displayFiat ? Number(detail.balance.usdCents || 0) / 100 : Number(detail.balance.available || 0);
    betInput.min = minBet().toFixed(displayFiat ? 2 : 8); betInput.step = betInput.min;
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-coinflip-currency]"), detail);
    game.querySelector("[data-coinflip-balance]").textContent = fmtAmount(availableBalance);
    if (changed) { restored = false; if (currentRound?.currency !== selectedCurrency) currentRound = null; }
    renderRound(); restore();
  }
  function favorites() { try { return new Set(JSON.parse(localStorage.getItem("gamrace-favourites-v1") || "[]")); } catch { return new Set(); } }
  function renderFavorite() { const active = favorites().has("coinflip"); favoriteButton.setAttribute("aria-pressed", String(active)); favoriteButton.setAttribute("aria-label", active ? "Remove Coinflip from favourites" : "Add Coinflip to favourites"); }
  function closeTools() { toolPanels.forEach((panel) => { panel.hidden = true; }); toolButtons.forEach((button) => { button.classList.remove("active"); button.setAttribute("aria-expanded", "false"); }); }
  function toggleTool(name) { const panel = game.querySelector(`[data-coinflip-tool-panel="${name}"]`); const button = game.querySelector(`[data-coinflip-tool="${name}"]`); if (!panel || !button) return; const open = panel.hidden; closeTools(); if (open) { panel.hidden = false; button.classList.add("active"); button.setAttribute("aria-expanded", "true"); } }
  modeButtons.forEach((button) => button.addEventListener("click", () => { mode = button.dataset.coinflipMode; modeButtons.forEach((item) => item.classList.toggle("active", item === button)); autoFields.forEach((field) => { field.hidden = mode !== "auto"; }); updateAvailability(); }));
  game.querySelectorAll("[data-coinflip-bet-action]").forEach((button) => button.addEventListener("click", () => { betInput.value = Math.min(availableBalance, button.dataset.coinflipBetAction === "half" ? cleanAmount() / 2 : cleanAmount() * 2).toFixed(displayFiat ? 2 : 8); updateAvailability(); }));
  actionButton.addEventListener("click", () => { if (autoRunning) { stopAuto = true; updateAvailability(); } else if (mode === "auto") runAuto(); else manualStart(); });
  headsButton.addEventListener("click", () => manualFlip("heads")); tailsButton.addEventListener("click", () => manualFlip("tails")); cashoutButton.addEventListener("click", manualCashout); betInput.addEventListener("input", updateAvailability);
  turboButton.addEventListener("click", () => { turbo = !turbo; turboButton.setAttribute("aria-checked", String(turbo)); let settings = {}; try { settings = JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}"); } catch {} settings.turbo = turbo; localStorage.setItem("gamrace-game-settings-v1", JSON.stringify(settings)); });
  favoriteButton.addEventListener("click", () => { const set = favorites(); if (set.has("coinflip")) set.delete("coinflip"); else set.add("coinflip"); localStorage.setItem("gamrace-favourites-v1", JSON.stringify([...set])); renderFavorite(); });
  toolButtons.forEach((button) => button.addEventListener("click", () => toggleTool(button.dataset.coinflipTool)));
  game.querySelectorAll("[data-close-coinflip-tool]").forEach((button) => button.addEventListener("click", closeTools));
  turboButton.setAttribute("aria-checked", String(turbo)); renderFavorite(); renderRound();
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWallet(event.detail));
  if (window.gamraceWalletSelection) applyWallet(window.gamraceWalletSelection);
  loadLiveHouseEdge();
})();
