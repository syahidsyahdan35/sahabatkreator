import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { ChannelAccountResponse } from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api, ApiClientError } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import {
  ChannelAvatar,
  ProviderGlyph,
  providerMeta,
} from "../components/ChannelAvatar";
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

/** Provider yang belum bisa dihubungkan — ditampilkan jujur sebagai "segera". */
const UPCOMING_PROVIDERS = ["whatsapp", "instagram", "messenger"] as const;

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
 * form hubungkan Webchat & Telegram. Ikon power pada kartu memakai alur
 * Disconnect yang sudah ada; ikon sampah SENGAJA belum dipasang —
 * fungsinya (hapus berpenjaga) dibangun Fase 6I.
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
  const [disconnectTarget, setDisconnectTarget] =
    useState<ChannelAccountResponse | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await api.channels.list(tenantId));
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** "Hubungkan lagi" (Telegram terputus): arahkan ke form Telegram yang ada. */
  const focusTelegramForm = () => {
    const el = document.getElementById("telegram-token");
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
                      providerLabel(t, channel.provider)
                    }
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
                  {channel.status !== "disconnected" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDisconnectError(null);
                        setDisconnectTarget(channel);
                      }}
                      aria-label={t("channels.disconnectButton")}
                      title={t("channels.disconnectButton")}
                      className={`shrink-0 rounded-md p-1.5 hover:bg-elevated ${
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
                      className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-elevated"
                    >
                      {t("channels.reconnectButton")}
                    </button>
                  ) : null}
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

      <div className="mt-8">
        <h2 className="font-semibold">{t("common.comingSoon")}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {UPCOMING_PROVIDERS.map((provider) => {
            const meta = providerMeta(provider);
            return (
              <div
                key={provider}
                className="flex flex-col rounded-xl border border-line bg-surface p-4 opacity-60"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: `${meta.color}1f`,
                      color: meta.color,
                    }}
                    aria-hidden={true}
                  >
                    <ProviderGlyph provider={provider} className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {providerLabel(t, provider)}
                    </div>
                    <div className="text-xs text-muted">
                      {providerLabel(t, provider)}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
                    {t("common.comingSoon")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t("errors.CHANNEL_NOT_AVAILABLE_YET")}
                </p>
              </div>
            );
          })}
        </div>
      </div>

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
