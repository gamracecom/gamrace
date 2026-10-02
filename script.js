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

applyFilters();
