(() => {
  "use strict";

  const gameName = new URLSearchParams(window.location.search).get("game")?.toLowerCase();
  if (gameName !== "blackjack") return;
  const game = document.querySelector("#blackjack-game");
  const blankState = document.querySelector("#game-blank-state");
  if (!game) return;

  document.title = "Blackjack | GamRace";
  game.hidden = false;
  if (blankState) blankState.hidden = true;

  const betInput = game.querySelector("#blackjack-bet-amount");
  const dealButton = game.querySelector("#blackjack-deal");
  const actionPanel = game.querySelector(".blackjack-actions");
  const actionButtons = [...game.querySelectorAll("[data-blackjack-action]")];
  const balanceLabel = game.querySelector("[data-blackjack-balance]");
  const perfectPairsInput = game.querySelector("#blackjack-perfect-pairs");
  const twentyOnePlusThreeInput = game.querySelector("#blackjack-twenty-one-three");
  const viewButtons = [...game.querySelectorAll("[data-blackjack-view]")];
  const controlPanels = [...game.querySelectorAll("[data-blackjack-panel]")];
  const handCountButtons = [...game.querySelectorAll("[data-blackjack-hand-count]")];
  const message = game.querySelector("#blackjack-message");
  const dealerCards = game.querySelector("#blackjack-dealer-cards");
  const dealerTotal = game.querySelector("#blackjack-dealer-total");
  const playerHands = game.querySelector("#blackjack-player-hands");

  const SUITS = Object.freeze({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" });
  let selectedCurrency = "";
  let selectedSymbol = "COIN";
  let displayFiat = true;
  let availableBalance = 0;
  let round = null;
  let busy = false;
  let handCount = 1;
  let renderedSignature = "";
  const recordedRounds = new Set();

  function requestId() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  function settings() {
    try { return JSON.parse(localStorage.getItem("gamrace-game-settings-v1") || "{}"); }
    catch { return {}; }
  }

  function cleanInput(input) {
    const value = Number.parseFloat(input?.value);
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100000000) / 100000000) : 0;
  }

  function cleanAmount() { return cleanInput(betInput); }

  function requestedTotal() {
    return handCount * (cleanAmount() + cleanInput(perfectPairsInput) + cleanInput(twentyOnePlusThreeInput));
  }

  function minimumWager() {
    return displayFiat ? 0.01 : 0.00000001;
  }

  function formatAmount(value) {
    const amount = Number(value) || 0;
    if (displayFiat) return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ${selectedSymbol}`;
  }

  function setMessage(text = "", tone = "error") {
    message.textContent = text;
    message.dataset.tone = tone;
    message.hidden = !text;
  }

  function cardNode(card, index) {
    const element = document.createElement("span");
    element.style.setProperty("--deal-index", String(index));
    if (card?.hidden) {
      element.className = "blackjack-card hidden-card";
      element.innerHTML = `<i></i><i></i><i></i>`;
      element.setAttribute("aria-label", "Hidden dealer card");
      return element;
    }
    const suit = SUITS[card?.suit] || "♠";
    const red = card?.suit === "hearts" || card?.suit === "diamonds";
    element.className = `blackjack-card${red ? " red" : ""}`;
    element.innerHTML = `<span class="blackjack-card-corner top"><strong>${card?.rank || "?"}</strong><i>${suit}</i></span><b class="blackjack-card-suit">${suit}</b><span class="blackjack-card-corner bottom"><strong>${card?.rank || "?"}</strong><i>${suit}</i></span>`;
    element.setAttribute("aria-label", `${card?.rank || "Card"} of ${card?.suit || "unknown suit"}`);
    return element;
  }

  function handLabel(hand, index) {
    if (hand.status === "blackjack") return "Blackjack";
    if (hand.status === "bust" || hand.bust) return "Bust";
    if (hand.status === "win") return "Win";
    if (hand.status === "push") return "Push";
    if (hand.status === "loss") return "Loss";
    return round?.hands?.length > 1 ? `Hand ${index + 1}` : "Your hand";
  }

  function sideResultLabel(result) {
    return String(result || "none").split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
  }

  function sideResults(index) {
    if (!round?.sideBets) return "";
    return [["Perfect Pairs", round.sideBets.perfectPairs], ["21+3", round.sideBets.twentyOnePlusThree]].map(([label, bet]) => {
      if (!bet || Number(bet.wagerPerHand || 0) <= 0) return "";
      const result = bet.results?.[index] || { result: "none", multiplier: 0 };
      const won = Number(result.multiplier || 0) > 0;
      return `<span class="${won ? "win" : "loss"}"><b>${label}</b>${won ? `${sideResultLabel(result.result)} · ${(result.multiplier - 1).toFixed(0)}:1` : "No win"}</span>`;
    }).join("");
  }

  function renderRound(nextRound) {
    round = nextRound || null;
    const signature = round ? `${round.id}:${round.updatedAt}:${round.status}` : "empty";
    const animate = signature !== renderedSignature && !settings().blackjackReducedMotion;
    renderedSignature = signature;
    game.classList.toggle("has-round", Boolean(round));
    game.classList.toggle("round-settled", round?.status === "settled");

    if (!round) {
      dealerCards.replaceChildren();
      dealerTotal.textContent = "—";
      playerHands.innerHTML = `<div class="blackjack-empty-seat"><span>♠</span></div>`;
      actionPanel.hidden = true;
      dealButton.textContent = "Deal";
      updateAvailability();
      return;
    }

    if (Number.isInteger(Number(round.handCount))) selectHandCount(Number(round.handCount), false);

    dealerCards.replaceChildren(...round.dealer.cards.map(cardNode));
    dealerTotal.textContent = round.status === "settled" ? String(round.dealer.total) : `${round.dealer.total} + ?`;
    playerHands.replaceChildren(...round.hands.map((hand, index) => {
      const article = document.createElement("article");
      article.className = `blackjack-hand${index === round.activeHand && round.status === "active" ? " active" : ""} status-${hand.status}`;
      article.innerHTML = `<header><span>${handLabel(hand, index)}</span><strong>${hand.total}</strong></header><div class="blackjack-card-row"></div><footer class="blackjack-side-results">${sideResults(Number.isInteger(Number(hand.seat)) ? Number(hand.seat) : index)}</footer>`;
      article.querySelector(".blackjack-card-row").replaceChildren(...hand.cards.map(cardNode));
      return article;
    }));
    game.classList.toggle("deal-animate", animate);
    if (animate) requestAnimationFrame(() => window.setTimeout(() => game.classList.remove("deal-animate"), 650));

    actionPanel.hidden = round.status !== "active";
    dealButton.textContent = round.status === "settled" ? "Deal Again" : "Hand in progress";
    updateActionAvailability();

    if (round.status === "settled") {
      const payout = Number(round.payout || 0);
      const wager = Number(round.wager || 0);
      setMessage(round.outcome === "win" ? `${round.multiplier.toFixed(2)}× · ${payout.toFixed(8)} ${selectedSymbol}` : round.outcome === "push" ? "Your wager was returned." : "Round complete.", round.outcome || "loss");
      if (!recordedRounds.has(round.id)) {
        recordedRounds.add(round.id);
        window.dispatchEvent(new CustomEvent("gamrace:session-result", { detail: { game: "blackjack", wager, payout } }));
        window.dispatchEvent(new CustomEvent("gamrace:game-history-refresh"));
      }
    } else setMessage();
    updateAvailability();
  }

  function updateActionAvailability() {
    const active = round?.status === "active";
    const legalActions = new Set(active && Array.isArray(round.actions) ? round.actions : []);
    const activeHand = active ? round.hands?.[round.activeHand] : null;
    const extra = Number(activeHand?.wager || round?.baseWager || 0);
    actionButtons.forEach((button) => {
      const action = button.dataset.blackjackAction;
      const needsExtraWager = action === "double" || action === "split";
      const insufficientBalance = needsExtraWager && !displayFiat && extra > availableBalance;
      button.hidden = false;
      button.disabled = busy || !legalActions.has(action) || insufficientBalance;
      button.setAttribute("aria-disabled", String(button.disabled));
      button.title = legalActions.has(action)
        ? insufficientBalance ? `Insufficient ${selectedSymbol} balance` : `${action[0].toUpperCase()}${action.slice(1)}`
        : action === "split" ? "Available when the opening cards have the same rank" : "Not available for this hand";
    });
  }

  function updateAvailability() {
    const amount = cleanAmount();
    const active = round?.status === "active";
    const required = requestedTotal();
    [betInput, perfectPairsInput, twentyOnePlusThreeInput].forEach((input) => { input.disabled = busy || active; });
    handCountButtons.forEach((button) => { button.disabled = busy || active; });
    dealButton.disabled = busy || active || !selectedCurrency || amount < minimumWager() || required > availableBalance;
    balanceLabel.textContent = formatAmount(availableBalance);
    updateActionAvailability();
    if (round?.status !== "settled" && !active && required > availableBalance && required > 0) setMessage(`Insufficient ${selectedSymbol} balance for all selected hands and side bets.`);
  }

  function switchView(view) {
    viewButtons.forEach((button) => {
      const selected = button.dataset.blackjackView === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    controlPanels.forEach((panel) => { panel.hidden = panel.dataset.blackjackPanel !== view; });
  }

  function selectHandCount(value, update = true) {
    if (![1, 2, 3].includes(value)) return;
    handCount = value;
    handCountButtons.forEach((button) => {
      const selected = Number(button.dataset.blackjackHandCount) === value;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (update) updateAvailability();
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
    [perfectPairsInput, twentyOnePlusThreeInput].forEach((input) => {
      input.min = "0";
      input.step = minimumWager().toFixed(displayFiat ? 2 : 8);
    });
    window.GamRaceBetCurrency?.render(game.querySelectorAll("[data-blackjack-currency]"), detail);
    if (changed) { round = null; renderedSignature = ""; }
    updateAvailability();
    syncActive();
  }

  function adjustBet(action) {
    const amount = cleanAmount();
    const next = Math.min(availableBalance, action === "half" ? amount / 2 : amount * 2);
    betInput.value = next.toFixed(displayFiat ? 2 : 8);
    updateAvailability();
  }

  async function syncActive() {
    if (!selectedCurrency || busy || !window.gamraceWallet?.request) return;
    try {
      const response = await window.gamraceWallet.request(`/games/blackjack/rounds/active?currency=${encodeURIComponent(selectedCurrency)}`);
      if (response.wallet) window.gamraceWallet.applyGameResult(response);
      if (response.round || !round || round.currency !== selectedCurrency) renderRound(response.round);
    } catch (error) { if (!round) setMessage(error.message || "Blackjack is reconnecting…"); }
  }

  async function deal() {
    const amount = cleanAmount();
    if (busy || round?.status === "active" || amount < minimumWager() || requestedTotal() > availableBalance) return;
    busy = true;
    setMessage();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request("/games/blackjack/rounds", {
        method: "POST",
        body: JSON.stringify({
          requestId: requestId(), currency: selectedCurrency,
          wager: amount.toFixed(displayFiat ? 2 : 8), displayFiat, handCount,
          sideBets: {
            perfectPairs: cleanInput(perfectPairsInput).toFixed(displayFiat ? 2 : 8),
            twentyOnePlusThree: cleanInput(twentyOnePlusThreeInput).toFixed(displayFiat ? 2 : 8),
          },
        }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Blackjack hand could not be dealt."); }
    finally { busy = false; updateAvailability(); }
  }

  async function play(action) {
    if (busy || round?.status !== "active" || !round.actions.includes(action)) return;
    busy = true;
    setMessage();
    updateAvailability();
    try {
      const response = await window.gamraceWallet.request(`/games/blackjack/rounds/${encodeURIComponent(round.id)}/action`, {
        method: "POST",
        body: JSON.stringify({ requestId: requestId(), action }),
      });
      window.gamraceWallet.applyGameResult(response);
      renderRound(response.round);
    } catch (error) { setMessage(error.message || "That Blackjack action could not be completed."); }
    finally { busy = false; updateAvailability(); }
  }

  dealButton.addEventListener("click", deal);
  viewButtons.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.blackjackView)));
  handCountButtons.forEach((button) => button.addEventListener("click", () => selectHandCount(Number(button.dataset.blackjackHandCount))));
  actionButtons.forEach((button) => button.addEventListener("click", () => play(button.dataset.blackjackAction)));
  game.querySelectorAll("[data-blackjack-bet-action]").forEach((button) => button.addEventListener("click", () => adjustBet(button.dataset.blackjackBetAction)));
  [betInput, perfectPairsInput, twentyOnePlusThreeInput].forEach((input) => input.addEventListener("input", updateAvailability));
  window.addEventListener("gamrace:wallet-balance-changed", (event) => applyWalletSelection(event.detail));
  window.addEventListener("gamrace:game-setting-changed", (event) => {
    if (event.detail?.game === "blackjack" && event.detail?.name === "reducedMotion") game.classList.toggle("reduced-motion", Boolean(event.detail.value));
  });
  window.addEventListener("focus", syncActive);

  game.classList.toggle("reduced-motion", Boolean(settings().blackjackReducedMotion));
  switchView("manual");
  selectHandCount(1, false);
  renderRound(null);
  if (window.gamraceWalletSelection) applyWalletSelection(window.gamraceWalletSelection);
})();
