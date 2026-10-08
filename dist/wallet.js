import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBS3pib3PsHnSJGaQqBc--S99qI7sqhDuU",
  authDomain: "gamrace.com",
  projectId: "gamrace",
  storageBucket: "gamrace.firebasestorage.app",
  messagingSenderId: "576202313103",
  appId: "1:576202313103:web:8e3153a6816b7bf8658ffa",
};

const WALLET_API_BASE_URL = "https://gamrace-wallet-api.gamracecom.workers.dev";
const ICON_ROOT = "assets/icons/crypto";
const LOCAL_PREVIEW = ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).has("wallet-preview");
const PREVIEW_ASSETS = [
  ["usdterc20", "USDT", "Tether", "Ethereum (ERC20)", "usdt"], ["usdttrc20", "USDT", "Tether", "Tron (TRC20)", "usdt"],
  ["btc", "BTC", "Bitcoin", "Bitcoin", "btc"], ["eth", "ETH", "Ethereum", "Ethereum", "eth"],
  ["usdc", "USDC", "USD Coin", "Ethereum (ERC20)", "usdc"], ["sol", "SOL", "Solana", "Solana", "sol"],
  ["trx", "TRX", "TRON", "Tron", "trx"], ["ltc", "LTC", "Litecoin", "Litecoin", "ltc"],
  ["doge", "DOGE", "Dogecoin", "Dogecoin", "doge"], ["xrp", "XRP", "XRP", "XRP Ledger", "xrp", true],
  ["bnbbsc", "BNB", "BNB", "BNB Smart Chain (BEP20)", "bnb"],
].map(([code, symbol, name, network, icon, requiresExtraId = false]) => ({ code, symbol, name, network, icon, requiresExtraId }));
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const walletButtons = [...document.querySelectorAll(".utility.wallet")];
const balanceButtons = [...document.querySelectorAll(".utility.balance")];

let currentUser = null;
let walletSnapshot = null;
let currencies = [];
let activeDepositId = null;
let activeDepositCurrency = null;
let depositPollTimer = null;
const depositRequestIds = new Map();
let busy = false;

function iconUrl(assetOrCode) {
  const icon = typeof assetOrCode === "object" ? assetOrCode?.icon : assetOrCode;
  return `${ICON_ROOT}/${icon || "usdt"}.svg`;
}

function createAssetField(name, context) {
  return `<div class="wallet-asset-control" data-asset-control="${context}">
    <select class="wallet-native-select" name="${name}" aria-label="Currency" required tabindex="-1"></select>
    <button class="wallet-asset-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" data-asset-trigger>
      <img src="${iconUrl("usdt")}" alt="" data-asset-icon />
      <span class="wallet-asset-label" data-asset-label>Select currency</span>
      <span class="wallet-asset-balance" data-asset-balance></span>
      <span class="wallet-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="wallet-asset-menu" role="listbox" aria-label="Choose currency" data-asset-menu hidden></div>
  </div>`;
}

function createWalletDialog() {
  const overlay = document.createElement("div");
  overlay.className = "wallet-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
      <h2 class="sr-only" id="wallet-title">GamRace Wallet</h2>
      <button class="wallet-close" type="button" aria-label="Close wallet">×</button>
      <div class="wallet-tabs" role="tablist" aria-label="Wallet actions">
        <button class="wallet-tab active" type="button" role="tab" aria-selected="true" data-wallet-tab="deposit">Deposit</button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="withdraw">Withdraw</button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="buy"><span class="wallet-tab-desktop">Buy Crypto</span><span class="wallet-tab-mobile">Buy</span></button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="tip"><span class="wallet-tab-desktop">Tip User</span><span class="wallet-tab-mobile">Tip</span></button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="vault">Vault</button>
      </div>
      <div class="wallet-body">
        <section class="wallet-panel" data-wallet-panel="deposit">
          <div class="wallet-stack" data-wallet-deposit-controls>
            <label><span>Currency</span>${createAssetField("payCurrency", "deposit")}</label>
            <label><span>Network</span><div class="wallet-readonly-field" data-deposit-network>Tron (TRC20)</div></label>
          </div>
          <div class="deposit-instructions" data-deposit-instructions>
            <div class="deposit-address-row"><span data-deposit-address-label>Deposit address</span><div><code data-deposit-address></code><button type="button" data-copy-address aria-label="Copy deposit address">Copy</button></div></div>
            <div class="deposit-memo-row" data-deposit-memo-row hidden><span>Memo / destination tag</span><div><code data-deposit-memo></code><button type="button" data-copy-memo aria-label="Copy memo">Copy</button></div></div>
            <p class="wallet-network-warning" data-deposit-warning>Loading a secure live deposit address…</p>
            <div class="wallet-qr wallet-qr-loading" data-deposit-qr aria-label="Deposit address QR code"><span>Preparing QR…</span></div>
            <button class="wallet-retry" type="button" data-deposit-retry hidden>Retry address</button>
          </div>
          <button class="wallet-history-toggle" type="button" data-open-transactions>Transaction history</button>
        </section>

        <section class="wallet-panel" data-wallet-panel="withdraw" hidden>
          <form class="wallet-stack" data-wallet-form="withdraw">
            <label><span>Balance</span>${createAssetField("payoutCurrency", "withdraw")}</label>
            <label><span>Network</span><div class="wallet-readonly-field" data-withdraw-network>Tron (TRC20)</div></label>
            <label><span data-withdraw-address-label>Wallet address</span><input name="address" type="text" minlength="10" maxlength="256" autocomplete="off" spellcheck="false" placeholder="Enter destination address" required /></label>
            <label data-withdraw-memo-field hidden><span>Memo / destination tag</span><input name="extraId" type="text" maxlength="128" autocomplete="off" spellcheck="false" placeholder="Required for this currency" /></label>
            <label><span>Amount <small data-withdraw-available></small></span><span class="wallet-input-shell wallet-coin-input"><img src="${iconUrl("usdt")}" alt="" data-withdraw-amount-icon /><input name="amount" type="number" min="0.00000001" step="0.00000001" inputmode="decimal" placeholder="0.00000000" required /></span></label>
            <div class="wallet-percentages" aria-label="Quick withdrawal amounts">
              <button type="button" data-withdraw-percent="0.25">25%</button><button type="button" data-withdraw-percent="0.5">50%</button><button type="button" data-withdraw-percent="0.75">75%</button><button type="button" data-withdraw-percent="1">MAX</button>
            </div>
            <p class="wallet-fee-note">Network and provider fees are confirmed during owner review before the payout is sent.</p>
            <button class="wallet-primary" type="submit">Request withdrawal</button>
          </form>
          <button class="wallet-history-toggle" type="button" data-open-transactions>Transaction history</button>
        </section>

        <section class="wallet-panel wallet-placeholder-panel" data-wallet-panel="buy" hidden>
          <span class="wallet-placeholder-icon" aria-hidden="true">＋</span><h3>Buy Crypto</h3><p>This section is reserved for the future card and bank purchase provider.</p>
        </section>
        <section class="wallet-panel wallet-placeholder-panel" data-wallet-panel="tip" hidden>
          <span class="wallet-placeholder-icon" aria-hidden="true">↗</span><h3>Tip User</h3><p>This section is reserved for player-to-player tips.</p>
        </section>
        <section class="wallet-panel wallet-placeholder-panel" data-wallet-panel="vault" hidden>
          <span class="wallet-placeholder-icon" aria-hidden="true">◇</span><h3>Vault</h3><p>This section is reserved for protected balances.</p>
        </section>

        <p class="wallet-status" role="status" aria-live="polite"></p>
      </div>
    </section>`;
  document.body.append(overlay);
  return {
    overlay,
    close: overlay.querySelector(".wallet-close"),
    tabs: [...overlay.querySelectorAll("[data-wallet-tab]")],
    panels: [...overlay.querySelectorAll("[data-wallet-panel]")],
    withdrawalForm: overlay.querySelector('[data-wallet-form="withdraw"]'),
    depositSelect: overlay.querySelector('[name="payCurrency"]'),
    withdrawalSelect: overlay.querySelector('[name="payoutCurrency"]'),
    depositNetwork: overlay.querySelector("[data-deposit-network]"),
    withdrawalNetwork: overlay.querySelector("[data-withdraw-network]"),
    withdrawalAvailable: overlay.querySelector("[data-withdraw-available]"),
    withdrawalMemoField: overlay.querySelector("[data-withdraw-memo-field]"),
    withdrawalAmountIcon: overlay.querySelector("[data-withdraw-amount-icon]"),
    instructions: overlay.querySelector("[data-deposit-instructions]"),
    depositAddress: overlay.querySelector("[data-deposit-address]"),
    depositAddressLabel: overlay.querySelector("[data-deposit-address-label]"),
    depositMemoRow: overlay.querySelector("[data-deposit-memo-row]"),
    depositMemo: overlay.querySelector("[data-deposit-memo]"),
    depositWarning: overlay.querySelector("[data-deposit-warning]"),
    depositQr: overlay.querySelector("[data-deposit-qr]"),
    depositRetry: overlay.querySelector("[data-deposit-retry]"),
    copyAddress: overlay.querySelector("[data-copy-address]"),
    copyMemo: overlay.querySelector("[data-copy-memo]"),
    transactionLinks: [...overlay.querySelectorAll("[data-open-transactions]")],
    status: overlay.querySelector(".wallet-status"),
  };
}

const dialog = createWalletDialog();

function assetFor(code) {
  return currencies.find((asset) => asset.code === code) || walletSnapshot?.balances?.find((asset) => asset.code === code) || currencies[0];
}

function balanceFor(code) {
  return walletSnapshot?.balances?.find((balance) => balance.code === code) || { available: "0.00000000", held: "0.00000000" };
}

function cleanCryptoAmount(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "0.00";
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function setStatus(message = "", state = "") {
  dialog.status.textContent = message;
  if (state) dialog.status.dataset.state = state;
  else delete dialog.status.dataset.state;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  dialog.overlay.querySelectorAll("button, input, select").forEach((element) => {
    if (!element.classList.contains("wallet-close")) element.disabled = nextBusy;
  });
}

async function api(path, options = {}) {
  if (LOCAL_PREVIEW) {
    if (path === "/currencies") return { currencies: PREVIEW_ASSETS };
    if (path === "/wallet") return { wallet: walletSnapshot, activity: [] };
    if (path === "/wallet/selection") {
      walletSnapshot.selectedCurrency = JSON.parse(options.body).currency;
      return { wallet: walletSnapshot };
    }
    if (path === "/deposits") {
      const payCurrency = JSON.parse(options.body).payCurrency;
      return { deposit: {
        id: `preview-${payCurrency}`, status: "waiting", payCurrency,
        requestedUsdCents: 100,
        payAddress: payCurrency === "xrp" ? "rGamRacePreviewAddress123456789" : "0xGamRacePreviewAddress1234567890",
        payinExtraId: payCurrency === "xrp" ? "248091" : "", network: assetFor(payCurrency)?.network,
      } };
    }
    throw new Error("Live financial actions are disabled in the local design preview");
  }
  if (!currentUser) throw new Error("Sign in to use the wallet");
  const token = await currentUser.getIdToken();
  const response = await fetch(`${WALLET_API_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The wallet service could not complete that request");
  return body;
}

function ensureHeaderControls() {
  balanceButtons.forEach((button) => {
    let icon = button.querySelector(".balance-coin-icon");
    if (!icon) {
      icon = document.createElement("img");
      icon.className = "balance-coin-icon";
      icon.alt = "";
      button.prepend(icon);
    }
    if (!button.querySelector(".balance-caret")) {
      const caret = document.createElement("span");
      caret.className = "balance-caret";
      caret.textContent = "⌄";
      caret.setAttribute("aria-hidden", "true");
      button.append(caret);
    }
  });
  walletButtons.forEach((button) => {
    if (!button.querySelector(".wallet-button-icon")) {
      const icon = document.createElement("span");
      icon.className = "wallet-button-icon";
      icon.setAttribute("aria-hidden", "true");
      button.prepend(icon);
    }
  });
}

function updateHeader() {
  const selectedCode = walletSnapshot?.selectedCurrency || "usdttrc20";
  const asset = assetFor(selectedCode) || { icon: "usdt", symbol: "USDT" };
  const balance = balanceFor(selectedCode);
  balanceButtons.forEach((button) => {
    const icon = button.querySelector(".balance-coin-icon");
    const value = button.querySelector(".balance-value");
    if (icon) { icon.src = iconUrl(asset); icon.alt = asset.symbol || ""; }
    if (value) value.textContent = money(walletSnapshot?.selectedUsdCents || 0);
    button.title = `${cleanCryptoAmount(balance.available)} ${asset.symbol || selectedCode.toUpperCase()}`;
  });
}

function friendlyStatus(status) {
  const labels = {
    pending_review: "Pending review", processing: "Processing", finished: "Complete",
    rejected: "Rejected", cancelled: "Cancelled", failed: "Failed", refunded: "Refunded",
  };
  return labels[String(status || "").toLowerCase()] || String(status || "Pending").replaceAll("_", " ");
}

function fillAssetSelect(select, allowedAssets = currencies) {
  const previous = select.value;
  const control = select.closest(".wallet-asset-control");
  const menu = control?.querySelector("[data-asset-menu]");
  select.replaceChildren();
  if (menu) menu.replaceChildren();
  allowedAssets.forEach((asset) => {
    const option = new Option(`${asset.name} (${asset.symbol}) · ${asset.network}`, asset.code);
    select.append(option);
    if (menu) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "wallet-asset-option";
      item.dataset.assetCode = asset.code;
      item.setAttribute("role", "option");
      item.innerHTML = `<img src="${iconUrl(asset)}" alt="" /><span><strong>${asset.symbol}</strong><small>${asset.name} · ${asset.network}</small></span><i aria-hidden="true">✓</i>`;
      item.addEventListener("click", () => {
        select.value = asset.code;
        menu.hidden = true;
        control.querySelector("[data-asset-trigger]").setAttribute("aria-expanded", "false");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      menu.append(item);
    }
  });
  const desired = allowedAssets.some((asset) => asset.code === previous) ? previous : walletSnapshot?.selectedCurrency;
  if (desired && [...select.options].some((option) => option.value === desired)) select.value = desired;
}

function updateAssetControl(context) {
  const select = context === "deposit" ? dialog.depositSelect : dialog.withdrawalSelect;
  const asset = assetFor(select.value);
  if (!asset) return;
  const control = dialog.overlay.querySelector(`[data-asset-control="${context}"]`);
  control.querySelector("[data-asset-icon]").src = iconUrl(asset);
  control.querySelector("[data-asset-label]").textContent = `${asset.name} (${asset.symbol}) · ${asset.network}`;
  control.querySelector("[data-asset-balance]").textContent = context === "withdraw" ? `${cleanCryptoAmount(balanceFor(asset.code).available)} ${asset.symbol}` : "";
  control.querySelectorAll("[data-asset-code]").forEach((item) => {
    const selected = item.dataset.assetCode === asset.code;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  if (context === "deposit") dialog.depositNetwork.textContent = asset.network;
  else {
    const available = balanceFor(asset.code).available;
    dialog.withdrawalNetwork.textContent = asset.network;
    dialog.withdrawalAvailable.textContent = `Available: ${cleanCryptoAmount(available)} ${asset.symbol}`;
    dialog.withdrawalAmountIcon.src = iconUrl(asset);
    dialog.withdrawalMemoField.hidden = !asset.requiresExtraId;
    dialog.withdrawalMemoField.querySelector("input").required = Boolean(asset.requiresExtraId);
  }
}

function refreshControls() {
  fillAssetSelect(dialog.depositSelect, currencies);
  const positiveBalances = currencies.filter((asset) => Number(balanceFor(asset.code).available) > 0);
  const selectedAsset = assetFor(walletSnapshot?.selectedCurrency);
  fillAssetSelect(dialog.withdrawalSelect, positiveBalances.length ? positiveBalances : (selectedAsset ? [selectedAsset] : currencies.slice(0, 1)));
  updateAssetControl("deposit");
  updateAssetControl("withdraw");
  updateHeader();
}

async function loadWallet() {
  const result = await api("/wallet");
  walletSnapshot = result.wallet;
  if (currencies.length) refreshControls();
}

async function loadCurrencies() {
  if (currencies.length) return;
  const result = await api("/currencies");
  currencies = result.currencies || [];
  if (!currencies.length) throw new Error("No approved wallet currencies are available right now");
  refreshControls();
}

async function selectWalletCurrency(currency) {
  if (!currency || walletSnapshot?.selectedCurrency === currency) return;
  const result = await api("/wallet/selection", { method: "POST", body: JSON.stringify({ currency }) });
  walletSnapshot = result.wallet;
  refreshControls();
}

function selectTab(name) {
  dialog.tabs.forEach((tab) => {
    const selected = tab.dataset.walletTab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  dialog.panels.forEach((panel) => { panel.hidden = panel.dataset.walletPanel !== name; });
  setStatus();
  if (name === "deposit" && !dialog.overlay.hidden && currencies.length) {
    ensureDepositAddress(dialog.depositSelect.value).catch((error) => setStatus(error.message, "error"));
  }
}

async function openWallet(defaultTab = "deposit") {
  if (!currentUser) {
    const signIn = document.querySelector(".auth.login");
    if (signIn) signIn.click();
    else window.location.href = "index.html?auth=login";
    return;
  }
  selectTab(defaultTab);
  dialog.overlay.hidden = false;
  document.body.classList.add("modal-open");
  setStatus("Loading wallet…");
  try {
    await Promise.all([loadWallet(), loadCurrencies()]);
    refreshControls();
    setStatus();
    if (defaultTab === "deposit") await ensureDepositAddress(dialog.depositSelect.value);
  } catch (error) { setStatus(error.message, "error"); }
  dialog.close.focus();
}

function closeWallet() {
  dialog.overlay.hidden = true;
  document.body.classList.remove("modal-open");
  if (depositPollTimer) clearTimeout(depositPollTimer);
  depositPollTimer = null;
}

function closeAssetMenus(exceptControl = null) {
  dialog.overlay.querySelectorAll(".wallet-asset-control").forEach((control) => {
    if (control === exceptControl) return;
    const menu = control.querySelector("[data-asset-menu]");
    const trigger = control.querySelector("[data-asset-trigger]");
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function setDepositLoading(asset) {
  activeDepositCurrency = asset?.code || null;
  dialog.depositAddress.textContent = "Preparing secure address…";
  dialog.depositAddressLabel.textContent = `${asset?.name || "Crypto"} (${asset?.network || "selected network"}) address`;
  dialog.depositMemoRow.hidden = true;
  dialog.depositMemo.textContent = "";
  dialog.depositWarning.textContent = "Creating a live address for the selected network…";
  dialog.depositQr.classList.add("wallet-qr-loading");
  dialog.depositQr.innerHTML = "<span>Preparing QR…</span>";
  dialog.depositRetry.hidden = true;
}

async function ensureDepositAddress(currency, force = false) {
  const asset = assetFor(currency);
  if (!asset || dialog.overlay.hidden) return;
  if (!force && activeDepositId && activeDepositCurrency === asset.code && dialog.depositAddress.textContent) return;
  if (busy) return;
  setBusy(true);
  if (depositPollTimer) clearTimeout(depositPollTimer);
  depositPollTimer = null;
  activeDepositId = null;
  setDepositLoading(asset);
  let requestId = depositRequestIds.get(asset.code);
  if (!requestId || force) {
    requestId = crypto.randomUUID().replaceAll("-", "");
    depositRequestIds.set(asset.code, requestId);
  }
  try {
    const result = await api("/deposits", {
      method: "POST",
      body: JSON.stringify({ requestId, payCurrency: asset.code }),
    });
    renderDeposit(result.deposit);
  } catch (error) {
    if (depositRequestIds.get(asset.code) === requestId) depositRequestIds.delete(asset.code);
    dialog.depositQr.classList.add("wallet-qr-loading");
    dialog.depositQr.innerHTML = "<span>Address unavailable</span>";
    dialog.depositWarning.textContent = "The address could not be loaded. Please retry in a moment.";
    dialog.depositRetry.hidden = false;
    throw error;
  } finally {
    setBusy(false);
  }
}

function renderQr(value) {
  dialog.depositQr.replaceChildren();
  dialog.depositQr.classList.remove("wallet-qr-loading");
  if (typeof window.qrcode !== "function") {
    dialog.depositQr.textContent = "QR code unavailable";
    return;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(value);
  qr.make();
  dialog.depositQr.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });
}

function renderDeposit(deposit) {
  activeDepositId = deposit.id;
  activeDepositCurrency = deposit.payCurrency;
  const asset = assetFor(deposit.payCurrency) || { symbol: String(deposit.payCurrency).toUpperCase(), network: deposit.network || "selected" };
  dialog.depositAddress.textContent = deposit.payAddress;
  dialog.depositAddressLabel.textContent = `${asset.name || asset.symbol} (${asset.network || deposit.network}) address`;
  dialog.depositMemoRow.hidden = !deposit.payinExtraId;
  dialog.depositMemo.textContent = deposit.payinExtraId || "";
  const minimumDepositUsd = Math.max(0, Number(deposit.requestedUsdCents || 100)) / 100;
  dialog.depositWarning.textContent = `Minimum deposit: $${minimumDepositUsd.toFixed(2)} USD equivalent. Only send ${asset.symbol} on ${asset.network || deposit.network}. Using another coin or network can permanently lose funds.`;
  renderQr(deposit.payAddress);
  dialog.depositRetry.hidden = true;
  if (deposit.credited || ["failed", "refunded", "expired"].includes(deposit.status)) {
    if (deposit.credited) loadWallet().catch(() => {});
    return;
  }
  depositPollTimer = setTimeout(pollDeposit, 10000);
}

async function pollDeposit() {
  if (!activeDepositId || dialog.overlay.hidden) return;
  try {
    const result = await api(`/deposits/${encodeURIComponent(activeDepositId)}`);
    renderDeposit(result.deposit);
  } catch (error) {
    setStatus(error.message, "error");
    depositPollTimer = setTimeout(pollDeposit, 15000);
  }
}

async function copyText(value, button) {
  await navigator.clipboard.writeText(value);
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = original; }, 1200);
}

ensureHeaderControls();
walletButtons.forEach((button) => button.addEventListener("click", () => openWallet("deposit")));
balanceButtons.forEach((button) => button.addEventListener("click", () => openWallet("withdraw")));
dialog.close.addEventListener("click", closeWallet);
dialog.overlay.addEventListener("click", (event) => { if (event.target === dialog.overlay) closeWallet(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dialog.overlay.hidden) closeWallet(); });
dialog.tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.walletTab)));
dialog.overlay.querySelectorAll("[data-asset-trigger]").forEach((trigger) => trigger.addEventListener("click", () => {
  const control = trigger.closest(".wallet-asset-control");
  const menu = control.querySelector("[data-asset-menu]");
  const willOpen = menu.hidden;
  closeAssetMenus(willOpen ? control : null);
  menu.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", String(willOpen));
}));
dialog.overlay.addEventListener("click", (event) => {
  if (!event.target.closest(".wallet-asset-control")) closeAssetMenus();
});
dialog.copyAddress.addEventListener("click", () => copyText(dialog.depositAddress.textContent, dialog.copyAddress));
dialog.copyMemo.addEventListener("click", () => copyText(dialog.depositMemo.textContent, dialog.copyMemo));
dialog.depositRetry.addEventListener("click", () => {
  ensureDepositAddress(dialog.depositSelect.value, true).catch((error) => setStatus(error.message, "error"));
});
dialog.transactionLinks.forEach((button) => button.addEventListener("click", () => {
  closeWallet();
  window.dispatchEvent(new CustomEvent("gamrace:open-transactions"));
}));

dialog.depositSelect.addEventListener("change", async () => {
  updateAssetControl("deposit");
  try {
    await selectWalletCurrency(dialog.depositSelect.value);
    await ensureDepositAddress(dialog.depositSelect.value);
  } catch (error) { setStatus(error.message, "error"); }
});
dialog.withdrawalSelect.addEventListener("change", async () => {
  updateAssetControl("withdraw");
  try { await selectWalletCurrency(dialog.withdrawalSelect.value); } catch (error) { setStatus(error.message, "error"); }
});

dialog.overlay.querySelectorAll("[data-withdraw-percent]").forEach((button) => button.addEventListener("click", () => {
  const available = Number(balanceFor(dialog.withdrawalSelect.value).available || 0);
  const amount = Math.floor(available * Number(button.dataset.withdrawPercent) * 100000000) / 100000000;
  dialog.withdrawalForm.elements.amount.value = amount ? amount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : "";
}));

dialog.withdrawalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const data = new FormData(dialog.withdrawalForm);
  setBusy(true);
  setStatus("Validating the destination and reserving this balance…");
  try {
    const result = await api("/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        requestId: crypto.randomUUID().replaceAll("-", ""), amount: data.get("amount"),
        payoutCurrency: dialog.withdrawalSelect.value, address: data.get("address"), extraId: data.get("extraId"),
      }),
    });
    dialog.withdrawalForm.reset();
    setStatus(`Withdrawal ${friendlyStatus(result.withdrawal.status).toLowerCase()}.`, "success");
    await loadWallet();
    refreshControls();
  } catch (error) { setStatus(error.message, "error"); }
  finally { setBusy(false); }
});

if (LOCAL_PREVIEW) {
  currentUser = { getIdToken: async () => "preview" };
  currencies = PREVIEW_ASSETS;
  walletSnapshot = {
    selectedCurrency: "usdttrc20",
    selectedUsdCents: 128450,
    balances: PREVIEW_ASSETS.map((asset) => ({ ...asset, available: asset.code === "usdttrc20" ? "1284.50000000" : "0.00000000", held: "0.00000000" })),
  };
  refreshControls();
  openWallet("deposit");
} else {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    walletSnapshot = null;
    activeDepositId = null;
    activeDepositCurrency = null;
    depositRequestIds.clear();
    if (!user) {
      updateHeader();
      if (!dialog.overlay.hidden) closeWallet();
      return;
    }
    try {
      await Promise.all([loadWallet(), loadCurrencies()]);
      refreshControls();
    } catch { updateHeader(); }
  });
}
