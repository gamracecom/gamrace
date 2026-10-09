export const PROFILE_MENU = Object.freeze([
  Object.freeze({ id: "profile", label: "Profile", kind: "panel" }),
  Object.freeze({ id: "wallet", label: "Wallet", kind: "action" }),
  Object.freeze({ id: "vip", label: "VIP & Rewards", kind: "panel" }),
  Object.freeze({ id: "transactions", label: "Transactions", kind: "panel" }),
  Object.freeze({ id: "affiliates", label: "Affiliates", kind: "panel" }),
  Object.freeze({ id: "settings", label: "Settings", kind: "panel" }),
  Object.freeze({ id: "support", label: "Support", kind: "panel" }),
  Object.freeze({ id: "control-panel", label: "Control Panel", kind: "link", ownerOnly: true }),
  Object.freeze({ id: "logout", label: "Log out", kind: "action", dividerBefore: true, danger: true }),
]);

export const SETTINGS_SECTIONS = Object.freeze([
  Object.freeze({ id: "account", label: "Account" }),
  Object.freeze({ id: "verification", label: "Verification" }),
  Object.freeze({ id: "security", label: "Security" }),
  Object.freeze({ id: "sessions", label: "Sessions & Devices" }),
  Object.freeze({ id: "notifications", label: "Notifications" }),
  Object.freeze({ id: "privacy", label: "Privacy" }),
  Object.freeze({ id: "responsible-play", label: "Responsible Play" }),
]);

export const PROFILE_VISIBILITY_OPTIONS = Object.freeze([
  Object.freeze({ id: "profilePublic", label: "Public profile", detail: "Allow other players to view your public profile." }),
  Object.freeze({ id: "showWagers", label: "Show wager amounts", detail: "Display individual wager values on your profile." }),
  Object.freeze({ id: "showProfit", label: "Show profit and loss", detail: "Display your public profit and loss totals." }),
  Object.freeze({ id: "showFavorites", label: "Show favourite games", detail: "Display games you have added to favourites." }),
  Object.freeze({ id: "showRank", label: "Show rank", detail: "Display your current GamRace rank." }),
  Object.freeze({ id: "showOnline", label: "Show online status", detail: "Let other players know when you are online." }),
]);

export const NOTIFICATION_GROUPS = Object.freeze([
  Object.freeze({
    id: "security",
    label: "Security",
    items: Object.freeze(["New login alert", "Password changed", "2FA changed", "New device detected"]),
  }),
  Object.freeze({
    id: "wallet",
    label: "Wallet",
    items: Object.freeze(["Deposit received", "Withdrawal requested", "Withdrawal completed", "Tip received"]),
  }),
  Object.freeze({
    id: "vip",
    label: "VIP",
    items: Object.freeze(["Rank up", "New reward", "Daily reward available", "Weekly reward available", "Monthly reward available"]),
  }),
  Object.freeze({
    id: "affiliate",
    label: "Affiliate",
    items: Object.freeze(["New referral", "Commission earned", "Affiliate payout"]),
  }),
  Object.freeze({
    id: "marketing",
    label: "Marketing",
    items: Object.freeze(["Promotions", "New games", "Casino offers"]),
  }),
]);

export const RESPONSIBLE_PLAY_CONTROLS = Object.freeze([
  Object.freeze({ id: "deposit-limit", label: "Deposit limit", detail: "Control how much can be deposited daily, weekly, or monthly." }),
  Object.freeze({ id: "wager-limit", label: "Wager limit", detail: "Set a maximum wager total for a selected period." }),
  Object.freeze({ id: "loss-limit", label: "Loss limit", detail: "Set a maximum net loss for a selected period." }),
  Object.freeze({ id: "session-limit", label: "Session time limit", detail: "Limit the length of a gaming session." }),
  Object.freeze({ id: "cool-off", label: "Cool-off period", detail: "Temporarily pause play for a chosen period." }),
  Object.freeze({ id: "self-exclusion", label: "Self-exclusion", detail: "Block access for an extended period." }),
  Object.freeze({ id: "account-closure", label: "Account closure", detail: "Request permanent closure of your account." }),
]);

export const TRANSACTION_FILTERS = Object.freeze(["All", "Deposits", "Withdrawals", "Tips", "Purchases", "Bonuses"]);
export const ACTIVITY_TABS = Object.freeze([
  Object.freeze({ id: "bets", label: "My Bets" }),
  Object.freeze({ id: "pvp", label: "PvP History" }),
  Object.freeze({ id: "statistics", label: "Statistics" }),
]);
export const TIME_FILTERS = Object.freeze(["Today", "7 Days", "30 Days", "All Time"]);
