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
  ["usdttrc20", "USDT", "Tether", "Tron (TRC20)", "usdt", false, "0.01"],
  ["usdtbep20", "USDT", "Tether", "BNB Smart Chain (BEP20)", "usdt", false, "0.01"],
  ["usdtsol", "USDT", "Tether", "Solana", "usdt", false, "0.01"],
  ["usdtpolygon", "USDT", "Tether", "Polygon", "usdt", false, "0.01"],
  ["usdterc20", "USDT", "Tether", "Ethereum (ERC20)", "usdt", false, "0.01"],
  ["btc", "BTC", "Bitcoin", "Bitcoin", "btc"], ["eth", "ETH", "Ethereum", "Ethereum", "eth"],
  ["usdcsol", "USDC", "USD Coin", "Solana", "usdc", false, "0.01"],
  ["usdcpolygon", "USDC", "USD Coin", "Polygon", "usdc", false, "0.01"],
  ["usdcbase", "USDC", "USD Coin", "Base", "usdc", false, "0.01"],
  ["usdcbep20", "USDC", "USD Coin", "BNB Smart Chain (BEP20)", "usdc", false, "0.01"],
  ["usdc", "USDC", "USD Coin", "Ethereum (ERC20)", "usdc", false, "0.01"],
  ["sol", "SOL", "Solana", "Solana", "sol"], ["ltc", "LTC", "Litecoin", "Litecoin", "ltc"],
  ["trx", "TRX", "TRON", "Tron", "trx"], ["xrp", "XRP", "XRP", "XRP Ledger", "xrp", true],
  ["doge", "DOGE", "Dogecoin", "Dogecoin", "doge"], ["bnbbsc", "BNB", "BNB", "BNB Smart Chain (BEP20)", "bnb"],
].map(([code, symbol, name, network, icon, requiresExtraId = false, minimumDeposit = "0"]) => ({ code, symbol, name, network, icon, requiresExtraId, minimumDeposit }));
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const walletButtons = [...document.querySelectorAll(".utility.wallet")];
const balanceButtons = [...document.querySelectorAll(".utility.balance")];

let currentUser = null;
let walletSnapshot = null;
let walletActivity = [];
let currencies = [];
let activeDepositId = null;
let activeDepositCurrency = null;
let depositPollTimer = null;
const depositRequestIds = new Map();
const depositCache = new Map();
const depositLoadPromises = new Map();
const allowedAssetsByContext = { deposit: [], withdraw: [] };
const rememberedNetworkByContext = { deposit: new Map(), withdraw: new Map() };
let preloadGeneration = 0;
let busy = false;

function iconUrl(assetOrCode) {
  const icon = typeof assetOrCode === "object" ? assetOrCode?.icon : assetOrCode;
  return `${ICON_ROOT}/${icon || "usdt"}.svg`;
}

function networkIconKey(asset) {
  const network = String(asset?.network || "").toLowerCase();
  if (network.includes("tron")) return "trx";
  if (network.includes("bnb") || network.includes("bep20")) return "bnb";
  if (network.includes("solana")) return "sol";
  if (network.includes("polygon")) return "polygon";
  if (network.includes("ethereum") || network.includes("erc20")) return "eth";
  if (network.includes("base")) return "base";
  if (network.includes("bitcoin")) return "btc";
  if (network.includes("litecoin")) return "ltc";
  if (network.includes("dogecoin")) return "doge";
  if (network.includes("xrp")) return "xrp";
  return asset?.icon || "usdt";
}

function networkIconUrl(asset) {
  return `${ICON_ROOT}/${networkIconKey(asset)}.svg`;
}

function createAssetField(name, context) {
  return `<div class="wallet-choice-control wallet-asset-control" data-asset-control="${context}">
    <select class="wallet-native-select" name="${name}" aria-label="Currency" required tabindex="-1"></select>
    <button class="wallet-choice-trigger wallet-asset-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" data-choice-trigger>
      <img src="${iconUrl("usdt")}" alt="" data-asset-icon />
      <span class="wallet-asset-label" data-asset-label>Select currency</span>
      <span class="wallet-asset-balance" data-asset-balance></span>
      <span class="wallet-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="wallet-choice-menu wallet-asset-menu" role="listbox" aria-label="Choose currency" data-choice-menu hidden></div>
  </div>`;
}

function createNetworkField(context) {
  return `<div class="wallet-choice-control wallet-network-control" data-network-control="${context}">
    <button class="wallet-choice-trigger wallet-asset-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" data-choice-trigger>
      <img src="${iconUrl("trx")}" alt="" data-network-icon />
      <span class="wallet-asset-label" data-network-label>Select network</span>
      <span class="wallet-asset-balance" data-network-balance></span>
      <span class="wallet-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="wallet-choice-menu wallet-asset-menu" role="listbox" aria-label="Choose network" data-choice-menu hidden></div>
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
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="transactions"><span class="wallet-tab-desktop">Transactions</span><span class="wallet-tab-mobile">History</span></button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="vault">Vault</button>
      </div>
      <div class="wallet-body">
        <section class="wallet-panel" data-wallet-panel="deposit">
          <div class="wallet-stack" data-wallet-deposit-controls>
            <label><span>Currency</span>${createAssetField("payCurrency", "deposit")}</label>
            <label><span>Network</span>${createNetworkField("deposit")}</label>
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
            <label><span>Network</span>${createNetworkField("withdraw")}</label>
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
        <section class="wallet-panel" data-wallet-panel="transactions" hidden>
          <div class="wallet-transaction-filters" aria-label="Transaction filters">
            <button class="active" type="button" data-wallet-transaction-filter="all">All</button><button type="button" data-wallet-transaction-filter="deposit">Deposits</button><button type="button" data-wallet-transaction-filter="withdrawal">Withdrawals</button><button type="button" data-wallet-transaction-filter="tip">Tips</button><button type="button" data-wallet-transaction-filter="purchase">Purchases</button><button type="button" data-wallet-transaction-filter="bonus">Bonuses</button>
          </div>
          <div class="wallet-transaction-list" data-wallet-transaction-list></div>
        </section>
        <section class="wallet-panel wallet-vault-panel" data-wallet-panel="vault" hidden>
          <div class="wallet-vault-balances"><article><span>Main balance</span><strong data-vault-main-balance>$0.00</strong></article><article><span>Vault balance</span><strong>$0.00</strong></article></div>
          <div class="wallet-vault-actions"><button type="button" disabled>Move funds into vault</button><button type="button" disabled>Move funds out of vault</button></div>
          <p>Funds kept in the vault cannot be wagered until they are moved back to the main balance. Transfers will activate when the secure vault ledger is connected.</p>
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
    transactionFilters: [...overlay.querySelectorAll("[data-wallet-transaction-filter]")],
    transactionList: overlay.querySelector("[data-wallet-transaction-list]"),
    vaultMainBalance: overlay.querySelector("[data-vault-main-balance]"),
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
      const asset = assetFor(payCurrency);
      return { deposit: {
        id: `preview-${payCurrency}`, status: "address_ready", payCurrency,
        requestedUsdCents: 1, minimumDepositAmount: asset?.minimumDeposit || "0",
        payAddress: payCurrency === "xrp" ? "rGamRacePreviewAddress123456789" : "0xGamRacePreviewAddress1234567890",
        payinExtraId: payCurrency === "xrp" ? "248091" : "", network: asset?.network,
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
  if (!response.ok) {
    const error = new Error(body.error || "The wallet service could not complete that request");
    error.status = response.status;
    throw error;
  }
  return body;
}

function requestStorageKey(currency) {
  return currentUser?.uid ? `gamrace:deposit-request:${currentUser.uid}:${currency}` : "";
}

function storedDepositRequestId(currency) {
  if (depositRequestIds.has(currency)) return depositRequestIds.get(currency);
  const key = requestStorageKey(currency);
  if (!key) return null;
  try {
    const value = localStorage.getItem(key);
    if (value) depositRequestIds.set(currency, value);
    return value;
  } catch {
    return null;
  }
}

function saveDepositRequestId(currency, requestId) {
  depositRequestIds.set(currency, requestId);
  const key = requestStorageKey(currency);
  if (!key) return;
  try { localStorage.setItem(key, requestId); } catch { /* Storage can be unavailable in privacy mode. */ }
}

function forgetDepositRequestId(currency, requestId) {
  if (depositRequestIds.get(currency) === requestId) depositRequestIds.delete(currency);
  const key = requestStorageKey(currency);
  if (!key) return;
  try {
    if (localStorage.getItem(key) === requestId) localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in privacy mode. */ }
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
    if (!button.parentElement?.classList.contains("balance-control")) {
      const wrapper = document.createElement("div");
      wrapper.className = "balance-control";
      button.before(wrapper);
      wrapper.append(button);
      const menu = document.createElement("div");
      menu.className = "balance-menu";
      menu.hidden = true;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", "Choose balance");
      wrapper.append(menu);
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
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

function closeBalanceMenus(exceptButton = null) {
  balanceButtons.forEach((button) => {
    if (button === exceptButton) return;
    const menu = button.parentElement?.querySelector(".balance-menu");
    if (menu) menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
}

function walletSelectionDetail() {
  const currency = walletSnapshot?.selectedCurrency;
  const asset = assetFor(currency);
  if (!currency || !asset) return null;
  return { currency, asset: { ...asset }, balance: { ...balanceFor(currency) } };
}

function broadcastWalletSelection() {
  const detail = walletSelectionDetail();
  if (!detail) return;
  window.gamraceWalletSelection = detail;
  window.dispatchEvent(new CustomEvent("gamrace:wallet-balance-changed", { detail }));
}

function updateBalanceMenus() {
  balanceButtons.forEach((button) => {
    const menu = button.parentElement?.querySelector(".balance-menu");
    if (!menu) return;
    menu.replaceChildren();
    currencies.forEach((asset) => {
      const balance = balanceFor(asset.code);
      const selected = walletSnapshot?.selectedCurrency === asset.code;
      const option = document.createElement("button");
      option.type = "button";
      option.className = "balance-option";
      option.classList.toggle("selected", selected);
      option.dataset.currency = asset.code;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(selected));
      option.innerHTML = `<img src="${iconUrl(asset)}" alt="" /><span><strong>${asset.symbol}<small>${asset.network}</small></strong><em>${cleanCryptoAmount(balance.available)} ${asset.symbol}</em></span><i aria-hidden="true">✓</i>`;
      option.addEventListener("click", async () => {
        closeBalanceMenus();
        try { await selectWalletCurrency(asset.code); } catch (error) { setStatus(error.message, "error"); }
      });
      menu.append(option);
    });
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
  updateBalanceMenus();
  broadcastWalletSelection();
}

function friendlyStatus(status) {
  const labels = {
    pending_review: "Pending review", processing: "Processing", finished: "Complete",
    rejected: "Rejected", cancelled: "Cancelled", failed: "Failed", refunded: "Refunded",
  };
  return labels[String(status || "").toLowerCase()] || String(status || "Pending").replaceAll("_", " ");
}

function currencyGroups(allowedAssets) {
  const groups = new Map();
  allowedAssets.forEach((asset) => {
    if (!groups.has(asset.symbol)) groups.set(asset.symbol, []);
    groups.get(asset.symbol).push(asset);
  });
  return [...groups.values()];
}

function combinedAvailable(assets) {
  return assets.reduce((total, asset) => total + Number(balanceFor(asset.code).available || 0), 0);
}

function fillAssetSelect(select, allowedAssets = currencies) {
  const context = select === dialog.depositSelect ? "deposit" : "withdraw";
  const previous = select.value;
  allowedAssetsByContext[context] = allowedAssets;
  select.replaceChildren();
  allowedAssets.forEach((asset) => {
    select.append(new Option(`${asset.name} (${asset.symbol}) · ${asset.network}`, asset.code));
  });
  const desired = allowedAssets.some((asset) => asset.code === previous) ? previous : walletSnapshot?.selectedCurrency;
  if (desired && [...select.options].some((option) => option.value === desired)) select.value = desired;
  updateChoiceControls(context);
}

function updateChoiceControls(context) {
  const select = context === "deposit" ? dialog.depositSelect : dialog.withdrawalSelect;
  const allowedAssets = allowedAssetsByContext[context];
  const asset = allowedAssets.find((item) => item.code === select.value) || assetFor(select.value);
  if (!asset) return;

  const currencyControl = dialog.overlay.querySelector(`[data-asset-control="${context}"]`);
  const currencyMenu = currencyControl.querySelector("[data-choice-menu]");
  const currencyTrigger = currencyControl.querySelector("[data-choice-trigger]");
  currencyControl.querySelector("[data-asset-icon]").src = iconUrl(asset);
  currencyControl.querySelector("[data-asset-label]").textContent = `${asset.name} (${asset.symbol})`;
  const selectedGroup = allowedAssets.filter((item) => item.symbol === asset.symbol);
  currencyControl.querySelector("[data-asset-balance]").textContent = context === "withdraw" ? `${cleanCryptoAmount(combinedAvailable(selectedGroup))} ${asset.symbol}` : "";
  currencyMenu.replaceChildren();
  currencyGroups(allowedAssets).forEach((group) => {
    const representative = group[0];
    const selected = representative.symbol === asset.symbol;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "wallet-asset-option";
    item.dataset.assetSymbol = representative.symbol;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selected));
    item.classList.toggle("selected", selected);
    const detail = group.length > 1 ? `${group.length} networks available` : representative.network;
    item.innerHTML = `<img src="${iconUrl(representative)}" alt="" /><span><strong>${representative.name} (${representative.symbol})</strong><small>${detail}</small></span><i aria-hidden="true">✓</i>`;
    item.addEventListener("click", () => {
      const rememberedCode = rememberedNetworkByContext[context].get(representative.symbol);
      const currentCode = asset.symbol === representative.symbol ? asset.code : null;
      const walletCode = assetFor(walletSnapshot?.selectedCurrency)?.symbol === representative.symbol ? walletSnapshot.selectedCurrency : null;
      const nextAsset = group.find((candidate) => candidate.code === rememberedCode)
        || group.find((candidate) => candidate.code === currentCode)
        || group.find((candidate) => candidate.code === walletCode)
        || group[0];
      select.value = nextAsset.code;
      rememberedNetworkByContext[context].set(nextAsset.symbol, nextAsset.code);
      closeAssetMenus();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    currencyMenu.append(item);
  });

  const networkControl = dialog.overlay.querySelector(`[data-network-control="${context}"]`);
  const networkMenu = networkControl.querySelector("[data-choice-menu]");
  const networkTrigger = networkControl.querySelector("[data-choice-trigger]");
  networkControl.querySelector("[data-network-icon]").src = networkIconUrl(asset);
  networkControl.querySelector("[data-network-label]").textContent = asset.network;
  networkControl.querySelector("[data-network-balance]").textContent = context === "withdraw" ? `${cleanCryptoAmount(balanceFor(asset.code).available)} ${asset.symbol}` : "";
  networkMenu.replaceChildren();
  selectedGroup.forEach((networkAsset) => {
    const selected = networkAsset.code === asset.code;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "wallet-asset-option wallet-network-option";
    item.dataset.assetCode = networkAsset.code;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selected));
    item.classList.toggle("selected", selected);
    const detail = context === "withdraw" ? `${cleanCryptoAmount(balanceFor(networkAsset.code).available)} ${networkAsset.symbol} available` : `${networkAsset.symbol} network`;
    item.innerHTML = `<img src="${networkIconUrl(networkAsset)}" alt="" /><span><strong>${networkAsset.network}</strong><small>${detail}</small></span><i aria-hidden="true">✓</i>`;
    item.addEventListener("click", () => {
      select.value = networkAsset.code;
      rememberedNetworkByContext[context].set(networkAsset.symbol, networkAsset.code);
      closeAssetMenus();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    networkMenu.append(item);
  });
  const hasMultipleNetworks = selectedGroup.length > 1;
  networkTrigger.classList.toggle("single-choice", !hasMultipleNetworks);
  networkTrigger.querySelector(".wallet-chevron").hidden = !hasMultipleNetworks;
  networkTrigger.setAttribute("aria-label", hasMultipleNetworks ? `Choose ${asset.symbol} network` : `${asset.network} is the only available network`);
  currencyTrigger.setAttribute("aria-label", `Choose currency. ${asset.name} selected`);
}

function updateAssetControl(context) {
  const select = context === "deposit" ? dialog.depositSelect : dialog.withdrawalSelect;
  const asset = assetFor(select.value);
  if (!asset) return;
  rememberedNetworkByContext[context].set(asset.symbol, asset.code);
  updateChoiceControls(context);
  if (context === "withdraw") {
    const available = balanceFor(asset.code).available;
    dialog.withdrawalAvailable.textContent = `Available: ${cleanCryptoAmount(available)} ${asset.symbol}`;
    dialog.withdrawalAmountIcon.src = iconUrl(asset);
    dialog.withdrawalForm.elements.amount.min = asset.minimumWithdrawal || "0.00000001";
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
  walletActivity = result.activity || [];
  if (currencies.length) refreshControls();
}

function renderWalletTransactions(filter = "all") {
  dialog.transactionFilters.forEach((button) => button.classList.toggle("active", button.dataset.walletTransactionFilter === filter));
  const rows = walletActivity.filter((item) => filter === "all" || item.type === filter);
  dialog.transactionList.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "wallet-transaction-empty";
    empty.innerHTML = "<strong>No transactions yet</strong><span>Your wallet activity will appear here.</span>";
    dialog.transactionList.append(empty);
    return;
  }
  rows.forEach((item) => {
    const row = document.createElement("article");
    row.className = "wallet-activity-row";
    const asset = assetFor(item.currency);
    row.innerHTML = `<img class="wallet-activity-icon" src="${iconUrl(asset || item.currency)}" alt="" /><div><strong>${item.type === "withdrawal" ? "Withdrawal" : item.type === "deposit" ? "Deposit" : "Wallet activity"}</strong><span>${asset?.symbol || String(item.currency || "").toUpperCase()} · ${String(item.status || "Pending").replaceAll("_", " ")}</span></div><strong>${item.type === "withdrawal" ? "−" : "+"}${cleanCryptoAmount(item.amount)} ${asset?.symbol || ""}</strong>`;
    dialog.transactionList.append(row);
  });
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
  if (name === "transactions") renderWalletTransactions("all");
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
  dialog.overlay.querySelectorAll(".wallet-choice-control").forEach((control) => {
    if (control === exceptControl) return;
    const menu = control.querySelector("[data-choice-menu]");
    const trigger = control.querySelector("[data-choice-trigger]");
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

async function getOrCreateDepositAddress(currency, force = false) {
  const asset = assetFor(currency);
  const userUid = currentUser?.uid || "preview";
  if (!asset) throw new Error("That deposit currency is not available");
  if (!force && depositCache.has(asset.code)) return depositCache.get(asset.code);
  if (!force && depositLoadPromises.has(asset.code)) return depositLoadPromises.get(asset.code);

  let requestId = storedDepositRequestId(asset.code);
  if (!requestId || force) {
    requestId = crypto.randomUUID().replaceAll("-", "");
    saveDepositRequestId(asset.code, requestId);
  }

  const load = api("/deposits", {
    method: "POST",
    body: JSON.stringify({ requestId, payCurrency: asset.code }),
  }).then((result) => {
    if ((currentUser?.uid || "preview") === userUid) depositCache.set(asset.code, result.deposit);
    return result.deposit;
  }).catch((error) => {
    forgetDepositRequestId(asset.code, requestId);
    throw error;
  }).finally(() => {
    if (depositLoadPromises.get(asset.code) === load) depositLoadPromises.delete(asset.code);
  });
  depositLoadPromises.set(asset.code, load);
  return load;
}

async function loadSavedDepositAddresses() {
  const result = await api("/deposit-addresses");
  (result.deposits || []).forEach((deposit) => {
    if (deposit?.payCurrency && deposit?.payAddress) depositCache.set(deposit.payCurrency, deposit);
  });
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
  try {
    const deposit = await getOrCreateDepositAddress(asset.code, force);
    if (!dialog.overlay.hidden && dialog.depositSelect.value === asset.code) renderDeposit(deposit);
  } catch (error) {
    dialog.depositQr.classList.add("wallet-qr-loading");
    dialog.depositQr.innerHTML = "<span>Address unavailable</span>";
    dialog.depositWarning.textContent = "The address could not be loaded. Please retry in a moment.";
    dialog.depositRetry.hidden = false;
    throw error;
  } finally {
    setBusy(false);
  }
}

async function preloadDepositAddresses(generation = preloadGeneration) {
  const preferred = walletSnapshot?.selectedCurrency;
  const queue = [...currencies]
    .filter((asset) => !depositCache.has(asset.code))
    .sort((left, right) => Number(right.code === preferred) - Number(left.code === preferred));
  // Provider payment creation is deliberately sequential. A burst of many
  // requests caused rate/minimum races and left some currencies unavailable;
  // saved addresses still render immediately from the server-side cache.
  while (queue.length && generation === preloadGeneration && currentUser) {
    const asset = queue.shift();
    try {
      await getOrCreateDepositAddress(asset.code);
    } catch (error) {
      if ([429, 502, 503].includes(Number(error.status)) && generation === preloadGeneration) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        try { await getOrCreateDepositAddress(asset.code, true); } catch { /* Leave this asset retryable in the UI. */ }
      }
    }
    if (queue.length) await new Promise((resolve) => setTimeout(resolve, 1200));
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
  depositCache.set(deposit.payCurrency, deposit);
  activeDepositId = deposit.id;
  activeDepositCurrency = deposit.payCurrency;
  const asset = assetFor(deposit.payCurrency) || { symbol: String(deposit.payCurrency).toUpperCase(), network: deposit.network || "selected" };
  dialog.depositAddress.textContent = deposit.payAddress;
  dialog.depositAddressLabel.textContent = `${asset.name || asset.symbol} (${asset.network || deposit.network}) address`;
  dialog.depositMemoRow.hidden = !deposit.payinExtraId;
  dialog.depositMemo.textContent = deposit.payinExtraId || "";
  const minimumDeposit = cleanCryptoAmount(deposit.minimumDepositAmount || asset.minimumDeposit || "0");
  dialog.depositWarning.textContent = `Minimum deposit: ${minimumDeposit} ${asset.symbol}. Only send ${asset.symbol} on ${asset.network || deposit.network}. Using another coin or network can permanently lose funds.`;
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
balanceButtons.forEach((button) => button.addEventListener("click", () => {
  if (!currentUser) {
    const signIn = document.querySelector(".auth.login");
    if (signIn) signIn.click();
    return;
  }
  const menu = button.parentElement?.querySelector(".balance-menu");
  if (!menu) return;
  const willOpen = menu.hidden;
  closeBalanceMenus(willOpen ? button : null);
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}));
dialog.close.addEventListener("click", closeWallet);
dialog.overlay.addEventListener("click", (event) => { if (event.target === dialog.overlay) closeWallet(); });
document.addEventListener("click", (event) => { if (!event.target.closest(".balance-control")) closeBalanceMenus(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeBalanceMenus();
  if (!dialog.overlay.hidden) closeWallet();
});
dialog.tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.walletTab)));
dialog.overlay.querySelectorAll("[data-choice-trigger]").forEach((trigger) => trigger.addEventListener("click", () => {
  const control = trigger.closest(".wallet-choice-control");
  const menu = control.querySelector("[data-choice-menu]");
  if (!menu.children.length || trigger.classList.contains("single-choice")) return;
  const willOpen = menu.hidden;
  closeAssetMenus(willOpen ? control : null);
  menu.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", String(willOpen));
}));
dialog.overlay.addEventListener("click", (event) => {
  if (!event.target.closest(".wallet-choice-control")) closeAssetMenus();
});
dialog.copyAddress.addEventListener("click", () => copyText(dialog.depositAddress.textContent, dialog.copyAddress));
dialog.copyMemo.addEventListener("click", () => copyText(dialog.depositMemo.textContent, dialog.copyMemo));
dialog.depositRetry.addEventListener("click", () => {
  ensureDepositAddress(dialog.depositSelect.value, true).catch((error) => setStatus(error.message, "error"));
});
dialog.transactionLinks.forEach((button) => button.addEventListener("click", () => selectTab("transactions")));
dialog.transactionFilters.forEach((button) => button.addEventListener("click", () => renderWalletTransactions(button.dataset.walletTransactionFilter)));

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
    preloadGeneration += 1;
    const generation = preloadGeneration;
    currentUser = user;
    walletSnapshot = null;
    activeDepositId = null;
    activeDepositCurrency = null;
    depositRequestIds.clear();
    depositCache.clear();
    depositLoadPromises.clear();
    if (!user) {
      updateHeader();
      if (!dialog.overlay.hidden) closeWallet();
      return;
    }
    try {
      await Promise.all([loadWallet(), loadCurrencies(), loadSavedDepositAddresses()]);
      refreshControls();
      void preloadDepositAddresses(generation);
    } catch { updateHeader(); }
  });
}
