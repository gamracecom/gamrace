const search = document.querySelector("#game-search");
const sections = [...document.querySelectorAll(".game-section")];
const cards = [...document.querySelectorAll(".game-card")];
const categories = [...document.querySelectorAll(".category")];
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
let currentFilter = "all";
let toastTimer;

function applyFilters() {
  const query = search.value.trim().toLowerCase();
  let totalVisible = 0;

  sections.forEach((section) => {
    let visibleInSection = 0;
    section.querySelectorAll(".game-card").forEach((card) => {
      const matchesCategory = currentFilter === "all" || card.classList.contains(currentFilter);
      const matchesQuery = !query || card.dataset.name.includes(query) || card.textContent.toLowerCase().includes(query);
      card.hidden = !(matchesCategory && matchesQuery);
      if (!card.hidden) visibleInSection += 1;
    });
    section.hidden = visibleInSection === 0;
    totalVisible += visibleInSection;
  });

  emptyState.hidden = totalVisible !== 0;
}

categories.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    categories.forEach((item) => item.classList.toggle("active", item === button));
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

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth" }));
});

search.addEventListener("input", applyFilters);

document.querySelectorAll("[data-toast]").forEach((button) => {
  button.addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.textContent = button.dataset.toast;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  });
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
