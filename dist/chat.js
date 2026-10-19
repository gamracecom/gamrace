(() => {
  "use strict";

  const API_BASE = "https://gamrace-wallet-api.gamracecom.workers.dev";
  const FLAG_ICON = "assets/brand/gamrace-icon.png";
  let open = false;
  let pollingTimer = 0;
  let access = null;

  const sendIcon = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 6.5 27 16 5 25.5l2.2-7.2L18 16 7.2 13.7 5 6.5Z" fill="currentColor"/><path d="m18 16-10.8 2.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const mentionIcon = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M19.8 20.8A9 9 0 1 1 22.7 14v2.1c0 2.3-3.5 2.5-3.8.2V9.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="14" cy="14" r="4.5" fill="none" stroke="currentColor" stroke-width="2.1"/></svg>`;

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
    <header>
      <div class="live-chat-channel"><span class="live-chat-flag"><img src="${FLAG_ICON}" alt=""></span><span><strong>Global Chat</strong><small>GamRace community</small></span></div>
      <button type="button" data-chat-close aria-label="Close chat">×</button>
    </header>
    <div class="live-chat-messages" data-chat-messages role="log" aria-live="polite"></div>
    <div class="live-chat-gate" data-chat-gate role="status"></div>
    <form class="live-chat-form" data-chat-form>
      <input type="text" maxlength="240" autocomplete="off" placeholder="Start typing…" aria-label="Chat message" />
      <button type="submit" class="live-chat-send" aria-label="Send message">${sendIcon}</button>
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

  function avatarNode(message) {
    const avatar = document.createElement("span");
    avatar.className = "live-chat-avatar";
    avatar.style.setProperty("--avatar-color", message.avatarColor || "#168bff");
    const image = document.createElement("img");
    image.alt = "";
    image.src = message.avatarUrl || FLAG_ICON;
    image.className = message.avatarUrl ? "custom" : "fallback";
    image.addEventListener("error", () => { image.src = FLAG_ICON; image.className = "fallback"; }, { once: true });
    avatar.append(image);
    return avatar;
  }

  function messageTextNode(message) {
    const text = document.createElement("p");
    const value = String(message.message || "");
    const mention = message.mentionedUsername ? `@${message.mentionedUsername}` : "";
    const mentionIndex = mention ? value.toLowerCase().indexOf(mention.toLowerCase()) : -1;
    if (message.mentionedMe && mentionIndex >= 0) {
      const mark = document.createElement("mark");
      mark.className = "live-chat-mention-highlight";
      mark.textContent = value.slice(mentionIndex, mentionIndex + mention.length);
      text.append(document.createTextNode(value.slice(0, mentionIndex)), mark, document.createTextNode(value.slice(mentionIndex + mention.length)));
    } else text.textContent = value;
    return text;
  }

  function insertMention(username) {
    const mention = `@${username}`;
    const current = input.value.trim();
    input.value = current ? `${current} ${mention} ` : `${mention} `;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function messageNode(message) {
    const article = document.createElement("article");
    article.className = `live-chat-message${message.mentionedMe ? " mentioned-me" : ""}`;
    const side = document.createElement("span");
    side.className = "live-chat-message-side";
    side.append(avatarNode(message));
    const time = document.createElement("time");
    time.textContent = timeLabel(message.createdAt);
    side.append(time);

    const content = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "live-chat-message-meta";
    const identity = document.createElement("span");
    identity.className = "live-chat-identity";
    const rank = document.createElement("img");
    rank.alt = message.rankLabel || "Player rank";
    rank.title = message.rankLabel || "Player rank";
    rank.src = message.badgePath || "ranks/rookie-i.webp";
    rank.addEventListener("error", () => { rank.src = "ranks/rookie-i.webp"; }, { once: true });
    const name = document.createElement("strong");
    name.textContent = message.username || "Racer";
    identity.append(rank, name);
    meta.append(identity);
    if (message.mentionable !== false) {
      const mention = document.createElement("button");
      mention.type = "button";
      mention.className = "live-chat-mention";
      mention.setAttribute("aria-label", `Mention ${message.username}`);
      mention.title = `Mention ${message.username}`;
      mention.innerHTML = mentionIcon;
      mention.addEventListener("click", () => insertMention(message.username));
      meta.append(mention);
    }
    content.append(meta, messageTextNode(message));
    article.append(side, content);
    return article;
  }

  async function loadMessages() {
    let token = null;
    try { token = await window.GamRaceAuth?.getToken?.(); } catch { token = null; }
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${API_BASE}/chat/messages`, { cache: "no-store", headers });
    if (!response.ok) throw new Error("Chat is temporarily unavailable");
    const body = await response.json();
    const nearBottom = messagesRoot.scrollHeight - messagesRoot.scrollTop - messagesRoot.clientHeight < 80;
    const nodes = (body.messages || []).map(messageNode);
    if (nodes.length) messagesRoot.replaceChildren(...nodes);
    else messagesRoot.innerHTML = `<div class="live-chat-empty"><span style="--avatar-color:#168bff"><img src="${FLAG_ICON}" alt=""></span><strong>Start the conversation</strong><small>Messages from every active racer appear here.</small></div>`;
    if (nearBottom || messagesRoot.dataset.initialized !== "true") messagesRoot.scrollTop = messagesRoot.scrollHeight;
    messagesRoot.dataset.initialized = "true";
  }

  function renderAccess() {
    const signedIn = Boolean(window.GamRaceAuth?.getUser?.());
    if (!signedIn) { gate.textContent = "Sign in to join the conversation. Everyone can still read chat."; form.hidden = true; return; }
    if (!access) { gate.textContent = "Checking chat access…"; form.hidden = true; return; }
    if (!access.canSend) { gate.textContent = `Wager ${money(access.remainingUsdCents)} more to unlock chat.`; form.hidden = true; return; }
    gate.textContent = "";
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
    try { await loadMessages(); delete gate.dataset.state; }
    catch (error) { gate.textContent = error.message; gate.dataset.state = "error"; }
  }

  function emitState() { window.dispatchEvent(new CustomEvent("gamrace:chat-state", { detail: { open } })); }

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
    } catch (error) { gate.textContent = error.message; gate.dataset.state = "error"; }
    finally { send.disabled = false; }
  });

  window.addEventListener("gamrace:auth-state", () => { access = null; if (open) Promise.allSettled([loadAccess(), refresh()]); });
  window.addEventListener("gamrace:wallet-balance-changed", () => { if (open) loadAccess().catch(() => {}); });
  window.GamRaceChat = { toggle: () => setOpen(!open), open: () => setOpen(true), close: () => setOpen(false), isOpen: () => open };
})();
