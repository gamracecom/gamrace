(() => {
  "use strict";

  const actions = [...document.querySelectorAll(".mobile-tab-action")];
  const menuButton = actions.find((button) => button.dataset.mobileAction === "menu");
  const menuCloseButton = document.querySelector(".mobile-menu-close");
  const searchInput = document.querySelector("#game-search");
  const lobbyRail = document.querySelector(".lobby-rail");
  const destination = document.querySelector("#mobile-destination");
  const isLobby = Boolean(lobbyRail);

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

  function setRouteInAddress(action, replace = false) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tab", action);
    nextUrl.searchParams.delete("mode");
    nextUrl.searchParams.delete("focus");
    nextUrl.hash = "";
    history[replace ? "replaceState" : "pushState"]({ mobileTab: action }, "", `${nextUrl.pathname}${nextUrl.search}`);
  }

  function showLobby() {
    document.body.classList.remove("mobile-empty-page", "mobile-search-page");
    if (destination) destination.hidden = true;
  }

  function openLobbyMode(mode) {
    showLobby();
    const modeButton = document.querySelector(`[data-mode="${mode}"]`);
    if (modeButton) {
      modeButton.click();
      setActive(mode);
      closeMenu();
    }
  }

  function renderRoute(action, { focusSearch = true } = {}) {
    closeMenu();

    if (action === "house" || action === "player") {
      openLobbyMode(action);
      return;
    }

    if (action === "search") {
      showLobby();
      document.body.classList.add("mobile-search-page");
      setActive(action);
      if (focusSearch) searchInput?.focus({ preventScroll: true });
      return;
    }

    if (action === "rewards" || action === "chat") {
      document.body.classList.remove("mobile-search-page");
      document.body.classList.add("mobile-empty-page");
      if (destination) {
        destination.hidden = false;
        destination.setAttribute("aria-label", action === "rewards" ? "Rewards" : "Chat");
      }
      setActive(action);
    }
  }

  function navigate(action) {
    if (!isLobby) {
      window.location.href = `index.html?tab=${encodeURIComponent(action)}`;
      return;
    }
    const currentTab = new URL(window.location.href).searchParams.get("tab") || "house";
    if (currentTab !== action) setRouteInAddress(action);
    renderRoute(action);
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
        navigate(action);
        return;
      }

      navigate(action);
    });
  });

  menuCloseButton?.addEventListener("click", closeMenu);

  document.querySelector(".utility.rewards")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 560px)").matches) navigate("rewards");
  });

  document.querySelectorAll(".sidebar .nav-link").forEach((link) => link.addEventListener("click", (event) => {
    const mobileAction = link.dataset.mobileMenuAction;
    if (mobileAction && window.matchMedia("(max-width: 560px)").matches) {
      event.preventDefault();
      navigate(mobileAction);
      return;
    }
    closeMenu();
  }));

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("mobile-menu-open")) return;
    if (event.target.closest(".sidebar, [data-mobile-action=\"menu\"]")) return;
    closeMenu();
  });

  document.querySelectorAll("[data-mode]").forEach((modeButton) => modeButton.addEventListener("click", () => {
    if (!window.matchMedia("(max-width: 560px)").matches) return;
    setActive(modeButton.dataset.mode);
  }));

  function routeFromAddress({ focusSearch = true } = {}) {
    const url = new URL(window.location.href);
    if (url.searchParams.has("filter") && isLobby) {
      showLobby();
      setActive("");
      return;
    }
    const legacyMode = url.searchParams.get("mode");
    const requested = url.searchParams.get("tab") || (legacyMode === "player" ? "player" : legacyMode === "house" ? "house" : url.searchParams.has("focus") ? "search" : "house");
    if (["house", "player", "search", "rewards", "chat"].includes(requested) && isLobby) renderRoute(requested, { focusSearch });
  }

  window.addEventListener("popstate", () => routeFromAddress({ focusSearch: false }));
  routeFromAddress();
})();
