const search = document.querySelector("#game-search");
const sections = [...document.querySelectorAll(".game-section")];
const categories = [...document.querySelectorAll(".category")];
const heroModes = [...document.querySelectorAll("[data-mode]")];
const modeLabel = document.querySelector("#lobby-mode-label");
const emptyState = document.querySelector("#empty-state");
let currentFilter = "all";
let currentMode = "house";

function modeAllowsSection(sectionName) {
  if (currentMode === "browse") return true;
  if (sectionName === "original") return true;
  return currentMode === "house" ? sectionName === "slot" : sectionName === "live";
}

function applyFilters() {
  const query = search.value.trim().toLowerCase();
  let totalVisible = 0;

  sections.forEach((section) => {
    let visibleInSection = 0;
    const modeAllows = modeAllowsSection(section.dataset.section);
    section.querySelectorAll(".game-card").forEach((card) => {
      const matchesCategory = currentFilter === "all" || card.classList.contains(currentFilter);
      const matchesQuery = !query || card.dataset.name.includes(query) || card.textContent.toLowerCase().includes(query);
      card.hidden = !(modeAllows && matchesCategory && matchesQuery);
      if (!card.hidden) visibleInSection += 1;
    });
    section.hidden = !modeAllows || visibleInSection === 0;
    totalVisible += visibleInSection;
  });

  emptyState.hidden = totalVisible !== 0;
}

function setHeroMode(mode) {
  currentMode = mode;
  currentFilter = "all";

  heroModes.forEach((banner) => {
    const selected = banner.dataset.mode === mode;
    banner.classList.toggle("active", selected);
    banner.setAttribute("aria-pressed", String(selected));
  });

  categories.forEach((category) => {
    const selected = category.dataset.filter === "all";
    category.classList.toggle("active", selected);
    category.setAttribute("aria-pressed", String(selected));
  });

  modeLabel.textContent = mode === "house" ? "Play the House" : "Play the Player";
  applyFilters();
  document.querySelector("#game-sections").scrollIntoView({ behavior: "smooth", block: "start" });
}

heroModes.forEach((banner) => {
  banner.addEventListener("click", () => setHeroMode(banner.dataset.mode));
});

categories.forEach((button) => {
  button.addEventListener("click", () => {
    currentMode = "browse";
    currentFilter = button.dataset.filter;
    categories.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    heroModes.forEach((banner) => {
      banner.classList.remove("active");
      banner.setAttribute("aria-pressed", "false");
    });
    modeLabel.textContent = currentFilter === "original" ? "GamRace Originals" : "Browse Games";
    applyFilters();
    document.querySelector("#game-sections").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelectorAll("[data-filter]:not(.category)").forEach((button) => {
  button.addEventListener("click", () => {
    const matchingCategory = categories.find((item) => item.dataset.filter === button.dataset.filter);
    matchingCategory?.click();
  });
});

search.addEventListener("input", applyFilters);

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

const authModal = document.querySelector("#auth-modal");
const authClose = authModal.querySelector(".auth-close");
const authTabs = [...authModal.querySelectorAll(".auth-tab")];
const authPanels = [...authModal.querySelectorAll("[data-auth-panel]")];

function selectAuthMode(mode) {
  authTabs.forEach((tab) => {
    const selected = tab.dataset.authSwitch === mode;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  authPanels.forEach((panel) => {
    panel.hidden = panel.dataset.authPanel !== mode;
  });
}

function openAuth(mode) {
  selectAuthMode(mode);
  authModal.hidden = false;
  document.body.classList.add("modal-open");
  authClose.focus();
}

function closeAuth() {
  authModal.hidden = true;
  document.body.classList.remove("modal-open");
}

document.querySelector(".auth.login").addEventListener("click", () => openAuth("login"));
document.querySelector(".auth.register").addEventListener("click", () => openAuth("register"));

authModal.querySelectorAll("[data-auth-switch]").forEach((button) => {
  button.addEventListener("click", () => selectAuthMode(button.dataset.authSwitch));
});

authClose.addEventListener("click", closeAuth);
authModal.addEventListener("click", (event) => {
  if (event.target === authModal) closeAuth();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !authModal.hidden) closeAuth();
});

authModal.querySelectorAll(".password-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  });
});

authModal.querySelectorAll("form").forEach((form) => {
  form.addEventListener("submit", (event) => event.preventDefault());
});

const newPassword = authModal.querySelector('input[name="new-password"]');
const confirmPassword = authModal.querySelector('input[name="confirm-password"]');
function validatePasswordMatch() {
  const mismatch = confirmPassword.value && confirmPassword.value !== newPassword.value;
  confirmPassword.setCustomValidity(mismatch ? "Passwords do not match." : "");
}
newPassword.addEventListener("input", validatePasswordMatch);
confirmPassword.addEventListener("input", validatePasswordMatch);

applyFilters();
