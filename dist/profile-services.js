const PREFERENCE_KEY = "gamrace-account-preferences-v1";
const CLIENT_SESSION_KEY = "gamrace-client-session-v1";
const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";

const DEFAULT_PREFERENCES = Object.freeze({
  profilePublic: true,
  showUsername: true,
  showWagers: false,
  showProfit: false,
  showFavorites: true,
  showRank: true,
  showOnline: true,
  allowTips: true,
  marketingConsent: false,
  loginAlerts: true,
  withdrawalConfirmation: true,
  displayCurrency: "USD",
});

function readStoredPreferences() {
  try {
    return JSON.parse(localStorage.getItem(PREFERENCE_KEY) || "{}");
  } catch {
    return {};
  }
}

function clientSessionId() {
  try {
    let value = localStorage.getItem(CLIENT_SESSION_KEY);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(CLIENT_SESSION_KEY, value);
    }
    return value;
  } catch {
    return "browser-session";
  }
}

async function accountRequest(token, path, options = {}) {
  if (!token) throw new Error("Sign in to load your account");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Session-Id": clientSessionId(),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "Your live account data is temporarily unavailable"), { status: response.status });
  return body;
}

export const profileServices = Object.freeze({
  account: Object.freeze({
    async getSnapshot(token, { compact = false } = {}) {
      return accountRequest(token, `/account${compact ? "?compact=1" : ""}`);
    },
    async getActivity(token, { page = 1, pageSize = 20 } = {}) {
      return accountRequest(token, `/account/activity?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`);
    },
    async saveDetails(token, details) {
      return accountRequest(token, "/account/details", { method: "POST", body: JSON.stringify(details) });
    },
  }),
  preferences: Object.freeze({
    load() {
      return { ...DEFAULT_PREFERENCES, ...readStoredPreferences() };
    },
    save(nextPreferences) {
      const safe = { ...DEFAULT_PREFERENCES, ...nextPreferences };
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(safe));
      return safe;
    },
    async loadRemote(token) {
      const snapshot = await accountRequest(token, "/account?compact=1");
      const safe = { ...DEFAULT_PREFERENCES, ...readStoredPreferences(), ...(snapshot.preferences || {}) };
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(safe));
      return { preferences: safe, summary: snapshot.summary || {} };
    },
    async saveRemote(token, nextPreferences) {
      const safe = { ...DEFAULT_PREFERENCES, ...nextPreferences };
      const result = await accountRequest(token, "/account/preferences", {
        method: "POST",
        body: JSON.stringify({ preferences: safe }),
      });
      const saved = { ...DEFAULT_PREFERENCES, ...(result.preferences || safe) };
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(saved));
      return saved;
    },
  }),
  promotions: Object.freeze({
    async claim(token, code) {
      return accountRequest(token, "/promotions/claim", { method: "POST", body: JSON.stringify({ code }) });
    },
  }),
  sessions: Object.freeze({
    async list(token) {
      if (!token) return { sessions: [], loginHistory: [] };
      const response = await fetch(`${API_BASE}/sessions`, {
        headers: { Authorization: `Bearer ${token}`, "X-Session-Id": clientSessionId() },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Session history is temporarily unavailable");
      const body = await response.json();
      return { sessions: body.sessions || [], loginHistory: [] };
    },
  }),
  activity: Object.freeze({
    async getSummary(token) {
      const snapshot = await accountRequest(token, "/account?compact=1");
      return snapshot.summary || {};
    },
  }),
});
