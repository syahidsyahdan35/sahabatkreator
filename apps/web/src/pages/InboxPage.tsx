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

  // Utas selalu dibuka dari pesan terbaru.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, messagesLoading]);

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
                        {conv.contactName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">
                            {conv.contactName}
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
                      {selected.contactName}
                    </div>
                    <div className="text-xs text-muted">
                      {t(`inbox.providers.${selected.provider}` as TranslationKey)}
                      {" · "}
                      {t(`inbox.status.${selected.status}` as TranslationKey)}
                      {selected.unreadCount > 0
                        ? ` · ${t("inbox.unreadLabel", { count: selected.unreadCount })}`
                        : ""}
                    </div>
                  </div>
                </div>

                <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto bg-bg px-4 py-4">
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
                      placeholder={t("inbox.replyPlaceholder")}
                      rows={2}
                      maxLength={4096}
                      className={`${inputClassName} resize-none`}
                    />
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {sending ? t("inbox.sending") : t("inbox.sendButton")}
                    </button>
                  </div>
                  <FieldError message={sendError} />
                  <p className="mt-2 text-[11px] text-muted">{t("inbox.deliveryNote")}</p>
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
