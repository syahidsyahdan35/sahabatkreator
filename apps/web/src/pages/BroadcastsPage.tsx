import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BroadcastAudienceEstimateResponse,
  BroadcastRecipientResponse,
  BroadcastResponse,
  BroadcastStatus,
  ChannelAccountResponse,
  ChannelProvider,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { usePolling } from "../hooks/usePolling";
import { formatDateTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface BroadcastsPageProps {
  t: Translate;
  locale: Locale;
}

/** Nama brand provider = kata benda nama diri, sama di kedua bahasa. */
const PROVIDER_NAMES: Record<ChannelProvider, string> = {
  telegram: "Telegram",
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  webchat: "Webchat",
};

const SUPPORTED_PROVIDERS: ReadonlySet<ChannelProvider> = new Set([
  "telegram",
  "messenger",
  "instagram",
]);

const STATUS_CHIP: Record<
  BroadcastStatus,
  { labelKey: TranslationKey; className: string }
> = {
  draft: {
    labelKey: "broadcasts.statusDraft",
    className: "bg-surface-2 text-muted",
  },
  scheduled: {
    labelKey: "broadcasts.statusScheduled",
    className: "bg-warning-soft text-warning",
  },
  sending: {
    labelKey: "broadcasts.statusSending",
    className: "bg-warning-soft text-warning",
  },
  completed: {
    labelKey: "broadcasts.statusCompleted",
    className: "bg-success-soft text-success",
  },
  partially_failed: {
    labelKey: "broadcasts.statusPartiallyFailed",
    className: "bg-warning-soft text-warning",
  },
  failed: {
    labelKey: "broadcasts.statusFailed",
    className: "bg-danger-soft text-danger",
  },
  cancelled: {
    labelKey: "broadcasts.statusCancelled",
    className: "bg-surface-2 text-muted",
  },
};

const RECIPIENT_STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  queued: "broadcasts.recipientStatusQueued",
  sent: "broadcasts.recipientStatusSent",
  delivered: "broadcasts.recipientStatusDelivered",
  read: "broadcasts.recipientStatusRead",
  failed: "broadcasts.recipientStatusFailed",
  skipped: "broadcasts.recipientStatusSkipped",
  cancelled: "broadcasts.recipientStatusCancelled",
};

const SKIP_REASON_LABEL_KEYS: Record<string, TranslationKey> = {
  opted_out: "broadcasts.skipReasonOptedOut",
  outside_24h_window: "broadcasts.skipReasonOutside24h",
  message_deleted: "broadcasts.skipReasonMessageDeleted",
};

const DISPATCH_ERROR_LABEL_KEYS: Record<string, TranslationKey> = {
  CHANNEL_DISCONNECTED: "broadcasts.dispatchErrorCHANNEL_DISCONNECTED",
  AUDIENCE_EMPTY: "broadcasts.dispatchErrorAUDIENCE_EMPTY",
  CHANNEL_UNSUPPORTED: "broadcasts.dispatchErrorCHANNEL_UNSUPPORTED",
};

function StatusChip({ t, status }: { t: Translate; status: BroadcastStatus }) {
  const chip = STATUS_CHIP[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
    >
      {t(chip.labelKey)}
    </span>
  );
}

function splitCommaList(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

type View =
  | { kind: "list" }
  | { kind: "form"; target: "create" | BroadcastResponse }
  | { kind: "detail"; id: string };

/**
 * Halaman Broadcasts (Fase 7C): daftar kampanye siaran + formulir buat/
 * edit draf + panel detail berisi statistik & daftar penerima.
 *
 * Keputusan v1 yang terlihat di UI (jujur, dwibahasa): WhatsApp &
 * webchat tampil NONAKTIF beralasan di pemilih channel (WA menunggu
 * template resmi; webchat tanpa semantik push); penerima Meta di luar
 * jendela 24 jam tampil sebagai `skipped` beralasan, bukan gagal.
 * Mutasi hanya untuk owner/admin (selaras API); member biasa membaca.
 * Konfirmasi batal/hapus memakai pola dua langkah sebaris (klik →
 * tombol berubah menjadi konfirmasi), konsisten tanpa modal global.
 */
export function BroadcastsPage({ t, locale }: BroadcastsPageProps) {
  const { status, active } = useWorkspace();
  const tenantId = active?.id ?? null;
  const canManage = active?.role === "owner" || active?.role === "admin";

  const [view, setView] = useState<View>({ kind: "list" });
  const [items, setItems] = useState<BroadcastResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!tenantId) return;
      const seq = ++requestSeq.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const page = await api.broadcasts.list(tenantId, { limit: 50 });
        if (requestSeq.current !== seq) return;
        setItems(page.broadcasts);
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (requestSeq.current !== seq) return;
        if (!silent) {
          setError(translateApiError(t, err));
          setItems([]);
        }
      } finally {
        if (requestSeq.current === seq && !silent) setLoading(false);
      }
    },
    [tenantId, t],
  );

  useEffect(() => {
    if (view.kind === "list") void load();
  }, [load, view.kind]);

  const anySending = items.some((b) => b.status === "sending");
  usePolling(
    () => {
      void load(true);
    },
    5000,
    view.kind === "list" && anySending,
  );

  const loadMore = async () => {
    if (!tenantId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.broadcasts.list(tenantId, {
        limit: 50,
        cursor: nextCursor,
      });
      setItems((prev) => [...prev, ...page.broadcasts]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (
    broadcast: BroadcastResponse,
    action: "send-now" | "cancel" | "delete",
  ) => {
    if (!tenantId || busyId) return;
    if (confirming !== `${action}:${broadcast.id}`) {
      if (action !== "send-now") {
        setConfirming(`${action}:${broadcast.id}`);
        return;
      }
    }
    setConfirming(null);
    setBusyId(broadcast.id);
    setError(null);
    try {
      if (action === "send-now") {
        await api.broadcasts.schedule(tenantId, broadcast.id, {});
      } else if (action === "cancel") {
        await api.broadcasts.cancel(tenantId, broadcast.id);
      } else {
        await api.broadcasts.remove(tenantId, broadcast.id);
      }
      await load();
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setBusyId(null);
    }
  };

  if (status === "loading") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("broadcasts.title")}</h1>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("broadcasts.title")}</h1>
        <p className="mt-6 text-sm text-danger">{t("workspace.loadError")}</p>
      </section>
    );
  }

  if (view.kind === "form") {
    return (
      <BroadcastForm
        t={t}
        tenantId={tenantId}
        target={view.target}
        onDone={() => setView({ kind: "list" })}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <BroadcastDetail
        t={t}
        locale={locale}
        tenantId={tenantId}
        broadcastId={view.id}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("broadcasts.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("broadcasts.subtitle")}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setView({ kind: "form", target: "create" })}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t("broadcasts.createButton")}
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          {t("broadcasts.forbidden")}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      ) : items.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm font-medium text-ink">{t("broadcasts.empty")}</p>
          <p className="mt-1 text-sm text-muted">{t("broadcasts.emptyHint")}</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((b) => (
            <li
              key={b.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: "detail", id: b.id })}
                  className="text-left text-sm font-semibold text-ink hover:underline"
                >
                  {b.name}
                </button>
                <StatusChip t={t} status={b.status} />
                <span className="text-xs text-muted">
                  {PROVIDER_NAMES[b.provider]}
                  {b.channelDisplayName ? ` · ${b.channelDisplayName}` : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {b.status === "scheduled" && b.scheduledAt
                  ? t("broadcasts.scheduledFor", {
                      when: formatDateTime(b.scheduledAt, locale),
                    })
                  : b.completedAt
                    ? t("broadcasts.sentAt", {
                        when: formatDateTime(b.completedAt, locale),
                      })
                    : b.startedAt
                      ? t("broadcasts.startedAt", {
                          when: formatDateTime(b.startedAt, locale),
                        })
                      : formatDateTime(b.createdAt, locale)}
                {b.stats.total > 0
                  ? ` · ${t("broadcasts.statsSummary", {
                      sent: b.stats.sent + b.stats.delivered + b.stats.read,
                      failed: b.stats.failed,
                      skipped: b.stats.skipped,
                      total: b.stats.total,
                    })}`
                  : ""}
              </p>
              {b.status === "failed" && b.errorCode ? (
                <p className="mt-1 text-xs text-danger">
                  {t("broadcasts.dispatchErrorLabel")}:{" "}
                  {DISPATCH_ERROR_LABEL_KEYS[b.errorCode]
                    ? t(DISPATCH_ERROR_LABEL_KEYS[b.errorCode])
                    : b.errorCode}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: "detail", id: b.id })}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                >
                  {t("broadcasts.viewRecipients")}
                </button>
                {canManage && b.status === "draft" ? (
                  <>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() =>
                        setView({ kind: "form", target: b })
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      {t("broadcasts.editAction")}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => void act(b, "send-now")}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {t("broadcasts.sendNowAction")}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => void act(b, "delete")}
                      className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                    >
                      {confirming === `delete:${b.id}`
                        ? t("broadcasts.confirmDelete")
                        : t("broadcasts.deleteAction")}
                    </button>
                  </>
                ) : null}
                {canManage &&
                (b.status === "scheduled" || b.status === "sending") ? (
                  <button
                    type="button"
                    disabled={busyId === b.id}
                    onClick={() => void act(b, "cancel")}
                    className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                  >
                    {confirming === `cancel:${b.id}`
                      ? t("broadcasts.confirmCancel")
                      : t("broadcasts.cancelBroadcastAction")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {loadingMore ? t("broadcasts.loadingMore") : t("broadcasts.loadMore")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface BroadcastFormProps {
  t: Translate;
  tenantId: string | null;
  target: "create" | BroadcastResponse;
  onDone: () => void;
  onCancel: () => void;
}

function BroadcastForm({ t, tenantId, target, onDone, onCancel }: BroadcastFormProps) {
  const editing = target !== "create" ? target : null;
  const [channels, setChannels] = useState<ChannelAccountResponse[]>([]);
  const [name, setName] = useState(editing?.name ?? "");
  const [channelAccountId, setChannelAccountId] = useState(
    editing?.channelAccountId ?? "",
  );
  const [messageText, setMessageText] = useState(editing?.messageText ?? "");
  const [tagsText, setTagsText] = useState(
    editing?.audienceFilter.tags?.join(", ") ?? "",
  );
  const [stagesText, setStagesText] = useState(
    editing?.audienceFilter.stages?.join(", ") ?? "",
  );
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [estimate, setEstimate] =
    useState<BroadcastAudienceEstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimateSeq = useRef(0);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api.channels
      .list(tenantId)
      .then((list) => {
        if (cancelled) return;
        const usable = list;
        setChannels(usable);
        if (!editing) {
          const first = usable.find(
            (ch) =>
              SUPPORTED_PROVIDERS.has(ch.provider) && ch.status === "connected",
          );
          if (first) setChannelAccountId((prev) => prev || first.id);
        }
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const selectedChannel = channels.find((ch) => ch.id === channelAccountId);
  const isMeta =
    selectedChannel?.provider === "messenger" ||
    selectedChannel?.provider === "instagram";

  // Estimasi audiens live (debounce 400ms) mengikuti channel + filter.
  useEffect(() => {
    if (!tenantId || !channelAccountId) {
      setEstimate(null);
      return;
    }
    const seq = ++estimateSeq.current;
    setEstimateLoading(true);
    const timer = setTimeout(() => {
      api.broadcasts
        .estimateAudience(tenantId, {
          channelAccountId,
          tags: splitCommaList(tagsText)?.join(","),
          stages: splitCommaList(stagesText)?.join(","),
        })
        .then((res) => {
          if (estimateSeq.current === seq) setEstimate(res);
        })
        .catch(() => {
          if (estimateSeq.current === seq) setEstimate(null);
        })
        .finally(() => {
          if (estimateSeq.current === seq) setEstimateLoading(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [tenantId, channelAccountId, tagsText, stagesText]);

  const buildInput = () => ({
    name: name.trim(),
    channelAccountId,
    messageText: messageText.trim(),
    audienceFilter: {
      tags: splitCommaList(tagsText),
      stages: splitCommaList(stagesText),
    },
  });

  const save = async (andSchedule: boolean) => {
    if (!tenantId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = buildInput();
      const saved = editing
        ? await api.broadcasts.update(tenantId, editing.id, input)
        : await api.broadcasts.create(tenantId, input);
      if (andSchedule) {
        await api.broadcasts.schedule(tenantId, saved.id, {
          scheduledAt:
            when === "schedule" && scheduledAtLocal
              ? new Date(scheduledAtLocal).toISOString()
              : undefined,
        });
      }
      onDone();
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink";
  const labelClass = "block text-sm font-medium text-ink";

  return (
    <section>
      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-muted hover:text-ink"
      >
        ← {t("broadcasts.backToList")}
      </button>
      <h1 className="mt-2 text-2xl font-bold text-ink">
        {editing ? t("broadcasts.formEditTitle") : t("broadcasts.formCreateTitle")}
      </h1>

      {error ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-6 max-w-2xl space-y-5">
        <div>
          <label className={labelClass} htmlFor="bc-name">
            {t("broadcasts.nameLabel")}
          </label>
          <input
            id="bc-name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("broadcasts.namePlaceholder")}
            maxLength={200}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="bc-channel">
            {t("broadcasts.channelLabel")}
          </label>
          <select
            id="bc-channel"
            className={inputClass}
            value={channelAccountId}
            onChange={(e) => setChannelAccountId(e.target.value)}
          >
            <option value="">—</option>
            {channels.map((ch) => {
              const supported = SUPPORTED_PROVIDERS.has(ch.provider);
              const disabled = !supported || ch.status !== "connected";
              return (
                <option key={ch.id} value={ch.id} disabled={disabled}>
                  {PROVIDER_NAMES[ch.provider]}
                  {ch.displayName ? ` · ${ch.displayName}` : ""}
                  {!supported
                    ? ` — ${ch.provider === "whatsapp" ? t("broadcasts.channelWhatsappUnsupported") : t("broadcasts.channelWebchatUnsupported")}`
                    : ch.status !== "connected"
                      ? ` — ${t("broadcasts.channelDisconnected")}`
                      : ""}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-muted">
            {t("broadcasts.channelWhatsappUnsupported")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t("broadcasts.channelWebchatUnsupported")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="bc-tags">
              {t("broadcasts.tagsLabel")}
            </label>
            <input
              id="bc-tags"
              className={inputClass}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder={t("broadcasts.tagsPlaceholder")}
            />
            <p className="mt-1 text-xs text-muted">{t("broadcasts.tagsHint")}</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="bc-stages">
              {t("broadcasts.stagesLabel")}
            </label>
            <input
              id="bc-stages"
              className={inputClass}
              value={stagesText}
              onChange={(e) => setStagesText(e.target.value)}
              placeholder={t("broadcasts.stagesPlaceholder")}
            />
            <p className="mt-1 text-xs text-muted">
              {t("broadcasts.stagesHint")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-ink">
            {t("broadcasts.estimateTitle")}
          </p>
          {estimateLoading ? (
            <p className="mt-1 text-sm text-muted">
              {t("broadcasts.estimateLoading")}
            </p>
          ) : estimate ? (
            <div className="mt-1 space-y-0.5 text-sm text-muted">
              <p className="font-medium text-ink">
                {t("broadcasts.estimateMatched", { count: estimate.matched })}
              </p>
              <p>
                {t("broadcasts.estimateOptedOut", { count: estimate.optedOut })}
              </p>
              <p>
                {t("broadcasts.estimateTotal", {
                  count: estimate.totalWithIdentity,
                })}
              </p>
              {isMeta ? (
                <p>{t("broadcasts.estimateWindowNote")}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">—</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="bc-message">
            {t("broadcasts.messageLabel")}
          </label>
          <textarea
            id="bc-message"
            className={inputClass}
            rows={5}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder={t("broadcasts.messagePlaceholder")}
            maxLength={4096}
          />
          <p className="mt-1 text-xs text-muted">
            {t("broadcasts.messageHint")}
          </p>
        </div>

        <fieldset>
          <legend className={labelClass}>{t("broadcasts.whenLabel")}</legend>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="bc-when"
                checked={when === "now"}
                onChange={() => setWhen("now")}
              />
              {t("broadcasts.whenNow")}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="bc-when"
                checked={when === "schedule"}
                onChange={() => setWhen("schedule")}
              />
              {t("broadcasts.whenSchedule")}
            </label>
            {when === "schedule" ? (
              <input
                type="datetime-local"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
                aria-label={t("broadcasts.scheduleAtLabel")}
              />
            ) : null}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2 pb-8">
          <button
            type="button"
            disabled={saving || !name.trim() || !channelAccountId || !messageText.trim()}
            onClick={() => void save(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {t("broadcasts.createAndSchedule")}
          </button>
          <button
            type="button"
            disabled={saving || !name.trim() || !channelAccountId || !messageText.trim()}
            onClick={() => void save(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {editing ? t("broadcasts.saveChanges") : t("broadcasts.saveDraft")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-muted hover:text-ink disabled:opacity-50"
          >
            {t("broadcasts.cancel")}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface BroadcastDetailProps {
  t: Translate;
  locale: Locale;
  tenantId: string | null;
  broadcastId: string;
  onBack: () => void;
}

function BroadcastDetail({ t, locale, tenantId, broadcastId, onBack }: BroadcastDetailProps) {
  const [broadcast, setBroadcast] = useState<BroadcastResponse | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipientResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!tenantId) return;
      if (!silent) setLoading(true);
      try {
        const [detail, page] = await Promise.all([
          api.broadcasts.get(tenantId, broadcastId),
          api.broadcasts.listRecipients(tenantId, broadcastId, { limit: 50 }),
        ]);
        setBroadcast(detail);
        setRecipients(page.recipients);
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (!silent) setError(translateApiError(t, err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantId, broadcastId, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(
    () => {
      void load(true);
    },
    5000,
    broadcast?.status === "sending",
  );

  const loadMore = async () => {
    if (!tenantId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.broadcasts.listRecipients(tenantId, broadcastId, {
        limit: 50,
        cursor: nextCursor,
      });
      setRecipients((prev) => [...prev, ...page.recipients]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setLoadingMore(false);
    }
  };

  const statCells: { key: string; labelKey: TranslationKey; value: number }[] =
    broadcast
      ? [
          { key: "total", labelKey: "broadcasts.statTotal", value: broadcast.stats.total },
          { key: "queued", labelKey: "broadcasts.statQueued", value: broadcast.stats.queued },
          { key: "sent", labelKey: "broadcasts.statSent", value: broadcast.stats.sent },
          { key: "delivered", labelKey: "broadcasts.statDelivered", value: broadcast.stats.delivered },
          { key: "read", labelKey: "broadcasts.statRead", value: broadcast.stats.read },
          { key: "failed", labelKey: "broadcasts.statFailed", value: broadcast.stats.failed },
          { key: "skipped", labelKey: "broadcasts.statSkipped", value: broadcast.stats.skipped },
          { key: "cancelled", labelKey: "broadcasts.statCancelled", value: broadcast.stats.cancelled },
        ]
      : [];

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted hover:text-ink"
      >
        ← {t("broadcasts.backToList")}
      </button>

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      ) : error || !broadcast ? (
        <p className="mt-6 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error ?? t("errors.NOT_FOUND")}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">{broadcast.name}</h1>
            <StatusChip t={t} status={broadcast.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {PROVIDER_NAMES[broadcast.provider]}
            {broadcast.channelDisplayName
              ? ` · ${broadcast.channelDisplayName}`
              : ""}
            {" · "}
            {broadcast.scheduledAt
              ? t("broadcasts.scheduledFor", {
                  when: formatDateTime(broadcast.scheduledAt, locale),
                })
              : formatDateTime(broadcast.createdAt, locale)}
          </p>
          <p className="mt-3 max-w-2xl whitespace-pre-wrap rounded-xl border border-border bg-surface p-4 text-sm text-ink">
            {broadcast.messageText}
          </p>
          {broadcast.status === "failed" && broadcast.errorCode ? (
            <p className="mt-2 text-sm text-danger">
              {t("broadcasts.dispatchErrorLabel")}:{" "}
              {DISPATCH_ERROR_LABEL_KEYS[broadcast.errorCode]
                ? t(DISPATCH_ERROR_LABEL_KEYS[broadcast.errorCode])
                : broadcast.errorCode}
            </p>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {statCells.map((cell) => (
              <div
                key={cell.key}
                className="rounded-xl border border-border bg-surface p-3 text-center"
              >
                <p className="text-xl font-bold text-ink">{cell.value}</p>
                <p className="text-xs text-muted">{t(cell.labelKey)}</p>
              </div>
            ))}
          </div>

          <h2 className="mt-6 text-lg font-semibold text-ink">
            {t("broadcasts.recipientsTitle")}
          </h2>
          {recipients.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("broadcasts.recipientsEmpty")}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {recipients.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <span className="text-sm font-medium text-ink">
                    {r.contactName}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {r.status === "skipped" && r.skipReason ? (
                      <span>
                        {SKIP_REASON_LABEL_KEYS[r.skipReason]
                          ? t(SKIP_REASON_LABEL_KEYS[r.skipReason])
                          : r.skipReason}
                      </span>
                    ) : null}
                    {r.status === "failed" && r.errorCode ? (
                      <span className="text-danger">
                        {t("broadcasts.errorCodeLabel")}: {r.errorCode}
                      </span>
                    ) : null}
                    <span className="font-medium text-ink">
                      {RECIPIENT_STATUS_LABEL_KEYS[r.status]
                        ? t(RECIPIENT_STATUS_LABEL_KEYS[r.status])
                        : r.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {nextCursor ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                {loadingMore
                  ? t("broadcasts.loadingMore")
                  : t("broadcasts.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
