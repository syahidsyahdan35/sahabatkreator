import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type {
  ChannelAccountResponse,
  MetaWebhookInfoResponse,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api, ApiClientError } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { ChannelAvatar } from "../components/ChannelAvatar";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { formatDate } from "../utils/format";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface ChannelsPageProps {
  t: Translate;
  locale: Locale;
}

function providerLabel(t: Translate, provider: string): string {
  return t(`inbox.providers.${provider}` as TranslationKey);
}

function embedSnippet(siteKey: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://botara.my.id";
  return `<script src="${origin}/widget.js" data-site-key="${siteKey}"></script>`;
}

/** Tautan demo publik webchat — halaman yang benar-benar bisa dibuka pengunjung. */
function demoUrl(siteKey: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://botara.my.id";
  return `${origin}/webchat-demo?key=${siteKey}`;
}

/** Potong string panjang di tengah: `wc_kY1iy8xy…kLTw9`. */
function truncateMiddle(value: string, head = 10, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Baris @handle di bawah nama kartu; null bila tidak ada yang masuk akal. */
function handleLine(channel: ChannelAccountResponse): string | null {
  if (channel.provider === "telegram") {
    return channel.botUsername ? `@${channel.botUsername}` : null;
  }
  if (channel.provider === "messenger" || channel.provider === "instagram") {
    // Fase 7A: handle publik Meta dari Graph; Page tanpa username
    // menampilkan Page ID-nya (terpotong rapi seperti siteKey webchat).
    return channel.publicHandle
      ? `@${channel.publicHandle}`
      : truncateMiddle(channel.externalId);
  }
  if (channel.provider === "whatsapp") {
    // Fase 7B: handle WhatsApp = nomor tampil terformat dari Graph
    // (display_phone_number di publicHandle); bukan @handle.
    return channel.publicHandle ?? truncateMiddle(channel.externalId);
  }
  if (channel.provider === "webchat") {
    // Webchat tidak punya @handle — siteKey terpotong adalah identitasnya.
    return truncateMiddle(channel.externalId);
  }
  return null;
}

interface PublicLink {
  url: string;
  display: string;
}

/**
 * Tautan publik kartu + tombol salinnya. Telegram: profil bot t.me (tetap
 * sah walau channel sedang terputus — botnya tetap ada). Webchat: tautan
 * demo, hanya saat connected (channel terputus menolak sesi baru, jadi
 * menampilkannya akan menyesatkan).
 */
function publicLink(channel: ChannelAccountResponse): PublicLink | null {
  if (channel.provider === "telegram" && channel.botUsername) {
    return {
      url: `https://t.me/${channel.botUsername}`,
      display: `t.me/${channel.botUsername}`,
    };
  }
  // Fase 7A: tautan publik Meta hanya saat connected (pola webchat) —
  // Messenger memakai m.me/<username atau Page ID>; Instagram butuh
  // username (akun IG selalu punya) untuk ig.me/m/<username>.
  if (channel.provider === "messenger" && channel.status === "connected") {
    const slug = channel.publicHandle || channel.externalId;
    return { url: `https://m.me/${slug}`, display: `m.me/${slug}` };
  }
  if (
    channel.provider === "instagram" &&
    channel.status === "connected" &&
    channel.publicHandle
  ) {
    return {
      url: `https://ig.me/m/${channel.publicHandle}`,
      display: `ig.me/m/${channel.publicHandle}`,
    };
  }
  // Fase 7B: chip WhatsApp = wa.me/<digit nomor> (hanya digit dari
  // nomor tampil; phone_number_id BUKAN nomor telepon, jadi tanpa
  // publicHandle tidak ada chip yang jujur untuk ditampilkan).
  if (
    channel.provider === "whatsapp" &&
    channel.status === "connected" &&
    channel.publicHandle
  ) {
    const digits = channel.publicHandle.replace(/\D/g, "");
    if (digits) {
      return { url: `https://wa.me/${digits}`, display: `wa.me/${digits}` };
    }
  }
  if (channel.provider === "webchat" && channel.status === "connected") {
    const url = demoUrl(channel.externalId);
    return { url, display: url.replace(/^https?:\/\//, "") };
  }
  return null;
}

function PowerIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M12 3v8" />
      <path d="M17.7 6.3a8 8 0 1 1-11.4 0" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Pill status kartu: titik + label, warna mengikuti token semantik tema. */
function StatusPill({
  t,
  status,
}: {
  t: Translate;
  status: ChannelAccountResponse["status"];
}) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("channels.statusActive")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        {t("channels.statusError")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      {t("channels.statusDisconnected")}
    </span>
  );
}

/**
 * Halaman Channels (Fase 1F; kartu Fase 6H mengikuti referensi UI user):
 * daftar channel workspace aktif sebagai KARTU (avatar + badge provider,
 * nama/@handle, pill status + tanggal terhubung, chip tautan publik) +
 * form hubungkan Webchat, Telegram, Messenger, Instagram & WhatsApp
 * (Fase 7B: semua provider sudah bisa dihubungkan — tidak ada lagi
 * kartu "segera"). Ikon power pada kartu memakai alur
 * Disconnect yang sudah ada; ikon sampah (Fase 6I) membuka dialog hapus
 * BERPENJAGA (ketik nama untuk konfirmasi + tombol ekspor riwayat di
 * dialog yang sama) → channel masuk seksi Sampah di bawah (masa tenggang
 * 30 hari: Pulihkan / Ekspor) sebelum worker meng-purge permanen.
 */
export function ChannelsPage({ t, locale }: ChannelsPageProps) {
  const { active } = useWorkspace();
  const tenantId = active?.id ?? null;

  const [items, setItems] = useState<ChannelAccountResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ChannelAccountResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [tgName, setTgName] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgCreating, setTgCreating] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  // Form Meta (Fase 7A): Messenger (Page) & Instagram — token-based
  // seperti Telegram; token hanya hidup di state selama form terisi.
  const [msName, setMsName] = useState("");
  const [msPageId, setMsPageId] = useState("");
  const [msToken, setMsToken] = useState("");
  const [msCreating, setMsCreating] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);
  const [igName, setIgName] = useState("");
  const [igPageId, setIgPageId] = useState("");
  const [igId, setIgId] = useState("");
  const [igToken, setIgToken] = useState("");
  const [igCreating, setIgCreating] = useState(false);
  const [igError, setIgError] = useState<string | null>(null);
  // Form WhatsApp (Fase 7B): WABA ID + Phone Number ID + token System
  // User — token-based seperti Meta; token hanya hidup di state form.
  const [waName, setWaName] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waCreating, setWaCreating] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [metaWebhook, setMetaWebhook] =
    useState<MetaWebhookInfoResponse | null>(null);
  const [copiedWebhookField, setCopiedWebhookField] = useState<string | null>(
    null,
  );
  const [disconnectTarget, setDisconnectTarget] =
    useState<ChannelAccountResponse | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [trashItems, setTrashItems] = useState<ChannelAccountResponse[]>([]);
  const [deleteTarget, setDeleteTarget] =
    useState<ChannelAccountResponse | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [channels, trashed] = await Promise.all([
        api.channels.list(tenantId),
        api.channels.listTrash(tenantId),
      ]);
      setItems(channels);
      setTrashItems(trashed);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Info webhook Meta (Fase 7A): hanya owner/admin yang bisa membaca
  // endpoint-nya — peran lain menerima 403 dan panel disembunyikan
  // diam-diam (bukan error halaman).
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api.channels
      .metaWebhookInfo(tenantId)
      .then((info) => {
        if (!cancelled) setMetaWebhook(info);
      })
      .catch(() => {
        if (!cancelled) setMetaWebhook(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.channels.create(tenantId, {
        provider: "webchat",
        displayName: name.trim() || undefined,
      });
      setJustCreated(created);
      setName("");
      await load();
    } catch (err) {
      setCreateError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("errors.generic"),
      );
    } finally {
      setCreating(false);
    }
  };

  const handleConnectTelegram = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setTgCreating(true);
    setTgError(null);
    try {
      await api.channels.create(tenantId, {
        provider: "telegram",
        displayName: tgName.trim() || undefined,
        botToken: tgToken.trim(),
      });
      // Token tidak disimpan di state lebih lama dari yang perlu.
      setTgToken("");
      setTgName("");
      await load();
    } catch (err) {
      setTgError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("errors.generic"),
      );
    } finally {
      setTgCreating(false);
    }
  };

  const handleConnectMessenger = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setMsCreating(true);
    setMsError(null);
    try {
      await api.channels.create(tenantId, {
        provider: "messenger",
        displayName: msName.trim() || undefined,
        pageId: msPageId.trim(),
        pageAccessToken: msToken.trim(),
      });
      // Token tidak disimpan di state lebih lama dari yang perlu.
      setMsToken("");
      setMsName("");
      setMsPageId("");
      await load();
    } catch (err) {
      setMsError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("errors.generic"),
      );
    } finally {
      setMsCreating(false);
    }
  };

  const handleConnectInstagram = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setIgCreating(true);
    setIgError(null);
    try {
      await api.channels.create(tenantId, {
        provider: "instagram",
        displayName: igName.trim() || undefined,
        pageId: igPageId.trim(),
        igUserId: igId.trim(),
        pageAccessToken: igToken.trim(),
      });
      setIgToken("");
      setIgName("");
      setIgPageId("");
      setIgId("");
      await load();
    } catch (err) {
      setIgError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("errors.generic"),
      );
    } finally {
      setIgCreating(false);
    }
  };

  const handleConnectWhatsApp = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setWaCreating(true);
    setWaError(null);
    try {
      await api.channels.create(tenantId, {
        provider: "whatsapp",
        displayName: waName.trim() || undefined,
        wabaId: waWabaId.trim(),
        phoneNumberId: waPhoneId.trim(),
        accessToken: waToken.trim(),
      });
      // Token tidak disimpan di state lebih lama dari yang perlu.
      setWaToken("");
      setWaName("");
      setWaWabaId("");
      setWaPhoneId("");
      await load();
    } catch (err) {
      setWaError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("errors.generic"),
      );
    } finally {
      setWaCreating(false);
    }
  };

  const copyWebhookValue = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedWebhookField(field);
      window.setTimeout(
        () => setCopiedWebhookField((cur) => (cur === field ? null : cur)),
        2000,
      );
    } catch {
      /* clipboard tidak tersedia — nilai tetap terlihat untuk disalin manual */
    }
  };

  const handleDisconnect = async () => {
    if (!tenantId || !disconnectTarget) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await api.channels.disconnect(tenantId, disconnectTarget.id);
      setDisconnectTarget(null);
      await load();
    } catch (err) {
      setDisconnectError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("channels.disconnectError"),
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTrash = async () => {
    if (!tenantId || !deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.channels.trash(tenantId, deleteTarget.id, deleteName);
      setDeleteTarget(null);
      setDeleteName("");
      await load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("channels.deleteError"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = async (channel: ChannelAccountResponse) => {
    if (!tenantId) return;
    setRestoringId(channel.id);
    setRestoreError(null);
    try {
      await api.channels.restore(tenantId, channel.id);
      await load();
    } catch (err) {
      setRestoreError(
        err instanceof ApiClientError
          ? translateApiError(t, err)
          : t("channels.restoreError"),
      );
    } finally {
      setRestoringId(null);
    }
  };

  const handleExport = async (channel: ChannelAccountResponse) => {
    if (!tenantId) return;
    try {
      await api.channels.downloadExport(tenantId, channel.id);
    } catch {
      /* unduhan gagal — riwayat tetap aman; pengguna bisa mencoba lagi */
    }
  };

  const copySnippet = async (channel: ChannelAccountResponse) => {
    try {
      await navigator.clipboard.writeText(embedSnippet(channel.externalId));
      setCopiedId(channel.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === channel.id ? null : cur)), 2000);
    } catch {
      /* clipboard tidak tersedia — snippet tetap bisa disalin manual */
    }
  };

  const copyLink = async (channel: ChannelAccountResponse, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(channel.id);
      window.setTimeout(
        () => setCopiedLinkId((cur) => (cur === channel.id ? null : cur)),
        2000,
      );
    } catch {
      /* clipboard tidak tersedia — tautan tetap terlihat untuk disalin manual */
    }
  };

  /** "Hubungkan lagi" (channel terputus): arahkan ke form provider yang ada. */
  const focusTelegramForm = () => {
    const el = document.getElementById("telegram-token");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus({ preventScroll: true }), 350);
  };

  const focusMessengerForm = () => {
    const el = document.getElementById("messenger-page-id");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus({ preventScroll: true }), 350);
  };

  const focusInstagramForm = () => {
    const el = document.getElementById("instagram-ig-id");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus({ preventScroll: true }), 350);
  };

  const focusWhatsAppForm = () => {
    const el = document.getElementById("whatsapp-phone-id");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus({ preventScroll: true }), 350);
  };

  if (!tenantId) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{t("channels.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("workspace.none")}</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-bold">{t("channels.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("channels.subtitle")}</p>

      {error ? (
        <div className="mt-4">
          <FieldError message={error} />
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-md bg-elevated px-3 py-1 text-sm"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}

      <h2 className="mt-6 font-semibold">{t("channels.listTitle")}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading && items.length === 0 ? (
          <p className="text-sm text-muted sm:col-span-2 xl:col-span-3">
            {t("common.loading")}
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-4 sm:col-span-2 xl:col-span-3">
            <div className="font-semibold">{t("channels.emptyTitle")}</div>
            <p className="mt-1 text-sm text-muted">{t("channels.emptyBody")}</p>
          </div>
        ) : (
          items.map((channel) => {
            const handle = handleLine(channel);
            const link = publicLink(channel);
            return (
              <article
                key={channel.id}
                className={`flex flex-col rounded-xl border border-line bg-surface p-4 ${
                  channel.status === "disconnected" ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <ChannelAvatar
                    provider={channel.provider}
                    name={
                      channel.displayName ||
                      channel.botUsername ||
                      channel.publicHandle ||
                      providerLabel(t, channel.provider)
                    }
                    imageUrl={channel.avatarUrl ?? undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {channel.displayName || providerLabel(t, channel.provider)}
                    </div>
                    {handle ? (
                      <div className="truncate font-mono text-sm text-muted">
                        {handle}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted">
                      {providerLabel(t, channel.provider)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {channel.status !== "disconnected" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDisconnectError(null);
                          setDisconnectTarget(channel);
                        }}
                        aria-label={t("channels.disconnectButton")}
                        title={t("channels.disconnectButton")}
                        className={`rounded-md p-1.5 hover:bg-elevated ${
                          channel.status === "connected"
                            ? "text-success"
                            : "text-muted"
                        }`}
                      >
                        <PowerIcon />
                      </button>
                    ) : channel.provider === "telegram" ? (
                      <button
                        type="button"
                        onClick={focusTelegramForm}
                        className="rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                      >
                        {t("channels.reconnectButton")}
                      </button>
                    ) : channel.provider === "messenger" ? (
                      <button
                        type="button"
                        onClick={focusMessengerForm}
                        className="rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                      >
                        {t("channels.reconnectButton")}
                      </button>
                    ) : channel.provider === "instagram" ? (
                      <button
                        type="button"
                        onClick={focusInstagramForm}
                        className="rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                      >
                        {t("channels.reconnectButton")}
                      </button>
                    ) : channel.provider === "whatsapp" ? (
                      <button
                        type="button"
                        onClick={focusWhatsAppForm}
                        className="rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                      >
                        {t("channels.reconnectButton")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteName("");
                        setDeleteTarget(channel);
                      }}
                      aria-label={t("channels.deleteButton")}
                      title={t("channels.deleteButton")}
                      className="rounded-md p-1.5 text-muted hover:bg-elevated hover:text-danger"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusPill t={t} status={channel.status} />
                  <span className="text-xs text-muted">
                    {t("channels.connectedSince", {
                      date: formatDate(channel.createdAt, locale),
                    })}
                  </span>
                </div>

                {link ? (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center rounded-lg bg-elevated px-3 py-2">
                      <span className="truncate font-mono text-xs text-accent">
                        {link.display}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyLink(channel, link.url)}
                      aria-label={t("channels.copyLink")}
                      title={
                        copiedLinkId === channel.id
                          ? t("channels.copied")
                          : t("channels.copyLink")
                      }
                      className="shrink-0 rounded-lg border border-line bg-surface p-2 text-muted hover:text-ink"
                    >
                      {copiedLinkId === channel.id ? (
                        <span className="text-success">
                          <CheckIcon />
                        </span>
                      ) : (
                        <CopyIcon />
                      )}
                    </button>
                  </div>
                ) : null}

                {channel.provider === "webchat" && channel.status === "connected" ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <div className="text-xs text-muted">
                      {t("channels.siteKeyLabel")}:{" "}
                      <code className="font-mono">{channel.externalId}</code>
                    </div>
                    <div className="text-sm font-medium">{t("channels.embedTitle")}</div>
                    <p className="text-xs text-muted">{t("channels.embedHint")}</p>
                    <textarea
                      readOnly
                      rows={2}
                      value={embedSnippet(channel.externalId)}
                      className="w-full rounded-md border border-line bg-elevated p-2 font-mono text-xs"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      type="button"
                      onClick={() => void copySnippet(channel)}
                      className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white"
                    >
                      {copiedId === channel.id ? t("channels.copied") : t("channels.copyButton")}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <form
        onSubmit={handleCreate}
        className="mt-8 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{t("channels.createTitle")}</h2>
        <label className="mt-3 block text-sm font-medium" htmlFor="channel-name">
          {t("channels.nameLabel")}
        </label>
        <input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("channels.namePlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        {createError ? (
          <div className="mt-2">
            <FieldError message={createError} />
          </div>
        ) : null}
        {justCreated ? (
          <p className="mt-2 text-sm text-muted">
            {t("channels.siteKeyLabel")}:{" "}
            <code className="font-mono">{justCreated.externalId}</code>
          </p>
        ) : null}
        <button
          type="submit"
          disabled={creating}
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {creating ? t("channels.creating") : t("channels.createButton")}
        </button>
      </form>

      <form
        onSubmit={handleConnectTelegram}
        className="mt-8 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{t("channels.telegramTitle")}</h2>
        <label className="mt-3 block text-sm font-medium" htmlFor="telegram-name">
          {t("channels.telegramNameLabel")}
        </label>
        <input
          id="telegram-name"
          value={tgName}
          onChange={(e) => setTgName(e.target.value)}
          placeholder={t("channels.telegramNamePlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="telegram-token">
          {t("channels.tokenLabel")}
        </label>
        <input
          id="telegram-token"
          type="password"
          autoComplete="off"
          value={tgToken}
          onChange={(e) => setTgToken(e.target.value)}
          placeholder={t("channels.tokenPlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        <p className="mt-1 text-xs text-muted">{t("channels.tokenHint")}</p>
        {tgError ? (
          <div className="mt-2">
            <FieldError message={tgError} />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={tgCreating || !tgToken.trim()}
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {tgCreating ? t("channels.telegramConnecting") : t("channels.telegramConnectButton")}
        </button>
      </form>

      <form
        onSubmit={handleConnectMessenger}
        className="mt-8 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{t("channels.messengerTitle")}</h2>
        <label className="mt-3 block text-sm font-medium" htmlFor="messenger-name">
          {t("channels.metaNameLabel")}
        </label>
        <input
          id="messenger-name"
          value={msName}
          onChange={(e) => setMsName(e.target.value)}
          placeholder={t("channels.metaNamePlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="messenger-page-id">
          {t("channels.pageIdLabel")}
        </label>
        <input
          id="messenger-page-id"
          value={msPageId}
          onChange={(e) => setMsPageId(e.target.value)}
          placeholder={t("channels.pageIdPlaceholder")}
          maxLength={64}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="messenger-token">
          {t("channels.pageTokenLabel")}
        </label>
        <input
          id="messenger-token"
          type="password"
          autoComplete="off"
          value={msToken}
          onChange={(e) => setMsToken(e.target.value)}
          placeholder={t("channels.pageTokenPlaceholder")}
          maxLength={1024}
          className={`${inputClassName} mt-1`}
        />
        <p className="mt-1 text-xs text-muted">{t("channels.metaTokenHint")}</p>
        {msError ? (
          <div className="mt-2">
            <FieldError message={msError} />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={msCreating || !msPageId.trim() || !msToken.trim()}
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {msCreating ? t("channels.metaConnecting") : t("channels.messengerConnectButton")}
        </button>
      </form>

      <form
        onSubmit={handleConnectInstagram}
        className="mt-8 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{t("channels.instagramTitle")}</h2>
        <label className="mt-3 block text-sm font-medium" htmlFor="instagram-name">
          {t("channels.metaNameLabel")}
        </label>
        <input
          id="instagram-name"
          value={igName}
          onChange={(e) => setIgName(e.target.value)}
          placeholder={t("channels.metaNamePlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="instagram-ig-id">
          {t("channels.igIdLabel")}
        </label>
        <input
          id="instagram-ig-id"
          value={igId}
          onChange={(e) => setIgId(e.target.value)}
          placeholder={t("channels.igIdPlaceholder")}
          maxLength={64}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="instagram-page-id">
          {t("channels.pageIdLabel")}
        </label>
        <input
          id="instagram-page-id"
          value={igPageId}
          onChange={(e) => setIgPageId(e.target.value)}
          placeholder={t("channels.pageIdPlaceholder")}
          maxLength={64}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="instagram-token">
          {t("channels.pageTokenLabel")}
        </label>
        <input
          id="instagram-token"
          type="password"
          autoComplete="off"
          value={igToken}
          onChange={(e) => setIgToken(e.target.value)}
          placeholder={t("channels.pageTokenPlaceholder")}
          maxLength={1024}
          className={`${inputClassName} mt-1`}
        />
        <p className="mt-1 text-xs text-muted">{t("channels.metaTokenHint")}</p>
        {igError ? (
          <div className="mt-2">
            <FieldError message={igError} />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={igCreating || !igId.trim() || !igPageId.trim() || !igToken.trim()}
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {igCreating ? t("channels.metaConnecting") : t("channels.instagramConnectButton")}
        </button>
      </form>

      <form
        onSubmit={handleConnectWhatsApp}
        className="mt-8 rounded-lg border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{t("channels.whatsappTitle")}</h2>
        <label className="mt-3 block text-sm font-medium" htmlFor="whatsapp-name">
          {t("channels.metaNameLabel")}
        </label>
        <input
          id="whatsapp-name"
          value={waName}
          onChange={(e) => setWaName(e.target.value)}
          placeholder={t("channels.metaNamePlaceholder")}
          maxLength={255}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="whatsapp-waba-id">
          {t("channels.wabaIdLabel")}
        </label>
        <input
          id="whatsapp-waba-id"
          value={waWabaId}
          onChange={(e) => setWaWabaId(e.target.value)}
          placeholder={t("channels.wabaIdPlaceholder")}
          maxLength={64}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="whatsapp-phone-id">
          {t("channels.phoneNumberIdLabel")}
        </label>
        <input
          id="whatsapp-phone-id"
          value={waPhoneId}
          onChange={(e) => setWaPhoneId(e.target.value)}
          placeholder={t("channels.phoneNumberIdPlaceholder")}
          maxLength={64}
          className={`${inputClassName} mt-1`}
        />
        <label className="mt-3 block text-sm font-medium" htmlFor="whatsapp-token">
          {t("channels.waTokenLabel")}
        </label>
        <input
          id="whatsapp-token"
          type="password"
          autoComplete="off"
          value={waToken}
          onChange={(e) => setWaToken(e.target.value)}
          placeholder={t("channels.waTokenPlaceholder")}
          maxLength={1024}
          className={`${inputClassName} mt-1`}
        />
        <p className="mt-1 text-xs text-muted">{t("channels.waTokenHint")}</p>
        {waError ? (
          <div className="mt-2">
            <FieldError message={waError} />
          </div>
        ) : null}
        <button
          type="submit"
          disabled={waCreating || !waWabaId.trim() || !waPhoneId.trim() || !waToken.trim()}
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {waCreating ? t("channels.metaConnecting") : t("channels.whatsappConnectButton")}
        </button>
      </form>

      {metaWebhook ? (
        <div className="mt-8 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">{t("channels.metaWebhookTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("channels.metaWebhookBody")}</p>
          <label className="mt-3 block text-sm font-medium">
            {t("channels.metaWebhookUrlLabel")}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-elevated px-3 py-2 font-mono text-xs">
              {metaWebhook.webhookUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyWebhookValue("url", metaWebhook.webhookUrl)}
              aria-label={t("channels.copyLink")}
              title={
                copiedWebhookField === "url"
                  ? t("channels.copied")
                  : t("channels.copyLink")
              }
              className="shrink-0 rounded-lg border border-line bg-surface p-2 text-muted hover:text-ink"
            >
              {copiedWebhookField === "url" ? (
                <span className="text-success">
                  <CheckIcon />
                </span>
              ) : (
                <CopyIcon />
              )}
            </button>
          </div>
          <label className="mt-3 block text-sm font-medium">
            {t("channels.metaWebhookTokenLabel")}
          </label>
          {metaWebhook.verifyToken ? (
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-elevated px-3 py-2 font-mono text-xs">
                {metaWebhook.verifyToken}
              </code>
              <button
                type="button"
                onClick={() =>
                  void copyWebhookValue("token", metaWebhook.verifyToken ?? "")
                }
                aria-label={t("channels.copyLink")}
                title={
                  copiedWebhookField === "token"
                    ? t("channels.copied")
                    : t("channels.copyLink")
                }
                className="shrink-0 rounded-lg border border-line bg-surface p-2 text-muted hover:text-ink"
              >
                {copiedWebhookField === "token" ? (
                  <span className="text-success">
                    <CheckIcon />
                  </span>
                ) : (
                  <CopyIcon />
                )}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              {t("channels.metaWebhookNotConfigured")}
            </p>
          )}
          {!metaWebhook.appSecretConfigured ? (
            <p className="mt-2 text-xs text-muted">
              {t("channels.metaWebhookSecretMissing")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="font-semibold">{t("channels.trashTitle")}</h2>
        {restoreError ? (
          <div className="mt-2">
            <FieldError message={restoreError} />
          </div>
        ) : null}
        {trashItems.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("channels.trashEmpty")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {trashItems.map((channel) => (
              <div
                key={channel.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 opacity-80"
              >
                <ChannelAvatar
                  provider={channel.provider}
                  name={
                    channel.displayName ||
                    channel.botUsername ||
                    channel.publicHandle ||
                    providerLabel(t, channel.provider)
                  }
                  imageUrl={channel.avatarUrl ?? undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {channel.displayName || providerLabel(t, channel.provider)}
                  </div>
                  <div className="text-xs text-muted">
                    {providerLabel(t, channel.provider)}
                    {channel.trashedAt
                      ? ` · ${t("channels.trashedOn", {
                          date: formatDate(channel.trashedAt, locale),
                        })}`
                      : ""}
                    {channel.purgeAt
                      ? ` · ${t("channels.purgeOn", {
                          date: formatDate(channel.purgeAt, locale),
                        })}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleExport(channel)}
                  className="rounded-md bg-elevated px-3 py-1.5 text-sm font-medium"
                >
                  {t("channels.exportButton")}
                </button>
                <button
                  type="button"
                  disabled={restoringId === channel.id}
                  onClick={() => void handleRestore(channel)}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {restoringId === channel.id
                    ? t("channels.restoring")
                    : t("channels.restoreButton")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
            <h2 className="text-lg font-bold">{t("channels.deleteTitle")}</h2>
            <p className="mt-2 text-sm text-muted">
              {t("channels.deleteBody", {
                name:
                  deleteTarget.displayName ||
                  providerLabel(t, deleteTarget.provider),
              })}
            </p>
            <button
              type="button"
              onClick={() => void handleExport(deleteTarget)}
              className="mt-3 rounded-lg bg-elevated px-4 py-2 text-sm font-medium"
            >
              {t("channels.deleteExportButton")}
            </button>
            <label
              className="mt-4 block text-sm font-medium"
              htmlFor="delete-confirm-name"
            >
              {t("channels.deleteConfirmLabel")}:{" "}
              <span className="font-mono font-semibold">
                {deleteTarget.confirmationName}
              </span>
            </label>
            <input
              id="delete-confirm-name"
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              className={`${inputClassName} mt-1`}
              autoComplete="off"
            />
            {deleteError ? (
              <div className="mt-2">
                <FieldError message={deleteError} />
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={deleting || deleteName !== deleteTarget.confirmationName}
                onClick={() => void handleTrash()}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleting
                  ? t("channels.deleting")
                  : t("channels.deleteConfirmButton")}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {disconnectTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
            <h2 className="text-lg font-bold">{t("channels.disconnectTitle")}</h2>
            <p className="mt-2 text-sm text-muted">
              {t("channels.disconnectBody", {
                name:
                  disconnectTarget.displayName ||
                  providerLabel(t, disconnectTarget.provider),
              })}
            </p>
            {disconnectError ? (
              <div className="mt-2">
                <FieldError message={disconnectError} />
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => void handleDisconnect()}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {disconnecting
                  ? t("channels.disconnecting")
                  : t("channels.disconnectButton")}
              </button>
              <button
                type="button"
                onClick={() => setDisconnectTarget(null)}
                className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
