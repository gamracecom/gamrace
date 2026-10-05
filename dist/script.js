// Remove the retired prototype balance so returning browsers never retain local funds.
localStorage.removeItem("gamrace-balance-v1");

const search = document.querySelector("#game-search");
const sections = [...document.querySelectorAll(".game-section")];
const categories = [...document.querySelectorAll(".category")];
const heroModes = [...document.querySelectorAll("[data-mode]")];
const modeLabel = document.querySelector("#lobby-mode-label");
const modeIcon = document.querySelector("#lobby-mode-icon");
const emptyState = document.querySelector("#empty-state");
const carouselControls = [...document.querySelectorAll("[data-carousel-controls]")];
let currentFilter = "all";
let currentMode = "house";

function captureViewport() {
  return { left: window.scrollX, top: window.scrollY };
}

function restoreViewport(position) {
  window.scrollTo({ ...position, behavior: "instant" });
  requestAnimationFrame(() => window.scrollTo({ ...position, behavior: "instant" }));
}

function updateCarouselState(controls) {
  const row = document.querySelector(`#${controls.dataset.carouselControls}`);
  if (!row) return;
  const previous = controls.querySelector(".carousel-prev");
  const next = controls.querySelector(".carousel-next");
  const maxScroll = Math.max(0, row.scrollWidth - row.clientWidth);
  previous.disabled = row.scrollLeft <= 2;
  next.disabled = row.scrollLeft >= maxScroll - 2;
}

function updateAllCarouselStates() {
  carouselControls.forEach(updateCarouselState);
}

carouselControls.forEach((controls) => {
  const row = document.querySelector(`#${controls.dataset.carouselControls}`);
  if (!row) return;
  controls.querySelector(".carousel-prev").addEventListener("click", () => {
    row.scrollBy({ left: -Math.max(180, row.clientWidth * .82), behavior: "smooth" });
  });
  controls.querySelector(".carousel-next").addEventListener("click", () => {
    row.scrollBy({ left: Math.max(180, row.clientWidth * .82), behavior: "smooth" });
  });
  row.addEventListener("scroll", () => updateCarouselState(controls), { passive: true });
});

window.addEventListener("resize", updateAllCarouselStates);

function modeAllowsSection(sectionName) {
  if (currentMode === "browse") return true;
  return ["original", "slot", "live", "provider"].includes(sectionName);
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
  requestAnimationFrame(updateAllCarouselStates);
}

function setHeroMode(mode) {
  const viewport = captureViewport();
  currentMode = mode;
  currentFilter = "all";
  sections.forEach((section) => section.classList.remove("expanded"));
  document.querySelectorAll(".view-all-button").forEach((button) => button.setAttribute("aria-pressed", "false"));

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
  modeIcon.src = mode === "house" ? "assets/icons/navigation/house.png" : "assets/icons/navigation/player.png";
  applyFilters();
  restoreViewport(viewport);
}

function setBrowseFilter(filter) {
  const viewport = captureViewport();
  currentMode = "browse";
  currentFilter = filter;
  sections.forEach((section) => section.classList.remove("expanded"));
  document.querySelectorAll(".view-all-button").forEach((item) => item.setAttribute("aria-pressed", "false"));
  categories.forEach((item) => {
    const selected = item.dataset.filter === filter;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
  heroModes.forEach((banner) => {
    banner.classList.remove("active");
    banner.setAttribute("aria-pressed", "false");
  });
  modeLabel.textContent = filter === "original" ? "GamRace Originals" : "Browse Games";
  applyFilters();
  restoreViewport(viewport);
}

heroModes.forEach((banner) => {
  banner.addEventListener("click", () => setHeroMode(banner.dataset.mode));
});

categories.forEach((button) => {
  button.addEventListener("click", () => setBrowseFilter(button.dataset.filter));
});

document.querySelectorAll(".view-all-button").forEach((button) => {
  button.addEventListener("click", () => {
    const viewport = captureViewport();
    setBrowseFilter(button.dataset.filter);
    const matchingSection = button.closest(".game-section");
    if (matchingSection) {
      matchingSection.classList.add("expanded");
      button.setAttribute("aria-pressed", "true");
    }
    restoreViewport(viewport);
  });
});

search.addEventListener("input", applyFilters);

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const viewport = captureViewport();
    const destination = link.getAttribute("href");
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
    if (destination === "#top" || destination === "#house") setHeroMode("house");
    if (destination === "#player") setHeroMode("player");
    if (destination === "#slots") setBrowseFilter("slot");
    if (destination === "#live-games") setBrowseFilter("live");
    if (destination === "#providers") setBrowseFilter("provider");
    restoreViewport(viewport);
  });
});

document.querySelector(".topbar-brand").addEventListener("click", (event) => {
  event.preventDefault();
  setHeroMode("house");
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

const headerSignIn = document.querySelector(".auth.login");
const headerRegister = document.querySelector(".auth.register");

headerSignIn.addEventListener("click", () => {
  if (document.body.dataset.authenticated !== "true") openAuth("login");
});
headerRegister.addEventListener("click", () => {
  if (document.body.dataset.authenticated === "true") {
    window.dispatchEvent(new CustomEvent("gamrace-auth-signout"));
    return;
  }
  openAuth("register");
});

const requestedAuthMode = new URL(window.location.href).searchParams.get("auth");
if (requestedAuthMode === "login" || requestedAuthMode === "register") {
  openAuth(requestedAuthMode);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("auth");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

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

const requestedFilter = new URL(window.location.href).searchParams.get("filter");
if (["slot", "live", "provider"].includes(requestedFilter)) setBrowseFilter(requestedFilter);
else applyFilters();
requestAnimationFrame(updateAllCarouselStates);
