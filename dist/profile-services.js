const PREFERENCE_KEY = "gamrace-account-preferences-v1";
const CLIENT_SESSION_KEY = "gamrace-client-session-v1";
const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";

const DEFAULT_PREFERENCES = Object.freeze({
  profilePublic: true,
  showWagers: false,
  showProfit: false,
  showFavorites: true,
  showRank: true,
  showOnline: true,
  allowTips: true,
  marketingConsent: false,
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

export const profileServices = Object.freeze({
  preferences: Object.freeze({
    load() {
      return { ...DEFAULT_PREFERENCES, ...readStoredPreferences() };
    },
    save(nextPreferences) {
      const safe = { ...DEFAULT_PREFERENCES, ...nextPreferences };
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(safe));
      return safe;
    },
  }),
  verification: Object.freeze({
    async getStatus() {
      return {
        currentLevel: 1,
        levels: [
          { level: 1, name: "Basic Information", status: "Approved" },
          { level: 2, name: "Identity Verification", status: "Not started" },
          { level: 3, name: "Address Verification", status: "Locked" },
        ],
      };
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
    async getSummary() {
      return {
        totalWagered: 0,
        totalBets: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        netProfitLoss: 0,
        biggestWin: 0,
        highestMultiplier: 0,
        favouriteGame: "—",
        mostPlayedGame: "—",
        pvpWins: 0,
        pvpLosses: 0,
        pvpWinRate: 0,
      };
    },
  }),
});
