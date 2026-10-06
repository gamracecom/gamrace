import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getPlayerRankStats } from "./player-rank-service.js";

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

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
const USERNAME_ADJECTIVES = ["Swift", "Lucky", "Royal", "Turbo", "Neon", "Rapid", "Prime", "Bold", "Ace", "Epic"];
const USERNAME_NOUNS = ["Falcon", "Racer", "Comet", "Knight", "Tiger", "Rocket", "Crown", "Wolf", "Viper", "Phoenix"];

let currentProfile = null;
let profileBusy = false;

provider.setCustomParameters({ prompt: "select_account" });
auth.useDeviceLanguage();

function setStatus(message = "", state = "") {
  if (!authStatus) return;
  authStatus.textContent = message;
  if (state) authStatus.dataset.state = state;
  else delete authStatus.dataset.state;
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

function usernameKey(username) {
  return username.trim().toLowerCase();
}

function validateUsername(username) {
  const trimmed = username.trim();
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Use 3–20 characters. Start with a letter and use only letters, numbers, or underscores.";
  }
  return "";
}

function createProfileDialog() {
  const overlay = document.createElement("div");
  overlay.className = "profile-overlay";
  overlay.id = "profile-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <button class="profile-close" type="button" aria-label="Close profile">×</button>
      <div class="profile-shell">
        <aside class="profile-sidebar">
          <div class="profile-heading">
            <span class="profile-kicker">ACCOUNT</span>
            <h2 id="profile-dialog-title">Profile</h2>
          </div>
          <nav class="profile-tabs" aria-label="Profile sections">
            <button class="profile-tab active" type="button" data-profile-section="overview" aria-selected="true">Overview</button>
            <button class="profile-tab" type="button" data-profile-section="settings" aria-selected="false">Settings</button>
          </nav>
        </aside>
        <div class="profile-content">
          <section class="profile-section" data-profile-panel="overview">
            <span class="profile-section-label">PROFILE</span>
            <div class="profile-identity">
              <span class="profile-avatar" aria-hidden="true"></span>
              <div>
                <strong class="profile-current-name"></strong>
                <span class="profile-email"></span>
              </div>
            </div>
            <article class="rank-card" aria-labelledby="profile-rank-name">
              <div class="rank-card-heading">
                <div class="rank-badge" aria-hidden="true">
                  <span class="rank-badge-fallback"></span>
                  <img class="rank-badge-image" alt="" />
                  <span class="rank-badge-tier"></span>
                </div>
                <div class="rank-title-group">
                  <span class="rank-eyebrow">PLAYER RANK</span>
                  <h3 id="profile-rank-name" class="rank-name"></h3>
                  <p class="rank-subtitle"></p>
                </div>
                <div class="rank-tier-indicators" aria-label="Rank sub-level">
                  <span data-rank-tier="I">I</span>
                  <span data-rank-tier="II">II</span>
                  <span data-rank-tier="III">III</span>
                </div>
              </div>
              <div class="rank-wager-line">
                <span>Lifetime weighted wager</span>
                <strong class="rank-lifetime-wager"></strong>
              </div>
              <div class="rank-progress-copy">
                <span class="rank-progress-values"></span>
                <strong class="rank-next"></strong>
              </div>
              <div class="rank-progress-track" role="progressbar" aria-label="Progress to next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span class="rank-progress-fill"></span>
              </div>
            </article>
          </section>
          <section class="profile-section" data-profile-panel="settings" hidden>
            <span class="profile-section-label">SETTINGS</span>
            <h3>Username</h3>
            <p class="settings-copy">Set the name other players will see.</p>
            <form class="username-form">
              <label class="auth-field" for="profile-username">Username</label>
              <span class="auth-input-wrap"><input id="profile-username" name="username" type="text" minlength="3" maxlength="20" autocomplete="off" spellcheck="false" required /></span>
              <p class="username-help">Your username can be changed once.</p>
              <button class="auth-submit username-save" type="submit">Save username</button>
              <p class="profile-status" role="status" aria-live="polite"></p>
            </form>
          </section>
        </div>
      </div>
    </section>`;
  document.body.append(overlay);
  return {
    overlay,
    close: overlay.querySelector(".profile-close"),
    tabs: [...overlay.querySelectorAll("[data-profile-section]")],
    panels: [...overlay.querySelectorAll("[data-profile-panel]")],
    currentName: overlay.querySelector(".profile-current-name"),
    email: overlay.querySelector(".profile-email"),
    avatar: overlay.querySelector(".profile-avatar"),
    rankBadge: overlay.querySelector(".rank-badge"),
    rankBadgeImage: overlay.querySelector(".rank-badge-image"),
    rankBadgeFallback: overlay.querySelector(".rank-badge-fallback"),
    rankBadgeTier: overlay.querySelector(".rank-badge-tier"),
    rankName: overlay.querySelector(".rank-name"),
    rankSubtitle: overlay.querySelector(".rank-subtitle"),
    rankTierIndicators: [...overlay.querySelectorAll("[data-rank-tier]")],
    rankLifetimeWager: overlay.querySelector(".rank-lifetime-wager"),
    rankProgressValues: overlay.querySelector(".rank-progress-values"),
    rankNext: overlay.querySelector(".rank-next"),
    rankProgressTrack: overlay.querySelector(".rank-progress-track"),
    rankProgressFill: overlay.querySelector(".rank-progress-fill"),
    form: overlay.querySelector(".username-form"),
    input: overlay.querySelector("#profile-username"),
    help: overlay.querySelector(".username-help"),
    save: overlay.querySelector(".username-save"),
    status: overlay.querySelector(".profile-status"),
  };
}

const profileDialog = createProfileDialog();

profileDialog.rankBadgeImage.addEventListener("load", () => {
  profileDialog.rankBadge.classList.add("has-image");
});
profileDialog.rankBadgeImage.addEventListener("error", () => {
  profileDialog.rankBadge.classList.remove("has-image");
});

function formatWager(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function renderRankCard(source) {
  const stats = getPlayerRankStats(source);
  const { rankDefinition, nextRank } = stats;

  profileDialog.rankBadge.classList.remove("has-image");
  profileDialog.rankBadgeImage.src = rankDefinition.badgePath;
  profileDialog.rankBadgeFallback.textContent = rankDefinition.name === "Hall of Fame"
    ? "HF"
    : rankDefinition.name.charAt(0);
  profileDialog.rankBadgeTier.textContent = rankDefinition.tier;
  profileDialog.rankName.textContent = rankDefinition.label;
  profileDialog.rankSubtitle.textContent = rankDefinition.subtitle;
  profileDialog.rankLifetimeWager.textContent = formatWager(stats.lifetimeWeightedWager);
  profileDialog.rankProgressValues.textContent = nextRank
    ? `${formatWager(stats.lifetimeWeightedWager)} / ${formatWager(nextRank.threshold)}`
    : `${formatWager(stats.lifetimeWeightedWager)} lifetime`;
  profileDialog.rankNext.textContent = nextRank ? `Next: ${nextRank.label}` : "MAX RANK";
  profileDialog.rankNext.classList.toggle("is-max", stats.isMaxRank);
  profileDialog.rankProgressFill.style.width = `${stats.percentage}%`;
  profileDialog.rankProgressTrack.setAttribute("aria-valuenow", String(Math.round(stats.percentage)));
  profileDialog.rankProgressTrack.setAttribute(
    "aria-valuetext",
    nextRank ? `${stats.percentage.toFixed(1)}% to ${nextRank.label}` : "Maximum rank reached",
  );
  profileDialog.rankTierIndicators.forEach((indicator) => {
    indicator.classList.toggle("active", indicator.dataset.rankTier === rankDefinition.tier);
  });
}

function selectProfileSection(section) {
  profileDialog.tabs.forEach((tab) => {
    const selected = tab.dataset.profileSection === section;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  profileDialog.panels.forEach((panel) => {
    panel.hidden = panel.dataset.profilePanel !== section;
  });
}

function setProfileStatus(message = "", state = "") {
  profileDialog.status.textContent = message;
  if (state) profileDialog.status.dataset.state = state;
  else delete profileDialog.status.dataset.state;
}

function refreshProfileDialog() {
  if (!currentProfile) return;
  profileDialog.input.value = currentProfile.username;
  profileDialog.currentName.textContent = currentProfile.username;
  profileDialog.email.textContent = auth.currentUser?.email || "";
  profileDialog.avatar.textContent = currentProfile.username.charAt(0).toUpperCase();
  renderRankCard(currentProfile);
  profileDialog.input.disabled = currentProfile.usernameChanged || profileBusy;
  profileDialog.save.disabled = currentProfile.usernameChanged || profileBusy;
  profileDialog.save.hidden = currentProfile.usernameChanged;
  profileDialog.help.textContent = currentProfile.usernameChanged
    ? "Your one username change has already been used."
    : "Your username can be changed once.";
}

function openProfileDialog({ welcome = false } = {}) {
  if (!auth.currentUser || !currentProfile) return;
  setProfileStatus(welcome ? "A random username was created for you. Choose carefully—you can change it once." : "");
  refreshProfileDialog();
  selectProfileSection(welcome ? "settings" : "overview");
  profileDialog.overlay.hidden = false;
  document.body.classList.add("modal-open");
  if (welcome && !currentProfile.usernameChanged) {
    profileDialog.input.focus();
    profileDialog.input.select();
  } else {
    profileDialog.close.focus();
  }
}

function closeProfileDialog() {
  profileDialog.overlay.hidden = true;
  document.body.classList.remove("modal-open");
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
      const result = await runTransaction(db, async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        const usernameSnapshot = await transaction.get(usernameRef);

        if (userSnapshot.exists()) return { profile: userSnapshot.data(), created: false };
        if (usernameSnapshot.exists()) throw Object.assign(new Error("Username collision"), { code: "gamrace/username-taken" });

        const profile = {
          username: candidate,
          usernameKey: key,
          usernameChanged: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        transaction.set(userRef, profile);
        transaction.set(usernameRef, {
          uid: user.uid,
          username: candidate,
          usernameKey: key,
          createdAt: serverTimestamp(),
        });
        return { profile: { ...profile, createdAt: null, updatedAt: null }, created: true };
      });
      return result;
    } catch (error) {
      if (error?.code !== "gamrace/username-taken") throw error;
    }
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

    const oldUsernameRef = doc(db, "usernames", profile.usernameKey);
    transaction.update(userRef, {
      username: nextUsername,
      usernameKey: nextKey,
      usernameChanged: true,
      updatedAt: serverTimestamp(),
    });
    transaction.set(nextUsernameRef, {
      uid: user.uid,
      username: nextUsername,
      usernameKey: nextKey,
      createdAt: serverTimestamp(),
    });
    transaction.delete(oldUsernameRef);
    return { ...profile, username: nextUsername, usernameKey: nextKey, usernameChanged: true };
  });

  try {
    await updateProfile(user, { displayName: nextUsername });
  } catch {
    // Firestore is the source of truth for GamRace usernames.
  }
  return updatedProfile;
}

function signedInLabel(user) {
  if (currentProfile?.username) return currentProfile.username;
  if (user?.displayName?.trim()) return user.displayName.trim().split(/\s+/)[0];
  return "Account";
}

function renderUser(user) {
  const signedIn = Boolean(user);
  document.body.dataset.authenticated = String(signedIn);
  headerSignIn.textContent = "Sign In";
  headerSignIn.setAttribute("aria-label", "Sign in");
  headerRegister.textContent = "Sign Up";
  profileButton?.setAttribute("aria-label", signedIn ? `Profile for ${signedInLabel(user)}` : "Profile");

  if (signedIn) {
    if (authModal) authModal.hidden = true;
    if (profileDialog.overlay.hidden) document.body.classList.remove("modal-open");
    setStatus();
  } else {
    currentProfile = null;
    closeProfileDialog();
  }
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
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const message = friendlyAuthError(error);
    if (message) setStatus(message, "error");
  } finally {
    setGoogleButtonsBusy(false);
  }
}

googleButtons.forEach((button) => button.addEventListener("click", continueWithGoogle));

profileButton?.addEventListener("click", () => openProfileDialog());
profileDialog.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    selectProfileSection(tab.dataset.profileSection);
    setProfileStatus();
    if (tab.dataset.profileSection === "settings" && !currentProfile?.usernameChanged) profileDialog.input.focus();
  });
});
profileDialog.close.addEventListener("click", closeProfileDialog);
profileDialog.overlay.addEventListener("click", (event) => {
  if (event.target === profileDialog.overlay) closeProfileDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileDialog.overlay.hidden) closeProfileDialog();
});

profileDialog.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth.currentUser || !currentProfile || profileBusy) return;

  const requestedUsername = profileDialog.input.value;
  const validationError = validateUsername(requestedUsername);
  if (validationError) {
    setProfileStatus(validationError, "error");
    return;
  }

  profileBusy = true;
  setProfileStatus("Checking username…");
  refreshProfileDialog();
  try {
    currentProfile = await changeUsername(auth.currentUser, requestedUsername);
    renderUser(auth.currentUser);
    setProfileStatus(`Your username is now ${currentProfile.username}.`, "success");
  } catch (error) {
    setProfileStatus(friendlyProfileError(error), "error");
  } finally {
    profileBusy = false;
    refreshProfileDialog();
  }
});

if (!authModal) {
  headerSignIn.addEventListener("click", () => {
    if (document.body.dataset.authenticated !== "true") window.location.href = "index.html?auth=login";
  });
  headerRegister.addEventListener("click", () => {
    if (document.body.dataset.authenticated === "true") {
      window.dispatchEvent(new CustomEvent("gamrace-auth-signout"));
      return;
    }
    window.location.href = "index.html?auth=register";
  });
}

window.addEventListener("gamrace-auth-signout", async () => {
  try {
    await signOut(auth);
  } catch {
    setStatus("Sign out could not be completed. Please try again.", "error");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderUser(null);
    return;
  }

  renderUser(user);
  try {
    const result = await ensureUserProfile(user);
    if (auth.currentUser?.uid !== user.uid) return;
    currentProfile = result.profile;
    renderUser(user);
    refreshProfileDialog();
    if (result.created) {
      try {
        await updateProfile(user, { displayName: currentProfile.username });
      } catch {
        // Firestore is the source of truth for GamRace usernames.
      }
      openProfileDialog({ welcome: true });
    }
  } catch (error) {
    console.error("GamRace profile setup failed", error);
    setStatus("Your account signed in, but its username could not be loaded. Please refresh and try again.", "error");
  }
});
