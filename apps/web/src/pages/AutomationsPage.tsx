import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  AutomationMatch,
  AutomationResponse,
  AutomationRunResponse,
} from "@sahabat-kreator/contracts";
import {
  formatNumber,
  type Locale,
  type TranslationKey,
} from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { formatDateTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

interface AutomationsPageProps {
  t: Translate;
  locale: Locale;
}

/**
 * Halaman Automations (Fase 2B): pengelolaan automation keyword workspace
 * aktif lewat API 2A — daftar + sakelar aktif, form buat/edit, dan riwayat
 * eksekusi (runs). Semua teks lewat i18n; tanggal lewat Intl.
 */
export function AutomationsPage({ t, locale }: AutomationsPageProps) {
  const { status, tenants, active, reload } = useWorkspace();
  const tenantId = active?.id ?? null;

  const [items, setItems] = useState<AutomationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<
    "create" | AutomationResponse | null
  >(null);
  const [runsTarget, setRunsTarget] = useState<AutomationResponse | null>(
    null,
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.automations.list(tenantId);
      if (requestSeq.current !== seq) return;
      setItems(list);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
      setItems([]);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (automation: AutomationResponse) => {
    if (!tenantId || togglingId) return;
    const next = !automation.isActive;
    // Optimistis: ubah tampilan dulu, kembalikan bila server menolak.
    setItems((prev) =>
      prev.map((a) => (a.id === automation.id ? { ...a, isActive: next } : a)),
    );
    setTogglingId(automation.id);
    try {
      const updated = await api.automations.update(tenantId, automation.id, {
        isActive: next,
      });
      setItems((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((a) =>
          a.id === automation.id ? { ...a, isActive: automation.isActive } : a,
        ),
      );
      setError(translateApiError(t, err));
      void load();
    } finally {
      setTogglingId(null);
    }
  };

  if (status === "loading") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("automations.title")}</h1>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("automations.title")}</h1>
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
        <h1 className="text-2xl font-bold text-ink">{t("automations.title")}</h1>
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">{t("workspace.emptyTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{t("workspace.emptyBody")}</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("automations.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("automations.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormTarget("create")}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          {t("automations.addButton")}
        </button>
      </div>

      <FieldError message={error} />

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-base font-semibold text-ink">
            {t("automations.emptyTitle")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("automations.emptyBody")}
          </p>
          <button
            type="button"
            onClick={() => setFormTarget("create")}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            {t("automations.addButton")}
          </button>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {items.map((automation) => (
            <li
              key={automation.id}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  onClick={() => setRunsTarget(automation)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-ink">
                    {automation.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {t(
                      automation.match === "exact"
                        ? "automations.matchExact"
                        : "automations.matchContains",
                    )}
                    {" · "}
                    {t("automations.runsLabel", {
                      count: formatNumber(automation.runCount, locale),
                    })}
                    {" · "}
                    {t("automations.createdLabel", {
                      date: formatDateTime(automation.createdAt, locale),
                    })}
                  </span>
                </button>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    automation.isActive
                      ? "bg-accent/10 text-accent"
                      : "bg-elevated text-muted"
                  }`}
                >
                  {automation.isActive
                    ? t("automations.statusActive")
                    : t("automations.statusInactive")}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={automation.isActive}
                  aria-label={automation.name}
                  disabled={togglingId === automation.id}
                  onClick={() => void handleToggle(automation)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                    automation.isActive ? "bg-accent" : "bg-elevated"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      automation.isActive ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
              {automation.keywords.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {automation.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 line-clamp-2 text-sm text-muted">
                {automation.text}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setRunsTarget(automation)}
                  className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-ink"
                >
                  {t("automations.historyButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setFormTarget(automation)}
                  className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-ink"
                >
                  {t("common.edit")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formTarget ? (
        <AutomationFormModal
          t={t}
          tenantId={active.id}
          automation={formTarget === "create" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={(saved) => {
            setFormTarget(null);
            setItems((prev) => {
              const exists = prev.some((a) => a.id === saved.id);
              return exists
                ? prev.map((a) => (a.id === saved.id ? saved : a))
                : [saved, ...prev];
            });
          }}
        />
      ) : null}

      {runsTarget ? (
        <RunsModal
          t={t}
          locale={locale}
          tenantId={active.id}
          automation={runsTarget}
          onClose={() => setRunsTarget(null)}
        />
      ) : null}
    </section>
  );
}

function AutomationFormModal({
  t,
  tenantId,
  automation,
  onClose,
  onSaved,
}: {
  t: Translate;
  tenantId: string;
  automation: AutomationResponse | null;
  onClose: () => void;
  onSaved: (automation: AutomationResponse) => void;
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [keywords, setKeywords] = useState(
    automation ? automation.keywords.join(", ") : "",
  );
  const [match, setMatch] = useState<AutomationMatch>(
    automation?.match ?? "exact",
  );
  const [text, setText] = useState(automation?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return setError(t("automations.nameRequired"));
    const parsedKeywords = parseKeywords(keywords);
    if (parsedKeywords.length === 0)
      return setError(t("automations.keywordsRequired"));
    if (parsedKeywords.length > 10)
      return setError(t("automations.keywordsTooMany"));
    if (!text.trim()) return setError(t("automations.textRequired"));
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        keywords: parsedKeywords,
        match,
        text: text.trim(),
      };
      const saved = automation
        ? await api.automations.update(tenantId, automation.id, payload)
        : await api.automations.create(tenantId, payload);
      onSaved(saved);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">
            {automation
              ? t("automations.editTitle")
              : t("automations.addTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("automations.nameLabel")} *
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("automations.namePlaceholder")}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("automations.keywordsLabel")} *
            </span>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("automations.keywordsPlaceholder")}
              className={inputClassName}
            />
            <span className="mt-1 block text-[11px] text-muted">
              {t("automations.keywordsHint")}
            </span>
          </label>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">
              {t("automations.matchLabel")}
            </legend>
            <div className="space-y-2">
              {(["exact", "contains"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface p-3"
                >
                  <input
                    type="radio"
                    name="automation-match"
                    value={value}
                    checked={match === value}
                    onChange={() => setMatch(value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      {t(
                        value === "exact"
                          ? "automations.matchExact"
                          : "automations.matchContains",
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {t(
                        value === "exact"
                          ? "automations.matchExactHint"
                          : "automations.matchContainsHint",
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("automations.textLabel")} *
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("automations.textPlaceholder")}
              rows={4}
              className={inputClassName}
            />
            <span className="mt-1 block text-[11px] text-muted">
              {t("automations.textHint")}
            </span>
          </label>
          <FieldError message={error} />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting
                ? automation
                  ? t("automations.saving")
                  : t("automations.creating")
                : automation
                  ? t("automations.saveChanges")
                  : t("automations.createButton")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RunsModal({
  t,
  locale,
  tenantId,
  automation,
  onClose,
}: {
  t: Translate;
  locale: Locale;
  tenantId: string;
  automation: AutomationResponse;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AutomationRunResponse[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.automations.listRuns(tenantId, automation.id);
        if (cancelled) return;
        setRuns(list);
        // Nama kontak bersifat pelengkap: ambil per kontak unik, abaikan gagal.
        const uniqueContactIds = [...new Set(list.map((r) => r.contactId))];
        const names: Record<string, string> = {};
        await Promise.all(
          uniqueContactIds.map(async (contactId) => {
            try {
              const contact = await api.contacts.get(tenantId, contactId);
              names[contactId] = contact.name;
            } catch {
              // biarkan fallback ke ID ringkas
            }
          }),
        );
        if (!cancelled) setContactNames(names);
      } catch (err) {
        if (!cancelled) setError(translateApiError(t, err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, automation.id, t]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">
              {t("automations.runsTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{automation.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-muted">{t("common.loading")}</p>
        ) : error ? (
          <p className="mt-4 text-sm text-danger">
            {t("automations.runsLoadError")} {error}
          </p>
        ) : runs.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("automations.runsEmpty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {runs.map((run) => (
              <li key={run.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      run.status === "completed"
                        ? "bg-accent/10 text-accent"
                        : run.status === "failed"
                          ? "bg-elevated text-danger"
                          : "bg-elevated text-muted"
                    }`}
                  >
                    {t(
                      `automations.runStatus.${run.status}` as TranslationKey,
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDateTime(run.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {t("automations.runContactLabel")}:{" "}
                  {contactNames[run.contactId] ?? shortId(run.contactId)}
                </p>
                <p className="text-xs text-muted">
                  {t("automations.runConversationLabel")}:{" "}
                  {shortId(run.conversationId)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
