import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

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
const provider = new GoogleAuthProvider();
const googleButtons = [...document.querySelectorAll(".google-auth")];
const authStatus = document.querySelector("#auth-status");
const authModal = document.querySelector("#auth-modal");
const headerSignIn = document.querySelector(".auth.login");
const headerRegister = document.querySelector(".auth.register");

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

function signedInLabel(user) {
  if (user.displayName?.trim()) return user.displayName.trim().split(/\s+/)[0];
  if (user.email) return user.email.split("@")[0];
  return "Account";
}

function renderUser(user) {
  const signedIn = Boolean(user);
  document.body.dataset.authenticated = String(signedIn);
  headerSignIn.textContent = signedIn ? signedInLabel(user) : "Sign In";
  headerSignIn.setAttribute("aria-label", signedIn ? "Signed in account" : "Sign in");
  headerRegister.textContent = signedIn ? "Sign Out" : "Register";

  if (signedIn) {
    if (authModal) authModal.hidden = true;
    document.body.classList.remove("modal-open");
    setStatus();
  }
}

function friendlyAuthError(error) {
  if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") return "";
  if (error?.code === "auth/network-request-failed") return "Couldn’t connect to Google. Please try again.";
  if (error?.code === "auth/unauthorized-domain") return "Google sign-in isn’t available on this domain yet.";
  return "Google sign-in could not be completed. Please try again.";
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

onAuthStateChanged(auth, renderUser);
