import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  API_KEY_SCOPES,
  type ApiKeyResponse,
  type ApiKeyScope,
  type CreatedApiKeyResponse,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { formatDateTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface SettingsPageProps {
  t: Translate;
  locale: Locale;
}

const SCOPE_LABEL_KEYS: Record<ApiKeyScope, TranslationKey> = {
  "contacts:read": "settings.scopeContactsRead",
  "contacts:write": "settings.scopeContactsWrite",
  "conversations:read": "settings.scopeConversationsRead",
  "messages:write": "settings.scopeMessagesWrite",
  "products:read": "settings.scopeProductsRead",
};

/** Scope read tercentang secara bawaan di form (selaras default API). */
const DEFAULT_SCOPES: ApiKeyScope[] = [
  "contacts:read",
  "conversations:read",
  "products:read",
];

/**
 * Halaman Settings (Fase 5A) — untuk sekarang berisi bagian API Keys
 * (bagian pengaturan lain menyusul; disampaikan apa adanya di intro):
 * daftar kunci workspace aktif (nama, awalan, chip scope, status,
 * terakhir dipakai), form buat (nama + centang scope), modal hasil
 * pembuatan yang menampilkan kunci UTUH satu kali dengan tombol salin
 * dan peringatan, serta cabut dengan konfirmasi. Membuat/mencabut hanya
 * untuk owner/admin — server menegakkan (403), UI memberi catatan.
 */
export function SettingsPage({ t, locale }: SettingsPageProps) {
  const { active } = useWorkspace();
  const tenantId = active?.id ?? null;
  const canManage = active?.role === "owner" || active?.role === "admin";

  const [keys, setKeys] = useState<ApiKeyResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKeyResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyResponse | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.apiKeys.list(tenantId);
      if (requestSeq.current !== seq) return;
      setKeys(list);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
      setKeys([]);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-xl font-bold text-ink">{t("nav.settings")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("settings.intro")}</p>

      <section className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {t("settings.apiKeysTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              {t("settings.apiKeysBody")}
            </p>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
            >
              {t("settings.addButton")}
            </button>
          ) : null}
        </div>

        {!canManage ? (
          <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm text-muted">
            {t("settings.adminOnlyNote")}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-4 text-sm text-muted">{t("common.loading")}</p>
        ) : keys.length === 0 && !error ? (
          <div className="mt-4 rounded-xl bg-surface p-5">
            <div className="font-semibold text-ink">{t("settings.emptyTitle")}</div>
            <p className="mt-1 text-sm text-muted">{t("settings.emptyBody")}</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {keys.map((key) => {
              const revoked = key.revokedAt !== null;
              return (
                <li key={key.id} className="rounded-xl bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{key.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        revoked
                          ? "bg-elevated text-muted"
                          : "bg-accent/15 text-accent"
                      }`}
                    >
                      {revoked
                        ? t("settings.statusRevoked")
                        : t("settings.statusActive")}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {t("settings.prefixLabel")}: {key.keyPrefix}…
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full bg-elevated px-2 py-0.5 text-xs text-ink"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    {t("settings.createdLabel", {
                      date: formatDateTime(key.createdAt, locale),
                    })}
                    {" · "}
                    {key.lastUsedAt
                      ? t("settings.lastUsedLabel", {
                          date: formatDateTime(key.lastUsedAt, locale),
                        })
                      : t("settings.neverUsed")}
                  </div>
                  {canManage && !revoked ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(key)}
                        className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-red-600"
                      >
                        {t("settings.revokeButton")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {formOpen && tenantId ? (
        <CreateApiKeyModal
          t={t}
          tenantId={tenantId}
          onClose={() => setFormOpen(false)}
          onCreated={(createdKey) => {
            setFormOpen(false);
            setCreated(createdKey);
            void load();
          }}
        />
      ) : null}

      {created ? (
        <CreatedApiKeyModal
          t={t}
          created={created}
          onClose={() => setCreated(null)}
        />
      ) : null}

      {revokeTarget && tenantId ? (
        <RevokeApiKeyModal
          t={t}
          tenantId={tenantId}
          target={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateApiKeyModal({
  t,
  tenantId,
  onClose,
  onCreated,
}: {
  t: Translate;
  tenantId: string;
  onClose: () => void;
  onCreated: (created: CreatedApiKeyResponse) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(DEFAULT_SCOPES);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleScope = (scope: ApiKeyScope, checked: boolean) => {
    setScopes((prev) =>
      checked ? [...prev, scope] : prev.filter((s) => s !== scope),
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t("settings.nameRequired"));
      return;
    }
    setNameError(null);
    setError(null);
    setSubmitting(true);
    try {
      const createdKey = await api.apiKeys.create(tenantId, {
        name: name.trim(),
        scopes,
      });
      onCreated(createdKey);
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
          <h2 className="text-lg font-bold text-ink">{t("settings.addTitle")}</h2>
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
              {t("settings.nameLabel")} *
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.namePlaceholder")}
              className={inputClassName}
            />
          </label>
          <FieldError message={nameError} />
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">
              {t("settings.scopesLabel")}
            </legend>
            <p className="mb-2 text-xs text-muted">{t("settings.scopesHint")}</p>
            <div className="space-y-2">
              {API_KEY_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) => toggleScope(scope, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>
                    {t(SCOPE_LABEL_KEYS[scope])}{" "}
                    <span className="font-mono text-xs text-muted">({scope})</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <FieldError message={error} />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? t("settings.saving") : t("settings.createButton")}
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

function CreatedApiKeyModal({
  t,
  created,
  onClose,
}: {
  t: Translate;
  created: CreatedApiKeyResponse;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <h2 className="text-lg font-bold text-ink">{t("settings.createdTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.createdBody")}</p>
        <div className="mt-3 break-all rounded-lg bg-elevated p-3 font-mono text-sm text-ink">
          {created.key}
        </div>
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-red-600">
          {t("settings.createdWarning")}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            {copied ? t("settings.copiedLabel") : t("settings.copyButton")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("settings.doneButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RevokeApiKeyModal({
  t,
  tenantId,
  target,
  onClose,
  onRevoked,
}: {
  t: Translate;
  tenantId: string;
  target: ApiKeyResponse;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRevoke = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.apiKeys.revoke(tenantId, target.id);
      onRevoked();
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
        <h2 className="text-lg font-bold text-ink">{t("settings.revokeTitle")}</h2>
        <p className="mt-2 text-sm text-muted">
          {t("settings.revokeBody", { name: target.name })}
        </p>
        <FieldError message={error} />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleRevoke}
            disabled={submitting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? t("settings.revoking") : t("settings.revokeButton")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
