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

const FUNCTIONS_BASE_URL = "https://europe-west2-gamrace.cloudfunctions.net/walletApi";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const walletButtons = [...document.querySelectorAll(".utility.wallet, .utility.balance")];
const balanceValues = [...document.querySelectorAll(".balance-value")];

let currentUser = null;
let walletSnapshot = null;
let currencies = [];
let activeDepositId = null;
let depositPollTimer = null;
let busy = false;

function createWalletDialog() {
  const overlay = document.createElement("div");
  overlay.className = "wallet-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
      <header class="wallet-heading">
        <div>
          <span class="wallet-eyebrow">GAMRACE WALLET</span>
          <h2 id="wallet-title">Wallet</h2>
        </div>
        <div class="wallet-heading-balance"><span>Available balance</span><strong data-wallet-balance>$0.00</strong></div>
        <button class="wallet-close" type="button" aria-label="Close wallet">×</button>
      </header>
      <div class="wallet-tabs" role="tablist" aria-label="Wallet actions">
        <button class="wallet-tab active" type="button" role="tab" aria-selected="true" data-wallet-tab="deposit">Deposit</button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="withdraw">Withdraw</button>
        <button class="wallet-tab" type="button" role="tab" aria-selected="false" data-wallet-tab="activity">Activity</button>
      </div>
      <div class="wallet-body">
        <section class="wallet-panel" data-wallet-panel="deposit">
          <div class="wallet-panel-copy">
            <h3>Deposit crypto</h3>
            <p>Choose the value to add and the cryptocurrency you want to send.</p>
          </div>
          <form class="wallet-form" data-wallet-form="deposit">
            <label><span>Amount (USD)</span><span class="wallet-input-shell"><span>$</span><input name="amountUsd" type="number" min="1" max="100000" step="0.01" inputmode="decimal" placeholder="0.00" required /></span></label>
            <label><span>Pay with</span><select name="payCurrency" required><option value="">Loading currencies…</option></select></label>
            <button class="wallet-primary" type="submit">Create deposit</button>
          </form>
          <div class="deposit-instructions" data-deposit-instructions hidden>
            <div class="deposit-state"><span>Status</span><strong data-deposit-status>Waiting for payment</strong></div>
            <div class="deposit-amount"><span>Send exactly</span><strong data-deposit-amount></strong></div>
            <div class="deposit-address-row"><span>Deposit address</span><div><code data-deposit-address></code><button type="button" data-copy-address>Copy</button></div></div>
            <div class="deposit-memo-row" data-deposit-memo-row hidden><span>Memo / tag</span><div><code data-deposit-memo></code><button type="button" data-copy-memo>Copy</button></div></div>
            <p class="wallet-warning">Only send the selected currency on the displayed network. Sending another asset or network can permanently lose funds.</p>
          </div>
        </section>
        <section class="wallet-panel" data-wallet-panel="withdraw" hidden>
          <div class="wallet-panel-copy">
            <h3>Withdraw crypto</h3>
            <p>Withdrawals are checked before the payout is approved and sent.</p>
          </div>
          <form class="wallet-form" data-wallet-form="withdraw">
            <label><span>Amount (USD)</span><span class="wallet-input-shell"><span>$</span><input name="amountUsd" type="number" min="10" max="100000" step="0.01" inputmode="decimal" placeholder="0.00" required /></span></label>
            <label><span>Receive</span><select name="payoutCurrency" required><option value="">Loading currencies…</option></select></label>
            <label class="wallet-wide-field"><span>Wallet address</span><input name="address" type="text" minlength="10" maxlength="256" autocomplete="off" spellcheck="false" placeholder="Paste the destination address" required /></label>
            <label class="wallet-wide-field"><span>Memo / tag <small>only when required</small></span><input name="extraId" type="text" maxlength="128" autocomplete="off" spellcheck="false" placeholder="Optional" /></label>
            <button class="wallet-primary wallet-wide-field" type="submit">Request withdrawal</button>
          </form>
          <p class="wallet-warning">Always confirm the asset, network, address and memo. Cryptocurrency payouts cannot be reversed after they are sent.</p>
        </section>
        <section class="wallet-panel" data-wallet-panel="activity" hidden>
          <div class="wallet-panel-copy">
            <h3>Wallet activity</h3>
            <p>Your latest deposits and withdrawals.</p>
          </div>
          <div class="wallet-activity" data-wallet-activity><p>No wallet activity yet.</p></div>
        </section>
        <p class="wallet-status" role="status" aria-live="polite"></p>
      </div>
    </section>`;
  document.body.append(overlay);
  return {
    overlay,
    close: overlay.querySelector(".wallet-close"),
    balance: overlay.querySelector("[data-wallet-balance]"),
    tabs: [...overlay.querySelectorAll("[data-wallet-tab]")],
    panels: [...overlay.querySelectorAll("[data-wallet-panel]")],
    depositForm: overlay.querySelector('[data-wallet-form="deposit"]'),
    withdrawalForm: overlay.querySelector('[data-wallet-form="withdraw"]'),
    currencySelects: [...overlay.querySelectorAll("select")],
    instructions: overlay.querySelector("[data-deposit-instructions]"),
    depositStatus: overlay.querySelector("[data-deposit-status]"),
    depositAmount: overlay.querySelector("[data-deposit-amount]"),
    depositAddress: overlay.querySelector("[data-deposit-address]"),
    depositMemoRow: overlay.querySelector("[data-deposit-memo-row]"),
    depositMemo: overlay.querySelector("[data-deposit-memo]"),
    copyAddress: overlay.querySelector("[data-copy-address]"),
    copyMemo: overlay.querySelector("[data-copy-memo]"),
    activity: overlay.querySelector("[data-wallet-activity]"),
    status: overlay.querySelector(".wallet-status"),
  };
}

const dialog = createWalletDialog();

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

function updateBalance(wallet = walletSnapshot) {
  const cents = Number(wallet?.availableUsdCents || 0);
  dialog.balance.textContent = money(cents);
  balanceValues.forEach((element) => { element.textContent = money(cents); });
}

async function api(path, options = {}) {
  if (!currentUser) throw new Error("Sign in to use the wallet");
  const token = await currentUser.getIdToken();
  const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The wallet service could not complete that request");
  return body;
}

function selectTab(name) {
  dialog.tabs.forEach((tab) => {
    const selected = tab.dataset.walletTab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  dialog.panels.forEach((panel) => { panel.hidden = panel.dataset.walletPanel !== name; });
  setStatus();
}

function friendlyStatus(status) {
  const labels = {
    waiting: "Waiting for payment",
    confirming: "Confirming on the network",
    confirmed: "Payment confirmed",
    sending: "Processing deposit",
    partially_paid: "Partially paid",
    finished: "Deposit complete",
    failed: "Payment failed",
    refunded: "Payment refunded",
    expired: "Payment expired",
    pending_review: "Pending review",
    verification_required: "Awaiting payout approval",
    verification_failed: "Approval code expired",
    processing: "Payout processing",
    rejected: "Payout rejected",
    cancelled: "Payout cancelled",
  };
  return labels[String(status || "").toLowerCase()] || String(status || "Pending").replaceAll("_", " ");
}

function renderActivity(items = []) {
  dialog.activity.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "No wallet activity yet.";
    dialog.activity.append(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("article");
    row.className = "wallet-activity-row";
    const icon = document.createElement("span");
    icon.className = `wallet-activity-icon ${item.type}`;
    icon.textContent = item.type === "deposit" ? "↓" : "↑";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.type === "deposit" ? "Deposit" : "Withdrawal";
    const detail = document.createElement("span");
    detail.textContent = `${String(item.currency || "").toUpperCase()} · ${friendlyStatus(item.status)}`;
    copy.append(title, detail);
    const amount = document.createElement("strong");
    amount.textContent = `${item.type === "deposit" ? "+" : "−"}${money(item.amountUsdCents)}`;
    row.append(icon, copy, amount);
    dialog.activity.append(row);
  });
}

async function loadWallet() {
  const result = await api("/wallet");
  walletSnapshot = result.wallet;
  updateBalance();
  renderActivity(result.activity);
}

function fillCurrencies() {
  dialog.currencySelects.forEach((select) => {
    const previous = select.value;
    select.replaceChildren(new Option("Choose currency", ""));
    currencies.forEach((currency) => {
      const network = currency.network ? ` · ${currency.network.toUpperCase()}` : "";
      select.append(new Option(`${currency.code.toUpperCase()}${network}`, currency.code));
    });
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  });
}

async function loadCurrencies() {
  if (currencies.length) return;
  const result = await api("/currencies");
  currencies = result.currencies || [];
  fillCurrencies();
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
    setStatus();
  } catch (error) {
    setStatus(error.message, "error");
  }
  dialog.close.focus();
}

function closeWallet() {
  dialog.overlay.hidden = true;
  document.body.classList.remove("modal-open");
  if (depositPollTimer) clearTimeout(depositPollTimer);
  depositPollTimer = null;
}

function renderDeposit(deposit) {
  activeDepositId = deposit.id;
  dialog.instructions.hidden = false;
  dialog.depositStatus.textContent = friendlyStatus(deposit.status);
  dialog.depositAmount.textContent = `${deposit.payAmount} ${String(deposit.payCurrency || "").toUpperCase()}`;
  dialog.depositAddress.textContent = deposit.payAddress;
  dialog.depositMemoRow.hidden = !deposit.payinExtraId;
  dialog.depositMemo.textContent = deposit.payinExtraId || "";
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

walletButtons.forEach((button) => {
  button.addEventListener("click", () => openWallet(button.classList.contains("balance") ? "activity" : "deposit"));
});

dialog.close.addEventListener("click", closeWallet);
dialog.overlay.addEventListener("click", (event) => { if (event.target === dialog.overlay) closeWallet(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !dialog.overlay.hidden) closeWallet(); });
dialog.tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.walletTab)));
dialog.copyAddress.addEventListener("click", () => copyText(dialog.depositAddress.textContent, dialog.copyAddress));
dialog.copyMemo.addEventListener("click", () => copyText(dialog.depositMemo.textContent, dialog.copyMemo));

dialog.depositForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const data = new FormData(dialog.depositForm);
  setBusy(true);
  setStatus("Creating a secure deposit address…");
  try {
    const result = await api("/deposits", {
      method: "POST",
      body: JSON.stringify({
        requestId: crypto.randomUUID().replaceAll("-", ""),
        amountUsd: data.get("amountUsd"),
        payCurrency: data.get("payCurrency"),
      }),
    });
    renderDeposit(result.deposit);
    setStatus("Deposit address created.", "success");
    dialog.depositForm.reset();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

dialog.withdrawalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const data = new FormData(dialog.withdrawalForm);
  setBusy(true);
  setStatus("Validating the destination and reserving funds…");
  try {
    const result = await api("/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        requestId: crypto.randomUUID().replaceAll("-", ""),
        amountUsd: data.get("amountUsd"),
        payoutCurrency: data.get("payoutCurrency"),
        address: data.get("address"),
        extraId: data.get("extraId"),
      }),
    });
    dialog.withdrawalForm.reset();
    setStatus(`Withdrawal ${friendlyStatus(result.withdrawal.status).toLowerCase()}.`, "success");
    await loadWallet();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  walletSnapshot = null;
  activeDepositId = null;
  if (!user) {
    updateBalance({ availableUsdCents: 0 });
    if (!dialog.overlay.hidden) closeWallet();
    return;
  }
  try {
    await loadWallet();
  } catch {
    updateBalance({ availableUsdCents: 0 });
  }
});
