(() => {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  let open = false;
  let pollingTimer = 0;
  let access = null;

  const launcher = document.createElement("button");
  launcher.className = "chat-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open live chat");
  launcher.innerHTML = '<img src="assets/icons/navigation/chat.png" alt="" aria-hidden="true"><span>Chat</span>';

  const panel = document.createElement("aside");
  panel.className = "live-chat-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "GamRace live chat");
  panel.innerHTML = `
    <header><div><i aria-hidden="true"></i><span><strong>Live chat</strong><small>GamRace community</small></span></div><button type="button" data-chat-close aria-label="Close chat">×</button></header>
    <div class="live-chat-messages" data-chat-messages role="log" aria-live="polite"></div>
    <div class="live-chat-gate" data-chat-gate role="status"></div>
    <form class="live-chat-form" data-chat-form>
      <input type="text" maxlength="240" autocomplete="off" placeholder="Write a message…" aria-label="Chat message" />
      <button type="submit" aria-label="Send message">Send</button>
    </form>`;
  document.body.append(launcher, panel);

  const messagesRoot = panel.querySelector("[data-chat-messages]");
  const gate = panel.querySelector("[data-chat-gate]");
  const form = panel.querySelector("[data-chat-form]");
  const input = form.querySelector("input");
  const send = form.querySelector("button");

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Math.max(0, Number(cents || 0)) / 100);
  }

  function timeLabel(value) {
    const date = new Date(Number(value || 0));
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function messageNode(message) {
    const article = document.createElement("article");
    article.className = "live-chat-message";
    const badge = document.createElement("span");
    badge.className = "live-chat-badge";
    const image = document.createElement("img");
    image.alt = "";
    image.src = message.badgePath || "assets/brand/gamrace-icon.png";
    image.addEventListener("error", () => { image.src = "assets/brand/gamrace-icon.png"; }, { once: true });
    badge.append(image);
    const copy = document.createElement("span");
    const meta = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = message.username || "Racer";
    name.title = message.rankLabel || "Racer";
    const time = document.createElement("time");
    time.textContent = timeLabel(message.createdAt);
    meta.append(name, time);
    const text = document.createElement("p");
    text.textContent = message.message || "";
    copy.append(meta, text);
    article.append(badge, copy);
    return article;
  }

  async function loadMessages() {
    const response = await fetch(`${API_BASE}/chat/messages`, { cache: "no-store" });
    if (!response.ok) throw new Error("Chat is temporarily unavailable");
    const body = await response.json();
    const nearBottom = messagesRoot.scrollHeight - messagesRoot.scrollTop - messagesRoot.clientHeight < 80;
    const nodes = (body.messages || []).map(messageNode);
    if (nodes.length) messagesRoot.replaceChildren(...nodes);
    else messagesRoot.innerHTML = '<div class="live-chat-empty"><img src="assets/brand/gamrace-icon.png" alt=""><strong>Start the conversation</strong><span>Messages from every active racer appear here.</span></div>';
    if (nearBottom || messagesRoot.dataset.initialized !== "true") messagesRoot.scrollTop = messagesRoot.scrollHeight;
    messagesRoot.dataset.initialized = "true";
  }

  function renderAccess() {
    const signedIn = Boolean(window.GamRaceAuth?.getUser?.());
    if (!signedIn) {
      gate.textContent = "Sign in to send messages. Everyone can still read chat.";
      form.hidden = true;
      return;
    }
    if (!access) {
      gate.textContent = "Checking chat access…";
      form.hidden = true;
      return;
    }
    if (!access.canSend) {
      gate.textContent = `Wager ${money(access.remainingUsdCents)} more to unlock chat. You can still read every message.`;
      form.hidden = true;
      return;
    }
    gate.textContent = `Chat unlocked · ${money(access.wagerUsdCents)} wagered`;
    form.hidden = false;
  }

  async function loadAccess() {
    const token = await window.GamRaceAuth?.getToken?.();
    if (!token) { access = null; renderAccess(); return; }
    const response = await fetch(`${API_BASE}/chat/status`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Chat access could not be checked");
    access = body.access;
    renderAccess();
  }

  async function refresh() {
    try {
      await loadMessages();
      delete gate.dataset.state;
    } catch (error) {
      gate.textContent = error.message;
      gate.dataset.state = "error";
    }
  }

  function emitState() {
    window.dispatchEvent(new CustomEvent("gamrace:chat-state", { detail: { open } }));
  }

  async function setOpen(next) {
    open = Boolean(next);
    panel.hidden = !open;
    document.body.classList.toggle("live-chat-open", open);
    launcher.setAttribute("aria-label", open ? "Close live chat" : "Open live chat");
    window.clearInterval(pollingTimer);
    if (open) {
      renderAccess();
      await Promise.allSettled([refresh(), loadAccess()]);
      pollingTimer = window.setInterval(refresh, 2_500);
      if (!form.hidden) input.focus({ preventScroll: true });
    }
    emitState();
  }

  launcher.addEventListener("click", () => setOpen(!open));
  panel.querySelector("[data-chat-close]").addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    send.disabled = true;
    try {
      const token = await window.GamRaceAuth?.getToken?.();
      if (!token) throw new Error("Sign in to send a message");
      const response = await fetch(`${API_BASE}/chat/messages`, {
        method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "That message could not be sent");
      input.value = "";
      await refresh();
      input.focus({ preventScroll: true });
    } catch (error) {
      gate.textContent = error.message;
      gate.dataset.state = "error";
    } finally {
      send.disabled = false;
    }
  });

  window.addEventListener("gamrace:auth-state", () => { access = null; if (open) loadAccess().catch(() => renderAccess()); });
  window.addEventListener("gamrace:wallet-balance-changed", () => { if (open) loadAccess().catch(() => {}); });
  window.GamRaceChat = { toggle: () => setOpen(!open), open: () => setOpen(true), close: () => setOpen(false), isOpen: () => open };
})();
