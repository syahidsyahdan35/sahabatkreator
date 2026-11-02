import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  ConversationResponse,
  MessageResponse,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import {
  LIVE_REFRESH_INTERVAL_MS,
  usePolling,
} from "../hooks/usePolling";
import { useUnreadBadge } from "../inbox/UnreadBadgeProvider";
import { formatListTime, formatTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

const MESSAGE_LIMIT = 100;

interface InboxPageProps {
  t: Translate;
  locale: Locale;
}

/**
 * Halaman Inbox (Fase 1E): dua kolom responsif di atas API 1D.
 * - Kiri: daftar percakapan workspace aktif (nama kontak, cuplikan pesan
 *   terakhir, waktu, badge unread, label provider & status).
 * - Kanan: utas pesan kronologis + kotak balas. POST balasan membuat pesan
 *   outbound berstatus `queued` (pengiriman ke channel adalah stub Fase 1D —
 *   diberi label jujur lewat `inbox.deliveryNote`).
 * - Layar kecil: daftar dan utas bergantian; tombol kembali muncul di utas.
 * - Setelah kirim: utas dimuat ulang dari server + daftar percakapan
 *   disegarkan (cuplikan & urutan ikut berubah), badge nav disinkronkan.
 * - Penyegaran langsung (Hotfix Dashboard Realtime): daftar, utas yang
 *   terbuka, dan badge disegarkan otomatis tiap ±5 dtk lewat polling
 *   senyap (hooks/usePolling — jembatan menuju Fase 6G apps/realtime)
 *   tanpa mengganggu draf ketikan maupun posisi scroll agen.
 */
export function InboxPage({ t, locale }: InboxPageProps) {
  const { status, tenants, active, reload } = useWorkspace();
  const { setFromConversations } = useUnreadBadge();
  const tenantId = active?.id ?? null;

  const [conversations, setConversations] = useState<ConversationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageResponse[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const conversationsRef = useRef<ConversationResponse[]>([]);
  conversationsRef.current = conversations;
  // Agen dianggap "menempel di bawah" utas (pantas ikut turun saat pesan
  // baru tiba) hanya bila posisi scroll-nya dekat dasar; begitu ia scroll
  // ke atas membaca riwayat, penyegaran latar TIDAK boleh menyeretnya.
  const stickToBottomRef = useRef(true);

  const loadConversations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.conversations.list(tenantId);
      setConversations(list);
      setFromConversations(list);
    } catch (err) {
      setError(translateApiError(t, err));
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, t, setFromConversations]);

  // Ganti workspace → daftar & pilihan direset, data workspace baru dimuat.
  useEffect(() => {
    setSelectedId(null);
    setMessages([]);
    setDraft("");
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!tenantId) return;
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const list = await api.conversations.listMessages(
          tenantId,
          conversationId,
          { limit: MESSAGE_LIMIT },
        );
        if (selectedRef.current !== conversationId) return;
        setMessages(list);
        // Server menandai percakapan terbaca saat utas dibuka (API GET
        // messages) — sinkronkan daftar lokal & badge navigasi sekarang
        // juga, tanpa menunggu muat ulang daftar (bug QA-1: chip unread
        // & badge tidak pernah bersih setelah percakapan dibuka).
        const current = conversationsRef.current;
        if (
          current.some(
            (c) => c.id === conversationId && c.unreadCount > 0,
          )
        ) {
          const next = current.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c,
          );
          setConversations(next);
          setFromConversations(next);
        }
      } catch (err) {
        if (selectedRef.current !== conversationId) return;
        setMessagesError(translateApiError(t, err));
        setMessages([]);
      } finally {
        if (selectedRef.current === conversationId) setMessagesLoading(false);
      }
    },
    [tenantId, t],
  );

  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // --- Penyegaran latar (Hotfix Dashboard Realtime) ---------------------
  // Versi SENYAP dari pemuatan awal: tidak menyalakan status memuat,
  // tidak memasang error, tidak menyentuh draf balasan maupun pilihan
  // percakapan. Kegagalan sesaat ditelan — siklus polling berikut
  // mencoba lagi. Transport polling ini jembatan menuju Fase 6G
  // (apps/realtime); nanti ia turun menjadi fallback (hooks/usePolling).

  const refreshConversationsInBackground = useCallback(async () => {
    if (!tenantId) return;
    try {
      const list = await api.conversations.list(tenantId);
      const openId = selectedRef.current;
      // Percakapan yang sedang dibuka sudah ditandai terbaca di server
      // oleh GET messages — paksa unread lokalnya 0 agar chip daftar &
      // badge tidak berkedip naik sesaat pada percakapan yang sedang
      // dibaca agen sendiri.
      const next =
        openId === null
          ? list
          : list.map((c) => (c.id === openId ? { ...c, unreadCount: 0 } : c));
      setConversations(next);
      setFromConversations(next);
    } catch {
      /* senyap — kegagalan latar bukan urusan agen */
    }
  }, [tenantId, setFromConversations]);

  const refreshMessagesInBackground = useCallback(async () => {
    const conversationId = selectedRef.current;
    if (!tenantId || !conversationId) return;
    try {
      const list = await api.conversations.listMessages(
        tenantId,
        conversationId,
        { limit: MESSAGE_LIMIT },
      );
      if (selectedRef.current !== conversationId) return;
      // Gabung per id pesan: salinan server menimpa versi lama (status
      // queued→sent ikut segar), pesan baru menempel di akhir mengikuti
      // urutan kronologis server — tanpa duplikat, tanpa mengganti
      // seluruh daftar (tidak ada kedip), draf ketikan tidak disentuh.
      setMessages((prev) => {
        const byId = new Map(list.map((m) => [m.id, m]));
        const merged = prev.map((m) => byId.get(m.id) ?? m);
        const seen = new Set(prev.map((m) => m.id));
        for (const m of list) {
          if (!seen.has(m.id)) merged.push(m);
        }
        return merged;
      });
      setMessagesError(null);
    } catch {
      /* senyap — siklus berikutnya mencoba lagi */
    }
  }, [tenantId]);

  const liveRefresh = useCallback(async () => {
    await refreshConversationsInBackground();
    await refreshMessagesInBackground();
  }, [refreshConversationsInBackground, refreshMessagesInBackground]);
  usePolling(liveRefresh, LIVE_REFRESH_INTERVAL_MS, tenantId !== null);

  // Pindah percakapan → utas dibuka dari pesan terbaru (menempel di bawah).
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedId]);

  // Ikut turun ke pesan terbaru HANYA bila agen sedang menempel di bawah;
  // agen yang sedang scroll ke atas membaca riwayat tidak diseret turun.
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, messagesLoading]);

  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!tenantId || !selectedId || !content || sending) return;
    setSendError(null);
    setSending(true);
    try {
      const created = await api.conversations.sendMessage(
        tenantId,
        selectedId,
        content,
      );
      // Agen yang baru mengirim balasan selalu dibawa ke pesan terbaru.
      stickToBottomRef.current = true;
      setDraft("");
      // Tampilkan langsung pesan returned (status queued), lalu segarkan
      // utas & daftar dari server agar konsisten dengan sumber kebenaran.
      setMessages((prev) => [...prev, created]);
      await loadMessages(selectedId);
      await loadConversations();
    } catch (err) {
      setSendError(translateApiError(t, err));
    } finally {
      setSending(false);
    }
  };

  if (status === "loading") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("inbox.title")}</h1>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("inbox.title")}</h1>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <p className="text-sm text-danger">{t("workspace.loadError")}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("common.retry")}
          </button>
        </div>
      </section>
    );
  }
  if (tenants.length === 0 || !active) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("inbox.title")}</h1>
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">{t("workspace.emptyTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{t("workspace.emptyBody")}</p>
        </div>
      </section>
    );
  }

  const selected =
    conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("inbox.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("inbox.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadConversations()}
          className="rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-ink"
        >
          {t("common.reload")}
        </button>
      </div>

      <FieldError message={error} />

      {loading && conversations.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{t("common.loading")}</p>
      ) : conversations.length === 0 && !error ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-base font-semibold text-ink">{t("inbox.emptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("inbox.emptyBody")}</p>
        </div>
      ) : (
        <div className="mt-5 flex h-[calc(100dvh-16rem)] min-h-[26rem] overflow-hidden rounded-xl border border-line bg-surface md:h-[calc(100dvh-12rem)]">
          {/* Kolom daftar — di mobile disembunyikan saat utas terbuka */}
          <div
            className={`w-full shrink-0 flex-col border-line md:flex md:w-80 md:border-r ${
              selected ? "hidden md:flex" : "flex"
            }`}
          >
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {conversations.map((conv) => {
                const isActive = conv.id === selectedId;
                // Percakapan grup (Fase 6A.1) tampil dengan judul grupnya;
                // privat tetap nama kontak.
                const displayName = conv.title ?? conv.contactName;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left ${
                        isActive ? "bg-accent/10" : "hover:bg-elevated"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                        {displayName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">
                            {displayName}
                          </span>
                          {conv.lastMessageAt ? (
                            <span className="shrink-0 text-[11px] text-muted">
                              {formatListTime(conv.lastMessageAt, locale)}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {conv.lastMessagePreview ?? t("inbox.mediaMessage")}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink">
                            {t(`inbox.providers.${conv.provider}` as TranslationKey)}
                          </span>
                          {conv.isGroup ? (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                              {t("inbox.groupLabel")}
                            </span>
                          ) : null}
                          {conv.isChannel ? (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                              {t("inbox.channelLabel")}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted">
                            {t(`inbox.status.${conv.status}` as TranslationKey)}
                          </span>
                        </span>
                      </span>
                      {conv.unreadCount > 0 ? (
                        <span className="mt-1 shrink-0 rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">
                          {conv.unreadCount}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Kolom utas — di mobile hanya tampil saat ada pilihan */}
          <div
            className={`min-w-0 flex-1 flex-col ${
              selected ? "flex" : "hidden md:flex"
            }`}
          >
            {selected ? (
              <>
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink md:hidden"
                  >
                    ← {t("common.back")}
                  </button>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-ink">
                      {selected.title ?? selected.contactName}
                    </div>
                    <div className="text-xs text-muted">
                      {t(`inbox.providers.${selected.provider}` as TranslationKey)}
                      {selected.isChannel
                        ? ` · ${t("inbox.channelLabel")}`
                        : selected.isGroup
                          ? ` · ${t("inbox.groupLabel")}`
                          : ""}
                      {" · "}
                      {t(`inbox.status.${selected.status}` as TranslationKey)}
                      {selected.unreadCount > 0
                        ? ` · ${t("inbox.unreadLabel", { count: selected.unreadCount })}`
                        : ""}
                    </div>
                  </div>
                </div>

                <div
                  ref={threadRef}
                  onScroll={handleThreadScroll}
                  className="flex-1 space-y-3 overflow-y-auto bg-bg px-4 py-4"
                >
                  {messagesLoading ? (
                    <p className="text-sm text-muted">{t("common.loading")}</p>
                  ) : messagesError ? (
                    <div>
                      <p className="text-sm text-danger">{messagesError}</p>
                      <button
                        type="button"
                        onClick={() => void loadMessages(selected.id)}
                        className="mt-2 rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
                      >
                        {t("common.retry")}
                      </button>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const outbound = msg.direction === "outbound";
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm md:max-w-[70%] ${
                              outbound
                                ? "rounded-br-sm bg-accent text-white"
                                : "rounded-bl-sm bg-surface text-ink shadow-sm"
                            }`}
                          >
                            {!outbound && msg.senderName ? (
                              <p className="mb-0.5 text-[11px] font-semibold text-accent">
                                {msg.senderName}
                              </p>
                            ) : null}
                            <p className="whitespace-pre-wrap break-words">
                              {msg.contentText ?? (
                                <span className="italic">{t("inbox.mediaMessage")}</span>
                              )}
                            </p>
                            <div
                              className={`mt-1 flex items-center gap-2 text-[11px] ${
                                outbound ? "text-white/80" : "text-muted"
                              }`}
                            >
                              {msg.senderType === "agent" ? (
                                <span>{t("inbox.senderAgent")}</span>
                              ) : msg.senderType === "system" ? (
                                <span>{t("inbox.senderSystem")}</span>
                              ) : null}
                              <span>{formatTime(msg.createdAt, locale)}</span>
                              {outbound ? (
                                <span>
                                  {t(`inbox.messageStatus.${msg.status}` as TranslationKey)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={handleSend}
                  className="border-t border-line bg-surface px-4 py-3"
                >
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder={
                        selected.isChannel
                          ? t("inbox.postPlaceholder")
                          : t("inbox.replyPlaceholder")
                      }
                      rows={2}
                      maxLength={4096}
                      className={`${inputClassName} resize-none`}
                    />
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {sending
                        ? t("inbox.sending")
                        : selected.isChannel
                          ? t("inbox.postButton")
                          : t("inbox.sendButton")}
                    </button>
                  </div>
                  <FieldError message={sendError} />
                  <p className="mt-2 text-[11px] text-muted">
                    {selected.isChannel
                      ? t("inbox.channelDeliveryNote")
                      : t("inbox.deliveryNote")}
                  </p>
                </form>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <h2 className="text-base font-semibold text-ink">
                    {t("inbox.selectPromptTitle")}
                  </h2>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
                    {t("inbox.selectPromptBody")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
