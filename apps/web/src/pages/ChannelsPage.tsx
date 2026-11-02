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
import { useWorkspace } from "../workspace/WorkspaceProvider";

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

function statusLabel(t: Translate, status: ChannelAccountResponse["status"]): string {
  if (status === "connected") return t("channels.statusConnected");
  if (status === "error") return t("channels.statusError");
  return t("channels.statusDisconnected");
}

function embedSnippet(siteKey: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://botara.my.id";
  return `<script src="${origin}/widget.js" data-site-key="${siteKey}"></script>`;
}

/**
 * Halaman Channels (Fase 1F): daftar channel workspace aktif + buat channel
 * Webchat (provider pertama yang hidup end-to-end). Setelah dibuat, siteKey
 * + cuplikan embed ditampilkan siap salin. Provider lain tampil nonaktif
 * berlabel "segera" — tidak ada tombol palsu.
 */
export function ChannelsPage({ t }: ChannelsPageProps) {
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

      <div className="mt-6 space-y-3">
        {loading && items.length === 0 ? (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="font-semibold">{t("channels.emptyTitle")}</div>
            <p className="mt-1 text-sm text-muted">{t("channels.emptyBody")}</p>
          </div>
        ) : (
          items.map((channel) => (
            <article
              key={channel.id}
              className={`rounded-lg border border-line bg-surface p-4 ${
                channel.status === "disconnected" ? "opacity-60" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {channel.displayName || providerLabel(t, channel.provider)}
                </span>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">
                  {providerLabel(t, channel.provider)}
                </span>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-xs">
                  {statusLabel(t, channel.status)}
                </span>
                {channel.status !== "disconnected" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDisconnectError(null);
                      setDisconnectTarget(channel);
                    }}
                    className="ml-auto rounded-md bg-elevated px-3 py-1 text-sm font-medium"
                  >
                    {t("channels.disconnectButton")}
                  </button>
                ) : null}
              </div>
              {channel.provider === "telegram" && channel.botUsername ? (
                <div className="mt-2 text-xs text-muted">
                  {t("channels.botUsernameLabel")}:{" "}
                  <span className="font-mono">@{channel.botUsername}</span>
                </div>
              ) : null}
              {channel.provider === "webchat" && channel.status === "connected" ? (
                <div className="mt-3 space-y-2">
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
          ))
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
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {UPCOMING_PROVIDERS.map((provider) => (
            <div
              key={provider}
              className="rounded-lg border border-line bg-surface p-4 opacity-60"
            >
              <div className="font-medium">{providerLabel(t, provider)}</div>
              <p className="mt-1 text-xs text-muted">
                {t("errors.CHANNEL_NOT_AVAILABLE_YET")}
              </p>
            </div>
          ))}
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
