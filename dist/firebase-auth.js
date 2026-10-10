import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, getFirestore, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getPlayerRankStats } from "./player-rank-service.js?v=rank-badges-1";
import { ACTIVITY_TABS, NOTIFICATION_GROUPS, PROFILE_MENU, PROFILE_VISIBILITY_OPTIONS, RESPONSIBLE_PLAY_CONTROLS, SETTINGS_SECTIONS, TIME_FILTERS } from "./profile-config.js";
import { profileServices } from "./profile-services.js";

const firebaseConfig = {
  apiKey: "AIzaSyBS3pib3PsHnSJGaQqBc--S99qI7sqhDuU",
  authDomain: "gamrace.com",
  projectId: "gamrace",
  storageBucket: "gamrace.firebasestorage.app",
  messagingSenderId: "576202313103",
  appId: "1:576202313103:web:8e3153a6816b7bf8658ffa",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const googleButtons = [...document.querySelectorAll(".google-auth")];
const authStatus = document.querySelector("#auth-status");
const authModal = document.querySelector("#auth-modal");
const headerSignIn = document.querySelector(".auth.login");
const headerRegister = document.querySelector(".auth.register");
const profileButton = document.querySelector(".profile-action");
const WALLET_API_BASE_URL = "https://gamrace-wallet-api.gamracecom.workers.dev";
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
const USERNAME_ADJECTIVES = ["Swift", "Lucky", "Royal", "Turbo", "Neon", "Rapid", "Prime", "Bold", "Ace", "Epic"];
const USERNAME_NOUNS = ["Falcon", "Racer", "Comet", "Knight", "Tiger", "Rocket", "Crown", "Wolf", "Viper", "Phoenix"];

let currentProfile = null;
let profileBusy = false;
let preferences = profileServices.preferences.load();
provider.setCustomParameters({ prompt: "select_account" });
auth.useDeviceLanguage();

function setStatus(message = "", state = "") {
  if (!authStatus) return;
  authStatus.textContent = message;
  if (state) authStatus.dataset.state = state;
  else delete authStatus.dataset.state;
}

async function syncPlayerUsername(user) {
  const token = await user.getIdToken();
  const response = await fetch(`${WALLET_API_BASE_URL}/profile/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Player profile sync failed");
}

function setGoogleButtonsBusy(busy) {
  googleButtons.forEach((button) => {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  });
}

function randomItem(items) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return items[value[0] % items.length];
}

function randomDigits() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(1000 + (value[0] % 9000));
}

function randomUsername() {
  return `${randomItem(USERNAME_ADJECTIVES)}${randomItem(USERNAME_NOUNS)}${randomDigits()}`;
}

function usernameKey(username) { return username.trim().toLowerCase(); }

function validateUsername(username) {
  if (!USERNAME_PATTERN.test(username.trim())) return "Use 3–20 characters. Start with a letter and use only letters, numbers, or underscores.";
  return "";
}

function formatMoney(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}

function toggleMarkup(option, value = false, disabled = false) {
  return `<label class="account-toggle-row"><span><strong>${option.label}</strong><small>${option.detail || ""}</small></span><input type="checkbox" data-preference="${option.id}" ${value ? "checked" : ""} ${disabled ? "disabled" : ""} /><i aria-hidden="true"></i></label>`;
}

function settingsNavigationMarkup() {
  return SETTINGS_SECTIONS.map((section, index) => `<button class="settings-nav-button ${index === 0 ? "active" : ""}" type="button" data-settings-section="${section.id}" aria-selected="${index === 0}">${section.label}</button>`).join("");
}

function notificationMarkup() {
  return NOTIFICATION_GROUPS.map((group) => `<article class="account-card notification-group"><div class="account-card-heading"><div><span class="section-kicker">${group.label.toUpperCase()}</span><h4>${group.label} alerts</h4></div><span class="status-chip">IN-APP</span></div>${group.items.map((label) => toggleMarkup({ id: `notification-${group.id}-${label.toLowerCase().replaceAll(" ", "-")}`, label, detail: "Delivery channels will sync when the notification service is connected." }, true)).join("")}</article>`).join("");
}

function responsiblePlayMarkup() {
  return RESPONSIBLE_PLAY_CONTROLS.map((control) => `<article class="responsible-control"><div><strong>${control.label}</strong><p>${control.detail}</p><small>Current limit: Not set</small></div><button class="account-outline-button" type="button" disabled>Set limit</button></article>`).join("");
}

function createAccountMenu() {
  const menu = document.createElement("div");
  menu.className = "account-menu";
  menu.hidden = true;
  menu.innerHTML = `<section class="account-menu-rank" aria-label="Current rank progress"><div class="menu-rank-heading"><span class="menu-rank-badge"><span class="menu-rank-fallback">R</span><img class="menu-rank-image" alt="" /><b class="menu-rank-tier">I</b></span><span><small>YOUR RANK</small><strong class="menu-rank-name">Rookie I</strong><em class="menu-rank-subtitle">Starting Grid</em></span></div><div class="menu-rank-progress-copy"><span class="menu-rank-values">$0 / $1,000</span><strong class="menu-rank-next">Next: Rookie II</strong></div><div class="menu-rank-track"><i class="menu-rank-fill"></i></div></section><nav class="account-menu-items" aria-label="Account menu">${PROFILE_MENU.map((item) => `<button class="account-menu-item ${item.dividerBefore ? "divider-before" : ""} ${item.danger ? "danger" : ""}" type="button" data-account-menu-item="${item.id}" ${item.ownerOnly ? "hidden" : ""}>${item.label}</button>`).join("")}</nav>`;
  document.body.append(menu);
  return {
    element: menu,
    items: [...menu.querySelectorAll("[data-account-menu-item]")],
    ownerItem: menu.querySelector('[data-account-menu-item="control-panel"]'),
    rankBadge: menu.querySelector(".menu-rank-badge"), rankImage: menu.querySelector(".menu-rank-image"), rankFallback: menu.querySelector(".menu-rank-fallback"), rankTier: menu.querySelector(".menu-rank-tier"), rankName: menu.querySelector(".menu-rank-name"), rankSubtitle: menu.querySelector(".menu-rank-subtitle"), rankValues: menu.querySelector(".menu-rank-values"), rankNext: menu.querySelector(".menu-rank-next"), rankFill: menu.querySelector(".menu-rank-fill"),
  };
}

function createProfileDialog() {
  const overlay = document.createElement("div");
  overlay.className = "profile-overlay";
  overlay.id = "profile-modal";
  overlay.hidden = true;
  const panelItems = PROFILE_MENU.filter((item) => item.kind === "panel");
  overlay.innerHTML = `
    <section class="profile-modal account-workspace" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <button class="profile-close" type="button" aria-label="Close account">×</button>
      <div class="profile-shell">
        <aside class="profile-sidebar"><div class="profile-heading"><span class="profile-kicker">GAMRACE ACCOUNT</span><h2 id="profile-dialog-title">Account</h2></div><nav class="profile-tabs" aria-label="Account sections">${panelItems.map((item, index) => `<button class="profile-tab ${index === 0 ? "active" : ""}" type="button" data-profile-section="${item.id}" aria-selected="${index === 0}">${item.label}</button>`).join("")}</nav></aside>
        <div class="profile-content">
          <section class="profile-section" data-profile-panel="profile">
            <span class="profile-section-label">PUBLIC PROFILE</span><h3>Profile</h3><p class="settings-copy">Control the identity and information other players can see.</p>
            <article class="profile-identity account-card"><span class="profile-avatar" aria-hidden="true"></span><div><strong class="profile-current-name"></strong><span class="profile-email"></span><small class="profile-join-date">Member since —</small></div><span class="profile-inline-rank">Rookie I</span></article>
            <div class="account-grid two-column"><article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">PUBLIC PROFILE</span><h4>Player identity</h4></div></div><div class="account-data-list"><div><span>Avatar</span><strong>Initial avatar</strong></div><div><span>Username</span><strong class="profile-data-username">—</strong></div><div><span>Display name</span><strong class="profile-display-name">—</strong></div><div><span>Bio</span><strong>Not set</strong></div><div><span>Profile URL</span><strong class="profile-url">gamrace.com/u/—</strong></div></div></article><article class="account-card visibility-card"><div class="account-card-heading"><div><span class="section-kicker">VISIBILITY</span><h4>Profile visibility</h4></div></div>${PROFILE_VISIBILITY_OPTIONS.map((option) => toggleMarkup(option, preferences[option.id])).join("")}</article></div>
          </section>

          <section class="profile-section" data-profile-panel="vip" hidden>
            <span class="profile-section-label">VIP & REWARDS</span><h3>My Rank</h3><p class="settings-copy">Your lifetime weighted wager determines your racing progression.</p>
            <article class="rank-card" aria-labelledby="profile-rank-name"><div class="rank-card-heading"><div class="rank-badge" aria-hidden="true"><span class="rank-badge-fallback"></span><img class="rank-badge-image" alt="" /><span class="rank-badge-tier"></span></div><div class="rank-title-group"><span class="rank-eyebrow">PLAYER RANK</span><h3 id="profile-rank-name" class="rank-name"></h3><p class="rank-subtitle"></p></div><div class="rank-tier-indicators" aria-label="Rank sub-level"><span data-rank-tier="I">I</span><span data-rank-tier="II">II</span><span data-rank-tier="III">III</span></div></div><div class="rank-wager-line"><span>Lifetime weighted wager</span><strong class="rank-lifetime-wager"></strong></div><div class="rank-progress-copy"><span class="rank-progress-values"></span><strong class="rank-next"></strong></div><div class="rank-progress-track" role="progressbar" aria-label="Progress to next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="rank-progress-fill"></span></div><div class="rank-benefits"><span>Current benefits</span><strong>Rank benefits will appear when rewards are configured.</strong></div></article>
            <div class="account-grid three-column reward-summary"><article class="metric-card"><span>Available rewards</span><strong>$0.00</strong><small>No rewards ready</small></article><article class="metric-card"><span>Claimed rewards</span><strong>$0.00</strong><small>All time</small></article><article class="metric-card"><span>Rakeback</span><strong>—</strong><small>Unlocks with VIP benefits</small></article></div>
            <article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">REWARDS</span><h4>Reward centre</h4></div><span class="status-chip">COMING ONLINE</span></div><div class="reward-list"><span>Daily bonus</span><span>Weekly bonus</span><span>Monthly bonus</span><span>Reloads</span><span>Level-up rewards</span><span>Reward history</span></div></article>
            <article class="account-card redeem-card"><div><span class="section-kicker">REDEEM CODE</span><h4>Promo or reward code</h4><p>Code redemption will activate when the rewards service is connected.</p></div><div><input type="text" placeholder="Enter code" disabled /><button type="button" disabled>Redeem</button></div></article>
          </section>

          <section class="profile-section" data-profile-panel="transactions" hidden>
            <span class="profile-section-label">TRANSACTIONS</span><h3>Play history</h3><p class="settings-copy">Review bets, player matches, and performance statistics.</p>
            <div class="account-subtabs" role="tablist">${ACTIVITY_TABS.map((tab, index) => `<button class="account-subtab ${index === 0 ? "active" : ""}" type="button" data-activity-tab="${tab.id}" aria-selected="${index === 0}">${tab.label}</button>`).join("")}</div><div class="account-filters">${TIME_FILTERS.map((filter, index) => `<button type="button" class="account-filter ${index === 3 ? "active" : ""}">${filter}</button>`).join("")}</div>
            <div data-activity-panel="bets"><div class="bet-category-chips"><span>Casino bets</span><span>Originals</span><span>Slots</span><span>Live casino</span><span>Open bets</span><span>Settled bets</span></div><div class="account-table"><div class="account-table-head"><span>Game</span><span>Bet</span><span>Multiplier</span><span>Payout</span><span>Result</span><span>Date</span></div><div class="account-empty"><strong>No bets yet</strong><span>Your settled and open bets will appear here.</span></div></div></div>
            <div data-activity-panel="pvp" hidden><div class="account-table"><div class="account-table-head pvp"><span>Opponent</span><span>Game</span><span>Stake</span><span>Result</span><span>Profit / loss</span><span>Date</span></div><div class="account-empty"><strong>No PvP matches yet</strong><span>Player-versus-player results will appear here.</span></div></div></div>
            <div data-activity-panel="statistics" hidden><div class="statistics-grid"></div></div>
          </section>

          <section class="profile-section" data-profile-panel="affiliates" hidden>
            <span class="profile-section-label">AFFILIATES</span><h3>Affiliate centre</h3><p class="settings-copy">Track referrals, campaigns, earnings, and marketing assets.</p>
            <div class="account-grid five-column affiliate-metrics"><article><span>Total referred</span><strong>0</strong></article><article><span>Active referrals</span><strong>0</strong></article><article><span>Total earnings</span><strong>$0.00</strong></article><article><span>Pending</span><strong>$0.00</strong></article><article><span>Available</span><strong>$0.00</strong></article></div>
            <article class="account-card referral-card"><div><span class="section-kicker">REFERRAL LINKS</span><h4>Your main referral link</h4><p>Campaign tracking will activate with the affiliate backend.</p></div><div class="copy-field"><code class="referral-link">gamrace.com/?ref=—</code><button type="button" disabled>Copy</button></div></article>
            <div class="account-grid two-column"><article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">CAMPAIGNS</span><h4>Campaign manager</h4></div><button type="button" disabled>New campaign</button></div><div class="account-empty compact"><strong>No campaigns</strong><span>Campaign name, custom code, clicks, registrations, depositors, revenue, and commission will be tracked here.</span></div></article><article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">EARNINGS</span><h4>Commission history</h4></div></div><div class="account-empty compact"><strong>No commission activity</strong><span>Pending, paid, and claimable earnings will appear here.</span></div></article></div>
            <article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">MARKETING</span><h4>Promotional assets</h4></div><span class="status-chip">PLANNED</span></div><div class="reward-list"><span>Banners</span><span>GamRace logos</span><span>Promotional assets</span><span>Copyable links</span></div></article>
          </section>

          <section class="profile-section settings-section" data-profile-panel="settings" hidden>
            <span class="profile-section-label">SETTINGS</span><h3>Account settings</h3><p class="settings-copy">Manage your account, security, privacy, and play controls.</p>
            <div class="settings-layout"><nav class="settings-navigation" aria-label="Settings sections">${settingsNavigationMarkup()}</nav><div class="settings-panels">
              <section data-settings-panel="account"><div class="account-card-heading"><div><span class="section-kicker">ACCOUNT</span><h4>Account details</h4></div></div><form class="username-form account-form-grid"><label><span>Email</span><input class="settings-email" type="email" disabled /></label><label><span>Username</span><input id="profile-username" name="username" type="text" minlength="3" maxlength="20" autocomplete="off" spellcheck="false" required /></label><label><span>Display name</span><input class="settings-display-name" type="text" disabled /></label><label><span>Date of birth</span><input type="text" value="Not set" disabled /></label><label><span>Country</span><input type="text" value="Not set" disabled /></label><label><span>Language</span><select disabled><option>English</option></select></label><label><span>Display currency</span><select disabled><option>USD</option></select></label><label><span>Timezone</span><input type="text" value="Device timezone" disabled /></label><p class="username-help">Your username can be changed once.</p><button class="auth-submit username-save" type="submit">Save username</button><p class="profile-status" role="status" aria-live="polite"></p></form></section>
              <section data-settings-panel="verification" hidden><div class="account-card-heading"><div><span class="section-kicker">VERIFICATION</span><h4>Verification levels</h4></div><span class="status-chip">LEVEL 1</span></div><div class="verification-levels"></div><p class="service-note">Document submission will become available when the licensed KYC service is connected.</p></section>
              <section data-settings-panel="security" hidden><div class="account-card-heading"><div><span class="section-kicker">SECURITY</span><h4>Security controls</h4></div><span class="status-chip">PROTECTED</span></div><div class="security-list"><article><div><strong>Password</strong><span>Google manages the password for linked Google accounts.</span></div><button disabled>Change password</button></article><article><div><strong>Two-factor authentication</strong><span>Authenticator setup and recovery codes require the security backend.</span></div><button disabled>Set up 2FA</button></article><article><div><strong>Passkeys</strong><span>Add, view, and remove passkeys.</span></div><button disabled>Add passkey</button></article><article><div><strong>Linked accounts</strong><span>Google is connected. Apple and additional providers can be added later.</span></div><button disabled>Google connected</button></article><article><div><strong>Withdrawal security</strong><span>2FA for withdrawals and tips, address whitelist, cooldown, and email confirmation.</span></div><button disabled>Configure</button></article></div></section>
              <section data-settings-panel="sessions" hidden><div class="account-card-heading"><div><span class="section-kicker">SESSIONS & DEVICES</span><h4>Active sessions</h4></div><button class="account-outline-button" type="button" disabled>Refresh</button></div><div class="session-list"></div><div class="account-card-heading login-history-heading"><div><span class="section-kicker">LOGIN HISTORY</span><h4>Recent sign-ins</h4></div></div><div class="account-empty compact"><strong>No server history yet</strong><span>Successful and failed sign-ins will appear when session logging is connected.</span></div></section>
              <section data-settings-panel="notifications" hidden><div class="notification-panels">${notificationMarkup()}</div><article class="account-card"><div class="account-card-heading"><div><span class="section-kicker">CHANNELS</span><h4>Delivery channels</h4></div></div><div class="reward-list"><span>In-app</span><span>Email</span><span>Push notification</span></div></article></section>
              <section data-settings-panel="privacy" hidden><div class="account-card-heading"><div><span class="section-kicker">PRIVACY</span><h4>Privacy controls</h4></div></div>${PROFILE_VISIBILITY_OPTIONS.map((option) => toggleMarkup(option, preferences[option.id])).join("")}${toggleMarkup({ id: "allowTips", label: "Allow tips", detail: "Allow other GamRace users to send you tips." }, preferences.allowTips)}${toggleMarkup({ id: "marketingConsent", label: "Marketing consent", detail: "Receive promotions and casino offers." }, preferences.marketingConsent)}<div class="privacy-actions"><button disabled>Request account data</button><button disabled>Download account data</button><button class="danger" disabled>Request account closure</button></div></section>
              <section data-settings-panel="responsible-play" hidden><div class="account-card-heading"><div><span class="section-kicker">RESPONSIBLE PLAY</span><h4>Play controls</h4></div><span class="status-chip warning">PROTECTION</span></div><div class="responsible-warning">Increasing or removing a limit may require a cooling-off delay. Protections will never be removed instantly once the licensed safer-gambling service is connected.</div><div class="responsible-list">${responsiblePlayMarkup()}</div></section>
            </div></div>
          </section>

          <section class="profile-section" data-profile-panel="support" hidden><span class="profile-section-label">SUPPORT</span><h3>How can we help?</h3><p class="settings-copy">Choose the right support route for your question.</p><div class="support-status"><i></i><span><strong>Support setup in progress</strong><small>Estimated response time will appear when live chat is connected.</small></span></div><div class="support-options"><button disabled><strong>Live Chat</strong><span>Talk with player support</span></button><button disabled><strong>Help Centre</strong><span>Browse help articles</span></button><button disabled><strong>My Support Tickets</strong><span>Review existing requests</span></button><button disabled><strong>Report a Problem</strong><span>Tell us about a site issue</span></button><button disabled><strong>Responsible Gambling Help</strong><span>Access safer-play support</span></button></div></section>
        </div>
      </div>
    </section>`;
  document.body.append(overlay);
  return {
    overlay, close: overlay.querySelector(".profile-close"), tabs: [...overlay.querySelectorAll("[data-profile-section]")], panels: [...overlay.querySelectorAll("[data-profile-panel]")], settingsTabs: [...overlay.querySelectorAll("[data-settings-section]")], settingsPanels: [...overlay.querySelectorAll("[data-settings-panel]")], activityTabs: [...overlay.querySelectorAll("[data-activity-tab]")], activityPanels: [...overlay.querySelectorAll("[data-activity-panel]")], currentName: overlay.querySelector(".profile-current-name"), email: overlay.querySelector(".profile-email"), avatar: overlay.querySelector(".profile-avatar"), joinDate: overlay.querySelector(".profile-join-date"), inlineRank: overlay.querySelector(".profile-inline-rank"), dataUsername: overlay.querySelector(".profile-data-username"), displayName: overlay.querySelector(".profile-display-name"), profileUrl: overlay.querySelector(".profile-url"), settingsEmail: overlay.querySelector(".settings-email"), settingsDisplayName: overlay.querySelector(".settings-display-name"), rankBadge: overlay.querySelector(".rank-badge"), rankBadgeImage: overlay.querySelector(".rank-badge-image"), rankBadgeFallback: overlay.querySelector(".rank-badge-fallback"), rankBadgeTier: overlay.querySelector(".rank-badge-tier"), rankName: overlay.querySelector(".rank-name"), rankSubtitle: overlay.querySelector(".rank-subtitle"), rankTierIndicators: [...overlay.querySelectorAll("[data-rank-tier]")], rankLifetimeWager: overlay.querySelector(".rank-lifetime-wager"), rankProgressValues: overlay.querySelector(".rank-progress-values"), rankNext: overlay.querySelector(".rank-next"), rankProgressTrack: overlay.querySelector(".rank-progress-track"), rankProgressFill: overlay.querySelector(".rank-progress-fill"), form: overlay.querySelector(".username-form"), input: overlay.querySelector("#profile-username"), help: overlay.querySelector(".username-help"), save: overlay.querySelector(".username-save"), status: overlay.querySelector(".profile-status"), verificationLevels: overlay.querySelector(".verification-levels"), sessionList: overlay.querySelector(".session-list"), statisticsGrid: overlay.querySelector(".statistics-grid"), referralLink: overlay.querySelector(".referral-link"), preferenceInputs: [...overlay.querySelectorAll("[data-preference]")],
  };
}

const accountMenu = createAccountMenu();
const profileDialog = createProfileDialog();

function selectProfileSection(section) {
  profileDialog.tabs.forEach((tab) => { const selected = tab.dataset.profileSection === section; tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected)); });
  profileDialog.panels.forEach((panel) => { panel.hidden = panel.dataset.profilePanel !== section; });
}

function selectSettingsSection(section) {
  profileDialog.settingsTabs.forEach((tab) => { const selected = tab.dataset.settingsSection === section; tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected)); });
  profileDialog.settingsPanels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== section; });
}

function selectActivityTab(section) {
  profileDialog.activityTabs.forEach((tab) => { const selected = tab.dataset.activityTab === section; tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected)); });
  profileDialog.activityPanels.forEach((panel) => { panel.hidden = panel.dataset.activityPanel !== section; });
}

function renderRank(source) {
  const stats = getPlayerRankStats(source);
  const { rankDefinition, nextRank } = stats;
  const fallback = rankDefinition.name === "Hall of Fame" ? "HF" : rankDefinition.name.charAt(0);
  const progressValues = nextRank ? `${formatMoney(stats.lifetimeWeightedWager)} / ${formatMoney(nextRank.threshold)}` : `${formatMoney(stats.lifetimeWeightedWager)} lifetime`;
  const nextLabel = nextRank ? `Next: ${nextRank.label}` : "MAX RANK";
  profileDialog.rankBadge.classList.remove("has-image");
  profileDialog.rankBadgeImage.src = rankDefinition.badgePath;
  profileDialog.rankBadgeFallback.textContent = fallback;
  profileDialog.rankBadgeTier.textContent = rankDefinition.tier;
  profileDialog.rankName.textContent = rankDefinition.label;
  profileDialog.rankSubtitle.textContent = rankDefinition.subtitle;
  profileDialog.rankLifetimeWager.textContent = formatMoney(stats.lifetimeWeightedWager);
  profileDialog.rankProgressValues.textContent = progressValues;
  profileDialog.rankNext.textContent = nextLabel;
  profileDialog.rankNext.classList.toggle("is-max", stats.isMaxRank);
  profileDialog.rankProgressFill.style.width = `${stats.percentage}%`;
  profileDialog.rankProgressTrack.setAttribute("aria-valuenow", String(Math.round(stats.percentage)));
  profileDialog.rankTierIndicators.forEach((indicator) => indicator.classList.toggle("active", indicator.dataset.rankTier === rankDefinition.tier));
  accountMenu.rankBadge.classList.remove("has-image");
  accountMenu.rankImage.src = rankDefinition.badgePath;
  accountMenu.rankFallback.textContent = fallback;
  accountMenu.rankTier.textContent = rankDefinition.tier;
  accountMenu.rankName.textContent = rankDefinition.label;
  accountMenu.rankSubtitle.textContent = rankDefinition.subtitle;
  accountMenu.rankValues.textContent = progressValues;
  accountMenu.rankNext.textContent = nextLabel;
  accountMenu.rankFill.style.width = `${stats.percentage}%`;
  const headerMark = profileButton?.querySelector(".profile-rank-mark");
  const headerImage = profileButton?.querySelector(".profile-rank-image");
  const headerFallback = profileButton?.querySelector(".profile-rank-fallback");
  headerMark?.classList.remove("has-image");
  if (headerImage) headerImage.src = rankDefinition.badgePath;
  if (headerFallback) headerFallback.textContent = fallback;
  profileDialog.inlineRank.textContent = rankDefinition.label;
}

function profileCreatedDate(profile) {
  const raw = profile?.createdAt;
  const date = raw?.toDate?.() || (raw?.seconds ? new Date(raw.seconds * 1000) : null);
  return date && !Number.isNaN(date.valueOf()) ? `Member since ${date.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : "Member since your first GamRace sign-in";
}

function setProfileStatus(message = "", state = "") {
  profileDialog.status.textContent = message;
  if (state) profileDialog.status.dataset.state = state;
  else delete profileDialog.status.dataset.state;
}

function escapeMarkup(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function loadMockAccountData() {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const [verification, sessions, summary] = await Promise.all([
    profileServices.verification.getStatus(),
    profileServices.sessions.list(token).catch(() => ({ sessions: [], loginHistory: [] })),
    profileServices.activity.getSummary(),
  ]);
  profileDialog.verificationLevels.innerHTML = verification.levels.map((level) => `<article><span>LEVEL ${level.level}</span><div><strong>${level.name}</strong><small>${level.level === 2 ? "Government ID and selfie / liveness" : level.level === 3 ? "Proof of address" : "Basic account information"}</small></div><b class="${level.status === "Approved" ? "approved" : ""}">${level.status}</b></article>`).join("");
  profileDialog.sessionList.innerHTML = sessions.sessions.length ? sessions.sessions.map((session) => {
    const location = [session.city, session.region, session.countryCode].filter(Boolean).join(", ") || "Approximate location unavailable";
    const firstLogin = new Date(session.firstLogin).toLocaleString();
    const lastActive = session.current ? "Now" : new Date(session.lastActive).toLocaleString();
    return `<article class="session-row"><span class="session-device-mark">${session.current ? "THIS" : "DEV"}</span><div><strong>${escapeMarkup(session.device)}</strong><small>${escapeMarkup(session.operatingSystem)} · ${escapeMarkup(session.browser)}</small><small>${escapeMarkup(location)} · IP: ${escapeMarkup(session.ipAddress)}</small><small>First login: ${escapeMarkup(firstLogin)} · Last active: ${escapeMarkup(lastActive)}</small></div><b>${session.current ? "CURRENT SESSION" : "RECENT"}</b></article>`;
  }).join("") : '<div class="account-empty compact"><strong>No session history yet</strong><span>Your current device will appear after the next secure account request.</span></div>';
  const labels = { totalWagered: "Total wagered", totalBets: "Total bets", wins: "Wins", losses: "Losses", winRate: "Win rate", netProfitLoss: "Net profit / loss", biggestWin: "Biggest win", highestMultiplier: "Highest multiplier", favouriteGame: "Favourite game", mostPlayedGame: "Most played game", pvpWins: "PvP wins", pvpLosses: "PvP losses", pvpWinRate: "PvP win rate" };
  profileDialog.statisticsGrid.innerHTML = Object.entries(summary).map(([key, value]) => `<article><span>${labels[key]}</span><strong>${["totalWagered", "netProfitLoss", "biggestWin"].includes(key) ? formatMoney(value) : ["winRate", "pvpWinRate"].includes(key) ? `${value}%` : key === "highestMultiplier" ? `${value}×` : value}</strong></article>`).join("");
}

function refreshProfileDialog() {
  if (!currentProfile) return;
  const username = currentProfile.username;
  const email = auth.currentUser?.email || "";
  profileDialog.input.value = username;
  profileDialog.currentName.textContent = username;
  profileDialog.email.textContent = email;
  profileDialog.avatar.textContent = username.charAt(0).toUpperCase();
  profileDialog.joinDate.textContent = profileCreatedDate(currentProfile);
  profileDialog.dataUsername.textContent = username;
  profileDialog.displayName.textContent = auth.currentUser?.displayName || username;
  profileDialog.profileUrl.textContent = `gamrace.com/u/${username}`;
  profileDialog.settingsEmail.value = email;
  profileDialog.settingsDisplayName.value = auth.currentUser?.displayName || username;
  profileDialog.referralLink.textContent = `gamrace.com/?ref=${username}`;
  profileDialog.input.disabled = currentProfile.usernameChanged || profileBusy;
  profileDialog.save.disabled = currentProfile.usernameChanged || profileBusy;
  profileDialog.save.hidden = currentProfile.usernameChanged;
  profileDialog.help.textContent = currentProfile.usernameChanged ? "Your one username change has already been used." : "Your username can be changed once.";
  profileDialog.preferenceInputs.forEach((input) => { input.checked = Boolean(preferences[input.dataset.preference]); });
  const label = profileButton?.querySelector(".profile-label");
  if (label) label.textContent = username;
  renderRank(currentProfile);
}

function openProfileDialog({ welcome = false, section = "profile", settingsSection = "account" } = {}) {
  if (!auth.currentUser || !currentProfile) return;
  closeAccountMenu();
  setProfileStatus(welcome ? "A random username was created for you. Choose carefully—you can change it once." : "");
  refreshProfileDialog();
  selectProfileSection(section);
  if (section === "settings") selectSettingsSection(settingsSection);
  profileDialog.overlay.hidden = false;
  document.body.classList.add("modal-open");
  if (welcome && !currentProfile.usernameChanged) { profileDialog.input.focus(); profileDialog.input.select(); }
  else profileDialog.close.focus();
}

function closeProfileDialog() { profileDialog.overlay.hidden = true; document.body.classList.remove("modal-open"); }
function positionAccountMenu() {
  if (!profileButton || accountMenu.element.hidden) return;
  const buttonRect = profileButton.getBoundingClientRect();
  const menuWidth = accountMenu.element.offsetWidth;
  const pageGutter = 10;
  const left = Math.min(window.innerWidth - menuWidth - pageGutter, Math.max(pageGutter, buttonRect.right - menuWidth));
  accountMenu.element.style.top = `${Math.round(buttonRect.bottom + 8)}px`;
  accountMenu.element.style.left = `${Math.round(left)}px`;
}

function openAccountMenu() {
  if (!auth.currentUser || !currentProfile) return;
  accountMenu.element.hidden = false;
  positionAccountMenu();
  profileButton?.setAttribute("aria-expanded", "true");
}
function closeAccountMenu() { accountMenu.element.hidden = true; profileButton?.setAttribute("aria-expanded", "false"); }

async function checkOwnerAccess(user) {
  accountMenu.ownerItem.hidden = true;
  if (!user) return;
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${WALLET_API_BASE_URL}/admin/access`, { headers: { Authorization: `Bearer ${token}` } });
    accountMenu.ownerItem.hidden = !response.ok;
  } catch { accountMenu.ownerItem.hidden = true; }
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const existing = await getDoc(userRef);
  if (existing.exists()) return { profile: existing.data(), created: false };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomUsername();
    const key = usernameKey(candidate);
    const usernameRef = doc(db, "usernames", key);
    try {
      return await runTransaction(db, async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        const usernameSnapshot = await transaction.get(usernameRef);
        if (userSnapshot.exists()) return { profile: userSnapshot.data(), created: false };
        if (usernameSnapshot.exists()) throw Object.assign(new Error("Username collision"), { code: "gamrace/username-taken" });
        const profile = { username: candidate, usernameKey: key, usernameChanged: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        transaction.set(userRef, profile);
        transaction.set(usernameRef, { uid: user.uid, username: candidate, usernameKey: key, createdAt: serverTimestamp() });
        return { profile: { ...profile, createdAt: null, updatedAt: null }, created: true };
      });
    } catch (error) { if (error?.code !== "gamrace/username-taken") throw error; }
  }
  throw new Error("Could not reserve a username. Please try again.");
}

async function changeUsername(user, requestedUsername) {
  const nextUsername = requestedUsername.trim();
  const validationError = validateUsername(nextUsername);
  if (validationError) throw Object.assign(new Error(validationError), { code: "gamrace/invalid-username" });
  const nextKey = usernameKey(nextUsername);
  const userRef = doc(db, "users", user.uid);
  const nextUsernameRef = doc(db, "usernames", nextKey);
  const updatedProfile = await runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const nextUsernameSnapshot = await transaction.get(nextUsernameRef);
    if (!userSnapshot.exists()) throw Object.assign(new Error("Profile not found"), { code: "gamrace/profile-missing" });
    const profile = userSnapshot.data();
    if (profile.usernameChanged) throw Object.assign(new Error("Username already changed"), { code: "gamrace/change-used" });
    if (profile.usernameKey === nextKey) throw Object.assign(new Error("Choose a different username"), { code: "gamrace/same-username" });
    if (nextUsernameSnapshot.exists()) throw Object.assign(new Error("Username taken"), { code: "gamrace/username-taken" });
    transaction.update(userRef, { username: nextUsername, usernameKey: nextKey, usernameChanged: true, updatedAt: serverTimestamp() });
    transaction.set(nextUsernameRef, { uid: user.uid, username: nextUsername, usernameKey: nextKey, createdAt: serverTimestamp() });
    transaction.delete(doc(db, "usernames", profile.usernameKey));
    return { ...profile, username: nextUsername, usernameKey: nextKey, usernameChanged: true };
  });
  try { await updateProfile(user, { displayName: nextUsername }); } catch { /* Firestore remains the source of truth. */ }
  return updatedProfile;
}

function signedInLabel(user) { return currentProfile?.username || user?.displayName?.trim()?.split(/\s+/)[0] || "Account"; }

function renderUser(user) {
  const signedIn = Boolean(user);
  document.body.dataset.authenticated = String(signedIn);
  headerSignIn.textContent = "Sign In";
  headerSignIn.setAttribute("aria-label", "Sign in");
  headerRegister.textContent = "Sign Up";
  profileButton?.setAttribute("aria-label", signedIn ? `Account menu for ${signedInLabel(user)}` : "Account menu");
  if (signedIn) { if (authModal) authModal.hidden = true; if (profileDialog.overlay.hidden) document.body.classList.remove("modal-open"); setStatus(); }
  else { currentProfile = null; closeAccountMenu(); closeProfileDialog(); }
}

function friendlyAuthError(error) {
  if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") return "";
  if (error?.code === "auth/network-request-failed") return "Couldn’t connect to Google. Please try again.";
  if (error?.code === "auth/unauthorized-domain") return "Google sign-in isn’t available on this domain yet.";
  return "Google sign-in could not be completed. Please try again.";
}

function friendlyProfileError(error) {
  if (error?.code === "gamrace/username-taken") return "That username is already taken. Choose a different one.";
  if (error?.code === "gamrace/change-used") return "You have already changed your username once.";
  if (error?.code === "gamrace/same-username") return "Choose a different username.";
  if (error?.code === "gamrace/invalid-username") return error.message;
  if (error?.code === "permission-denied") return "That username could not be saved. Please refresh and try again.";
  return "Your username could not be saved. Please try again.";
}

async function continueWithGoogle() {
  setStatus();
  setGoogleButtonsBusy(true);
  try { await signInWithPopup(auth, provider); }
  catch (error) { const message = friendlyAuthError(error); if (message) setStatus(message, "error"); }
  finally { setGoogleButtonsBusy(false); }
}

profileDialog.rankBadgeImage.addEventListener("load", () => profileDialog.rankBadge.classList.add("has-image"));
profileDialog.rankBadgeImage.addEventListener("error", () => profileDialog.rankBadge.classList.remove("has-image"));
accountMenu.rankImage.addEventListener("load", () => accountMenu.rankBadge.classList.add("has-image"));
accountMenu.rankImage.addEventListener("error", () => accountMenu.rankBadge.classList.remove("has-image"));
profileButton?.querySelector(".profile-rank-image")?.addEventListener("load", () => profileButton.querySelector(".profile-rank-mark")?.classList.add("has-image"));
profileButton?.querySelector(".profile-rank-image")?.addEventListener("error", () => profileButton.querySelector(".profile-rank-mark")?.classList.remove("has-image"));
googleButtons.forEach((button) => button.addEventListener("click", continueWithGoogle));
profileButton?.addEventListener("click", () => accountMenu.element.hidden ? openAccountMenu() : closeAccountMenu());
accountMenu.items.forEach((button) => button.addEventListener("click", () => {
  const item = PROFILE_MENU.find((entry) => entry.id === button.dataset.accountMenuItem);
  if (!item) return;
  if (item.id === "wallet") { closeAccountMenu(); document.querySelector(".utility.wallet")?.click(); }
  else if (item.id === "logout") { closeAccountMenu(); window.dispatchEvent(new CustomEvent("gamrace-auth-signout")); }
  else if (item.id === "control-panel") window.location.href = "admin.html";
  else if (item.kind === "panel") openProfileDialog({ section: item.id });
}));
document.addEventListener("click", (event) => { if (!accountMenu.element.hidden && !accountMenu.element.contains(event.target) && !profileButton?.contains(event.target)) closeAccountMenu(); });
window.addEventListener("resize", positionAccountMenu);
profileDialog.tabs.forEach((tab) => tab.addEventListener("click", () => selectProfileSection(tab.dataset.profileSection)));
profileDialog.settingsTabs.forEach((tab) => tab.addEventListener("click", () => selectSettingsSection(tab.dataset.settingsSection)));
profileDialog.activityTabs.forEach((tab) => tab.addEventListener("click", () => selectActivityTab(tab.dataset.activityTab)));
profileDialog.close.addEventListener("click", closeProfileDialog);
profileDialog.overlay.addEventListener("click", (event) => { if (event.target === profileDialog.overlay) closeProfileDialog(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeAccountMenu(); if (!profileDialog.overlay.hidden) closeProfileDialog(); } });
profileDialog.preferenceInputs.forEach((input) => input.addEventListener("change", () => {
  preferences = profileServices.preferences.save({ ...preferences, [input.dataset.preference]: input.checked });
  profileDialog.preferenceInputs.filter((candidate) => candidate.dataset.preference === input.dataset.preference).forEach((candidate) => { candidate.checked = input.checked; });
}));
profileDialog.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth.currentUser || !currentProfile || profileBusy) return;
  const requestedUsername = profileDialog.input.value;
  const validationError = validateUsername(requestedUsername);
  if (validationError) { setProfileStatus(validationError, "error"); return; }
  profileBusy = true;
  setProfileStatus("Checking username…");
  refreshProfileDialog();
  try { currentProfile = await changeUsername(auth.currentUser, requestedUsername); renderUser(auth.currentUser); syncPlayerUsername(auth.currentUser).catch(() => {}); setProfileStatus(`Your username is now ${currentProfile.username}.`, "success"); }
  catch (error) { setProfileStatus(friendlyProfileError(error), "error"); }
  finally { profileBusy = false; refreshProfileDialog(); }
});

if (!authModal) {
  headerSignIn.addEventListener("click", () => { if (document.body.dataset.authenticated !== "true") window.location.href = "index.html?auth=login"; });
  headerRegister.addEventListener("click", () => { if (document.body.dataset.authenticated === "true") window.dispatchEvent(new CustomEvent("gamrace-auth-signout")); else window.location.href = "index.html?auth=register"; });
}
window.addEventListener("gamrace-auth-signout", async () => { try { await signOut(auth); } catch { setStatus("Sign out could not be completed. Please try again.", "error"); } });
window.addEventListener("gamrace:open-transactions", () => openProfileDialog({ section: "transactions" }));

loadMockAccountData();
onAuthStateChanged(auth, async (user) => {
  if (!user) { renderUser(null); return; }
  renderUser(user);
  try {
    const result = await ensureUserProfile(user);
    if (auth.currentUser?.uid !== user.uid) return;
    currentProfile = result.profile;
    renderUser(user);
    refreshProfileDialog();
    syncPlayerUsername(user).catch((error) => console.warn("GamRace username sync deferred", error));
    checkOwnerAccess(user);
    if (result.created) {
      try { await updateProfile(user, { displayName: currentProfile.username }); } catch { /* Firestore remains the source of truth. */ }
      openProfileDialog({ welcome: true, section: "settings", settingsSection: "account" });
    }
  } catch (error) {
    console.error("GamRace profile setup failed", error);
    setStatus("Your account signed in, but its username could not be loaded. Please refresh and try again.", "error");
  }
});
