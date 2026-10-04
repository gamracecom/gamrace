(() => {
  "use strict";

  const actions = [...document.querySelectorAll(".mobile-tab-action")];
  const menuButton = actions.find((button) => button.dataset.mobileAction === "menu");
  const searchInput = document.querySelector("#game-search");

  function setActive(action) {
    actions.forEach((button) => {
      const selected = button.dataset.mobileAction === action;
      button.classList.toggle("active", selected);
      if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(selected));
    });
  }

  function closeMenu() {
    document.body.classList.remove("mobile-menu-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }

  function openLobbyMode(mode) {
    const modeButton = document.querySelector(`[data-mode="${mode}"]`);
    if (modeButton) {
      modeButton.click();
      setActive(mode);
      closeMenu();
      return;
    }
    window.location.href = `index.html?mode=${encodeURIComponent(mode)}`;
  }

  actions.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.mobileAction;

      if (action === "menu") {
        const open = !document.body.classList.contains("mobile-menu-open");
        document.body.classList.toggle("mobile-menu-open", open);
        button.setAttribute("aria-expanded", String(open));
        return;
      }

      if (action === "house" || action === "player") {
        openLobbyMode(action);
        return;
      }

      closeMenu();
      setActive(action);

      if (action === "search") {
        if (!searchInput) {
          window.location.href = "index.html?focus=search";
          return;
        }
        searchInput.focus({ preventScroll: true });
      }
    });
  });

  document.querySelectorAll(".sidebar .nav-link").forEach((link) => link.addEventListener("click", closeMenu));

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("mobile-menu-open")) return;
    if (event.target.closest(".sidebar, [data-mobile-action=\"menu\"]")) return;
    closeMenu();
  });

  const params = new URL(window.location.href).searchParams;
  const requestedMode = params.get("mode");
  if (requestedMode === "house" || requestedMode === "player") openLobbyMode(requestedMode);
  if (params.get("focus") === "search" && searchInput) {
    setActive("search");
    searchInput.focus({ preventScroll: true });
  }

  if (requestedMode || params.has("focus")) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("mode");
    cleanUrl.searchParams.delete("focus");
    history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
})();
