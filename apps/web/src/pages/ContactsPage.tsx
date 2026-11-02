import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  ContactDuplicatesResponse,
  ContactResponse,
  OptInStatus,
} from "@sahabat-kreator/contracts";
import {
  formatNumber,
  type Locale,
  type TranslationKey,
} from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { Avatar } from "../components/Avatar";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

const PAGE_SIZE = 20;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KNOWN_STAGES = ["new", "contacted", "qualified", "customer", "lost"] as const;
const OPT_IN_VALUES: OptInStatus[] = ["unknown", "opted_in", "opted_out"];

function stageLabel(t: Translate, stage: string): string {
  return (KNOWN_STAGES as readonly string[]).includes(stage)
    ? t(`contacts.stages.${stage}` as TranslationKey)
    : stage;
}

function optInLabel(t: Translate, status: OptInStatus): string {
  return t(`contacts.optIn.${status}` as TranslationKey);
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface ContactsPageProps {
  t: Translate;
  locale: Locale;
}

/**
 * Halaman Kontak (Fase 1E): daftar kontak workspace aktif dari API 1D —
 * pencarian server-side (?search=), pagination offset ("Muat lebih banyak"),
 * tambah kontak, dan detail/edit (nama, tags, pipeline stage, opt-in) via PATCH.
 */
export function ContactsPage({ t, locale }: ContactsPageProps) {
  const { status, tenants, active, reload } = useWorkspace();
  const tenantId = active?.id ?? null;

  const [items, setItems] = useState<ContactResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<ContactResponse | null>(null);
  const requestSeq = useRef(0);

  // Kandidat duplikat (Fase 9B): dimuat terpisah dari daftar utama;
  // seksinya hanya tampil bila ada kandidat.
  const [dupGroups, setDupGroups] = useState<
    ContactDuplicatesResponse["groups"]
  >([]);
  const [dupError, setDupError] = useState<string | null>(null);
  const [mergePair, setMergePair] = useState<{
    survivor: ContactResponse;
    merged: ContactResponse;
  } | null>(null);
  const [merging, setMerging] = useState(false);
  const canMerge = active?.role === "owner" || active?.role === "admin";

  const loadDuplicates = useCallback(async () => {
    if (!tenantId) return;
    try {
      const body = await api.contacts.duplicates(tenantId);
      setDupGroups(body.groups);
      setDupError(null);
    } catch {
      // Kegagalan memuat kandidat tidak boleh menghalangi daftar utama.
      setDupError(t("contacts.duplicates.loadError"));
    }
  }, [tenantId, t]);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  const confirmMerge = async () => {
    if (!tenantId || !mergePair) return;
    setMerging(true);
    try {
      await api.contacts.merge(tenantId, mergePair.survivor.id, mergePair.merged.id);
      setMergePair(null);
      await Promise.all([loadFirst(), loadDuplicates()]);
    } catch (err) {
      setError(translateApiError(t, err));
      setMergePair(null);
    } finally {
      setMerging(false);
    }
  };

  // Debounce kolom pencarian → query `search` API.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFirst = useCallback(async () => {
    if (!tenantId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const body = await api.contacts.list(tenantId, {
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (requestSeq.current !== seq) return;
      setItems(body.contacts);
      setTotal(body.total);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
      setItems([]);
      setTotal(0);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [tenantId, search, t]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!tenantId || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const body = await api.contacts.list(tenantId, {
        search: search || undefined,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      setItems((prev) => [...prev, ...body.contacts]);
      setTotal(body.total);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === "loading") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("contacts.title")}</h1>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("contacts.title")}</h1>
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
        <h1 className="text-2xl font-bold text-ink">{t("contacts.title")}</h1>
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
          <h1 className="text-2xl font-bold text-ink">{t("contacts.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("contacts.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          {t("contacts.addButton")}
        </button>
      </div>

      {showForm ? (
        <CreateContactForm
          t={t}
          tenantId={active.id}
          onCancel={() => setShowForm(false)}
          onCreated={(contact) => {
            setShowForm(false);
            setItems((prev) => [contact, ...prev]);
            setTotal((prev) => prev + 1);
            void loadDuplicates();
          }}
        />
      ) : null}

      {dupError ? (
        <p className="mt-4 text-xs text-danger">{dupError}</p>
      ) : null}

      {dupGroups.length > 0 ? (
        <div className="mt-5 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("contacts.duplicates.title")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("contacts.duplicates.subtitle")}
          </p>
          {!canMerge ? (
            <p className="mt-2 text-xs text-muted">
              {t("contacts.duplicates.forbiddenNote")}
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {dupGroups.map((group, gi) => {
              const [survivor, ...others] = group.contacts;
              if (!survivor) return null;
              return (
                <div
                  key={gi}
                  className="rounded-lg border border-line bg-elevated/40 p-3"
                >
                  <div className="flex flex-wrap gap-1">
                    {group.reasons.map((reason, ri) => (
                      <span
                        key={ri}
                        className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent"
                      >
                        {reason.type === "phone"
                          ? t("contacts.duplicates.reasonPhone")
                          : reason.type === "email"
                            ? t("contacts.duplicates.reasonEmail")
                            : t("contacts.duplicates.reasonIdentity", {
                                provider:
                                  reason.value.split(":")[0] ?? reason.value,
                              })}
                        {reason.type !== "channel_identity"
                          ? `: ${reason.value}`
                          : ""}
                      </span>
                    ))}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {group.contacts.map((contact) => {
                      const isSurvivor = contact.id === survivor.id;
                      return (
                        <li
                          key={contact.id}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <Avatar
                            name={contact.name}
                            imageUrl={contact.avatarUrl}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink">
                              {contact.name}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {[contact.phone, contact.email]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>
                          {isSurvivor ? (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                              {t("contacts.duplicates.keptLabel")}
                            </span>
                          ) : canMerge ? (
                            <button
                              type="button"
                              onClick={() =>
                                setMergePair({ survivor, merged: contact })
                              }
                              className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-semibold text-ink"
                            >
                              {t("contacts.duplicates.mergeButton")}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="min-w-52 flex-1">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("contacts.searchPlaceholder")}
            aria-label={t("common.search")}
            className={inputClassName}
          />
        </div>
        <span className="text-sm text-muted">
          {t("contacts.totalLabel", { count: formatNumber(total, locale) })}
        </span>
        <button
          type="button"
          onClick={() => void loadFirst()}
          className="rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-ink"
        >
          {t("common.reload")}
        </button>
      </div>

      <FieldError message={error} />

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-base font-semibold text-ink">
            {search ? t("contacts.emptySearchTitle") : t("contacts.emptyTitle")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {search ? t("contacts.emptySearchBody") : t("contacts.emptyBody")}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => setSelected(contact)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elevated"
                >
                  <Avatar name={contact.name} imageUrl={contact.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {contact.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[contact.phone, contact.email]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    {contact.tags.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                    {stageLabel(t, contact.pipelineStage)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {items.length < total ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                {loadingMore ? t("common.loading") : t("common.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}

      {selected ? (
        <ContactDetailModal
          t={t}
          tenantId={active.id}
          contact={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setItems((prev) =>
              prev.map((c) => (c.id === updated.id ? updated : c)),
            );
            setSelected(updated);
          }}
        />
      ) : null}

      {mergePair ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">
              {t("contacts.duplicates.confirmTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {t("contacts.duplicates.confirmBody", {
                merged: mergePair.merged.name,
                survivor: mergePair.survivor.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMergePair(null)}
                disabled={merging}
                className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void confirmMerge()}
                disabled={merging}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {merging
                  ? t("contacts.duplicates.merging")
                  : t("contacts.duplicates.confirmButton")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CreateContactForm({
  t,
  tenantId,
  onCancel,
  onCreated,
}: {
  t: Translate;
  tenantId: string;
  onCancel: () => void;
  onCreated: (contact: ContactResponse) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return setError(t("contacts.nameRequired"));
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail))
      return setError(t("auth.emailInvalid"));
    setError(null);
    setSubmitting(true);
    try {
      const parsedTags = parseTags(tags);
      const contact = await api.contacts.create(tenantId, {
        name: trimmedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(parsedTags.length ? { tags: parsedTags } : {}),
      });
      onCreated(contact);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 rounded-xl border border-line bg-surface p-4"
    >
      <h2 className="text-base font-semibold text-ink">{t("contacts.addTitle")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">
            {t("contacts.nameLabel")} *
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("contacts.namePlaceholder")}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">
            {t("contacts.phoneLabel")}
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("contacts.phonePlaceholder")}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">
            {t("contacts.emailLabel")}
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("contacts.emailPlaceholder")}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">
            {t("contacts.tagsLabel")}
          </span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("contacts.tagsPlaceholder")}
            className={inputClassName}
          />
          <span className="mt-1 block text-[11px] text-muted">
            {t("contacts.tagsHint")}
          </span>
        </label>
      </div>
      <FieldError message={error} />
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? t("contacts.creating") : t("contacts.createButton")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function ContactDetailModal({
  t,
  tenantId,
  contact,
  onClose,
  onUpdated,
}: {
  t: Translate;
  tenantId: string;
  contact: ContactResponse;
  onClose: () => void;
  onUpdated: (contact: ContactResponse) => void;
}) {
  const [name, setName] = useState(contact.name);
  const [tags, setTags] = useState(contact.tags.join(", "));
  const [stage, setStage] = useState(contact.pipelineStage);
  const [optIn, setOptIn] = useState<OptInStatus>(contact.optInStatus);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stageOptions = (KNOWN_STAGES as readonly string[]).includes(stage)
    ? [...KNOWN_STAGES]
    : [stage, ...KNOWN_STAGES];

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return setError(t("contacts.nameRequired"));
    setError(null);
    setSaving(true);
    try {
      const updated = await api.contacts.update(tenantId, contact.id, {
        name: trimmedName,
        tags: parseTags(tags),
        pipelineStage: stage,
        optInStatus: optIn,
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSaving(false);
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
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={contact.name} imageUrl={contact.avatarUrl} />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink">{t("contacts.detailTitle")}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {[contact.phone, contact.email].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("contacts.nameLabel")} *
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("contacts.tagsLabel")}
            </span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("contacts.tagsPlaceholder")}
              className={inputClassName}
            />
            <span className="mt-1 block text-[11px] text-muted">
              {t("contacts.tagsHint")}
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                {t("contacts.stageLabel")}
              </span>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className={inputClassName}
              >
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(t, s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                {t("contacts.optInLabel")}
              </span>
              <select
                value={optIn}
                onChange={(e) => setOptIn(e.target.value as OptInStatus)}
                className={inputClassName}
              >
                {OPT_IN_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {optInLabel(t, s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <FieldError message={error} />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? t("contacts.saving") : t("contacts.saveChanges")}
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
