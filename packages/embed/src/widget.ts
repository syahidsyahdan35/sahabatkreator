/**
 * Widget webchat Sahabat Kreator (Fase 1F) — SATU file JS mandiri.
 *
 * Cara pasang di situs tenant:
 *   <script src="https://botara.my.id/widget.js" data-site-key="wc_..."></script>
 * Opsi: data-lang="id" (default "en"), data-title="Chat dengan kami",
 * data-api-base="https://botara.my.id" (default: origin file widget ini).
 *
 * Perilaku:
 * - Tombol chat melayang + panel percakapan, tema mengikuti sistem
 *   pengunjung (prefers-color-scheme terang/gelap).
 * - Sesi dibuka lewat POST /api/webchat/:siteKey/session; token pengunjung
 *   + visitorId persisten disimpan di localStorage SITUS ASAL.
 * - Pesan keluar masuk lewat REST; balasan masuk secara realtime lewat
 *   WebSocket, dengan polling cadangan bila WS gagal.
 * - Semua teks pesan dirender dengan textContent (tidak ada innerHTML dari
 *   data pengguna) — aman dari injeksi HTML.
 */

interface WidgetStrings {
  openLabel: string;
  defaultTitle: string;
  placeholder: string;
  send: string;
  connecting: string;
  emptyState: string;
}

const STRINGS: Record<"en" | "id", WidgetStrings> = {
  en: {
    openLabel: "Chat with us",
    defaultTitle: "Chat with us",
    placeholder: "Type a message…",
    send: "Send",
    connecting: "Connecting…",
    emptyState: "Say hello — we usually reply in a moment.",
  },
  id: {
    openLabel: "Chat dengan kami",
    defaultTitle: "Chat dengan kami",
    placeholder: "Tulis pesan…",
    send: "Kirim",
    connecting: "Menghubungkan…",
    emptyState: "Sapa kami — biasanya dibalas sebentar lagi.",
  },
};

interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  contentText: string | null;
  status: string;
  createdAt: string;
}

interface SessionResponse {
  token: string;
  conversationId: string;
  messages: ChatMessage[];
}

(function initWebchatWidget() {
  const script = document.currentScript as HTMLScriptElement | null;
  const siteKey = script?.dataset.siteKey?.trim();
  if (!script || !siteKey) {
    console.warn("[sahabat-kreator] widget: atribut data-site-key wajib diisi");
    return;
  }
  const lang = script.dataset.lang === "id" ? "id" : "en";
  const t = STRINGS[lang as "en" | "id"];
  const apiBase = (
    script.dataset.apiBase || new URL(script.src).origin
  ).replace(/\/$/, "");
  const title = script.dataset.title || t.defaultTitle;

  const storeKey = `sk_webchat_${siteKey}`;
  interface Stored {
    token?: string;
    visitorId?: string;
  }
  function loadStore(): Stored {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? "{}") as Stored;
    } catch {
      return {};
    }
  }
  function saveStore(next: Stored): void {
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* localStorage tidak tersedia — sesi tetap jalan di memori */
    }
  }
  function randomId(prefix: string): string {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return prefix + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const stored = loadStore();
  const visitorId = stored.visitorId ?? randomId("vis_");
  if (!stored.visitorId) saveStore({ ...stored, visitorId });
  let token: string | null = stored.token ?? null;

  // ---------- Tema mengikuti sistem pengunjung ----------
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function palette() {
    return darkQuery.matches
      ? {
          panel: "#171a21",
          header: "#1f6feb",
          text: "#e8eaed",
          muted: "#9aa3af",
          mine: "#1f6feb",
          mineText: "#ffffff",
          theirs: "#262b36",
          theirsText: "#e8eaed",
          inputBg: "#10131a",
          border: "#2b303c",
        }
      : {
          panel: "#ffffff",
          header: "#2563eb",
          text: "#111827",
          muted: "#6b7280",
          mine: "#2563eb",
          mineText: "#ffffff",
          theirs: "#f3f4f6",
          theirsText: "#111827",
          inputBg: "#ffffff",
          border: "#e5e7eb",
        };
  }

  // ---------- DOM ----------
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;";

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", t.openLabel);
  button.textContent = "💬";
  button.style.cssText =
    "width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;font-size:24px;color:#fff;background:#2563eb;box-shadow:0 8px 24px rgba(0,0,0,.25);";

  const panel = document.createElement("div");
  panel.style.cssText =
    "display:none;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100vh - 120px));border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.3);flex-direction:column;margin-bottom:12px;";

  const header = document.createElement("div");
  header.style.cssText =
    "padding:14px 16px;color:#fff;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center;";
  const headerTitle = document.createElement("span");
  headerTitle.textContent = title;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText =
    "background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;";
  header.append(headerTitle, closeBtn);

  const messagesEl = document.createElement("div");
  messagesEl.style.cssText =
    "flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;";

  const form = document.createElement("form");
  form.style.cssText = "display:flex;gap:8px;padding:10px;border-top:1px solid;";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t.placeholder;
  input.maxLength = 4096;
  input.style.cssText =
    "flex:1;border-radius:9999px;padding:10px 14px;font-size:14px;outline:none;border:1px solid;";
  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.textContent = t.send;
  sendBtn.style.cssText =
    "border:none;border-radius:9999px;padding:10px 16px;font-size:14px;font-weight:600;color:#fff;background:#2563eb;cursor:pointer;";
  form.append(input, sendBtn);

  panel.append(header, messagesEl, form);
  root.append(panel, button);
  document.body.appendChild(root);

  function applyTheme(): void {
    const p = palette();
    panel.style.background = p.panel;
    panel.style.color = p.text;
    header.style.background = p.header;
    form.style.borderTopColor = p.border;
    input.style.background = p.inputBg;
    input.style.color = p.text;
    input.style.borderColor = p.border;
    for (const el of Array.from(messagesEl.children) as HTMLElement[]) {
      const mine = el.dataset.mine === "1";
      el.style.background = mine ? p.mine : p.theirs;
      el.style.color = mine ? p.mineText : p.theirsText;
    }
  }
  darkQuery.addEventListener?.("change", applyTheme);

  // ---------- Rendering pesan ----------
  const seen = new Set<string>();
  function appendMessage(msg: ChatMessage): void {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
    if (messagesEl.dataset.empty === "1") {
      messagesEl.textContent = "";
      delete messagesEl.dataset.empty;
    }
    // Model data Sahabat Kreator: direction "inbound" = dari kontak
    // (pengunjung) menuju tenant → tampil sebagai pesan "saya" (kanan);
    // "outbound" = dari tenant menuju pengunjung → kiri.
    const mine = msg.direction === "inbound";
    const bubble = document.createElement("div");
    bubble.dataset.mine = mine ? "1" : "0";
    bubble.style.cssText = `max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word;align-self:${mine ? "flex-end" : "flex-start"};`;
    bubble.textContent = msg.contentText ?? "";
    messagesEl.appendChild(bubble);
    applyTheme();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function showEmptyState(): void {
    messagesEl.dataset.empty = "1";
    const el = document.createElement("div");
    el.style.cssText = "text-align:center;font-size:13px;padding:16px 8px;";
    el.style.color = palette().muted;
    el.textContent = t.emptyState;
    messagesEl.appendChild(el);
  }

  // ---------- API ----------
  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  let sessionPromise: Promise<void> | null = null;
  async function ensureSession(force = false): Promise<void> {
    if (token && !force) return;
    if (sessionPromise && !force) return sessionPromise;
    sessionPromise = (async () => {
      const res = await fetch(
        `${apiBase}/api/webchat/${encodeURIComponent(String(siteKey))}/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId }),
        },
      );
      if (!res.ok) throw new Error(`session failed: ${res.status}`);
      const data = (await res.json()) as SessionResponse;
      token = data.token;
      saveStore({ visitorId, token });
      messagesEl.textContent = "";
      seen.clear();
      if (data.messages.length === 0) showEmptyState();
      for (const m of data.messages) appendMessage(m);
    })();
    try {
      await sessionPromise;
    } finally {
      sessionPromise = null;
    }
  }

  async function syncMessages(): Promise<void> {
    if (!token) return;
    const res = await apiFetch("/api/webchat/messages");
    if (res.status === 401) {
      token = null;
      saveStore({ visitorId });
      await ensureSession(true);
      connectWs();
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMessage[] };
    for (const m of data.messages) appendMessage(m);
  }

  // ---------- WebSocket + polling cadangan ----------
  let ws: WebSocket | null = null;
  let pollTimer: number | null = null;
  let opened = false;

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => void syncMessages(), 4000);
  }
  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function connectWs(): void {
    if (!token) return;
    try {
      ws?.close();
    } catch {
      /* abaikan */
    }
    const wsUrl = `${apiBase.replace(/^http/, "ws")}/api/webchat/ws?token=${encodeURIComponent(token)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      startPolling();
      return;
    }
    ws = socket;
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          type?: string;
          message?: ChatMessage;
        };
        if (data.type === "message" && data.message) {
          appendMessage(data.message);
        }
      } catch {
        /* abaikan frame tidak dikenal */
      }
    };
    socket.onopen = () => stopPolling();
    socket.onclose = () => {
      if (opened) startPolling();
    };
    socket.onerror = () => startPolling();
  }

  // ---------- Interaksi ----------
  async function openPanel(): Promise<void> {
    opened = true;
    panel.style.display = "flex";
    applyTheme();
    if (messagesEl.childElementCount === 0) {
      const loading = document.createElement("div");
      loading.style.cssText = "text-align:center;font-size:13px;padding:16px 8px;";
      loading.style.color = palette().muted;
      loading.textContent = t.connecting;
      messagesEl.appendChild(loading);
    }
    try {
      await ensureSession();
      connectWs();
      if (messagesEl.firstChild && messagesEl.childElementCount === 1 && seen.size === 0) {
        // Hanya teks "connecting" — bersihkan bila sesi tanpa pesan.
        if ((messagesEl.firstChild as HTMLElement).textContent === t.connecting) {
          messagesEl.textContent = "";
          showEmptyState();
        }
      }
    } catch {
      startPolling();
    }
    input.focus();
  }
  function closePanel(): void {
    opened = false;
    panel.style.display = "none";
    stopPolling();
    try {
      ws?.close();
    } catch {
      /* abaikan */
    }
  }
  button.addEventListener("click", () => {
    if (opened) closePanel();
    else void openPanel();
  });
  closeBtn.addEventListener("click", closePanel);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void (async () => {
      await ensureSession();
      const res = await apiFetch("/api/webchat/messages", {
        method: "POST",
        body: JSON.stringify({ contentText: text }),
      });
      if (res.status === 401) {
        token = null;
        saveStore({ visitorId });
        await ensureSession(true);
        connectWs();
        const retry = await apiFetch("/api/webchat/messages", {
          method: "POST",
          body: JSON.stringify({ contentText: text }),
        });
        if (retry.ok) appendMessage((await retry.json()) as ChatMessage);
        return;
      }
      if (res.ok) appendMessage((await res.json()) as ChatMessage);
    })();
  });

  applyTheme();
})();
