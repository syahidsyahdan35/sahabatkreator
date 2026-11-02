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
  type InvitationResponse,
  type InvitableRole,
  type MemberRole,
  type TeamMemberResponse,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
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
  "comments:read": "settings.scopeCommentsRead",
  "comments:write": "settings.scopeCommentsWrite",
};

/** Scope read tercentang secara bawaan di form (selaras default API). */
const DEFAULT_SCOPES: ApiKeyScope[] = [
  "contacts:read",
  "conversations:read",
  "products:read",
];

/**
 * Halaman Settings — berisi seksi Akun (ganti password, Fase 13A), API
 * Keys (Fase 5A), dan Tim (Fase 9C):
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

      <ChangePasswordSection t={t} />

      <section className="mt-10">
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

      {/* Fase 9C: seksi Tim — member, peran, undangan */}
      {tenantId ? (
        <TeamSection t={t} locale={locale} tenantId={tenantId} canManage={canManage} />
      ) : null}

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

/**
 * Seksi ganti password (Fase 13A — menutup temuan 9A bahwa Settings
 * tidak punya form ini). Tingkat AKUN, bukan workspace: memakai
 * endpoint Better Auth `change-password` yang memverifikasi kata sandi
 * saat ini di server; klien tidak pernah membandingkan hash sendiri.
 * Validasi lokal hanya untuk umpan balik cepat (kosong / <8 karakter /
 * sama dengan saat ini / konfirmasi beda) — penegak akhirnya server
 * (INVALID_PASSWORD / PASSWORD_TOO_SHORT diterjemahkan dari kodenya).
 * Nilai kata sandi tidak pernah di-log atau disimpan di state selain
 * field form, dan form dikosongkan sesudah berhasil.
 */
function ChangePasswordSection({ t }: { t: Translate }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSuccess(false);
    if (!current || !next || !confirm) {
      setError(t("settings.passwordRequired"));
      return;
    }
    if (next.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }
    if (next === current) {
      setError(t("settings.passwordSameAsCurrent"));
      return;
    }
    if (next !== confirm) {
      setError(t("settings.passwordMismatch"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setSuccess(true);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-ink">
        {t("settings.passwordTitle")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {t("settings.passwordBody")}
      </p>
      <form onSubmit={submit} className="mt-4 max-w-md space-y-3">
        <div>
          <label
            htmlFor="settings-current-password"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("settings.passwordCurrentLabel")}
          </label>
          <PasswordInput
            t={t}
            id="settings-current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClassName}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label
            htmlFor="settings-new-password"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("settings.passwordNewLabel")}
          </label>
          <PasswordInput
            t={t}
            id="settings-new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClassName}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label
            htmlFor="settings-confirm-password"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("settings.passwordConfirmLabel")}
          </label>
          <PasswordInput
            t={t}
            id="settings-confirm-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClassName}
            autoComplete="new-password"
          />
        </div>
        <FieldError message={error} />
        {success ? (
          <p className="rounded-lg bg-elevated px-3 py-2 text-sm text-ink">
            {t("settings.passwordSuccess")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t("settings.passwordSaving") : t("settings.passwordSubmit")}
        </button>
      </form>
    </section>
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

/**
 * Seksi Tim (Fase 9C): daftar member + peran, undangan bertoken, ganti
 * peran, keluarkan member. Seluruh mutasi owner/admin (server
 * menegakkan; UI menyembunyikan kontrol untuk peran lain). Tautan
 * undangan ditampilkan SEKALI sesudah dibuat — server hanya menyimpan
 * hash tokennya, jadi panel "tautan siap" adalah satu-satunya tempat
 * tautan itu pernah terlihat; hilang → cabut & undang ulang.
 */
function roleLabelKey(role: MemberRole): TranslationKey {
  switch (role) {
    case "owner":
      return "settings.team.roleOwner";
    case "admin":
      return "settings.team.roleAdmin";
    case "agent":
      return "settings.team.roleAgent";
    case "viewer":
      return "settings.team.roleViewer";
  }
}

const INVITABLE_ROLES: InvitableRole[] = ["admin", "agent", "viewer"];

function TeamSection({
  t,
  locale,
  tenantId,
  canManage,
}: {
  t: Translate;
  locale: Locale;
  tenantId: string;
  canManage: boolean;
}) {
  const [members, setMembers] = useState<TeamMemberResponse[]>([]);
  const [invitations, setInvitations] = useState<InvitationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>("agent");
  const [inviting, setInviting] = useState(false);
  const [createdLink, setCreatedLink] = useState<{
    url: string;
    email: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberResponse | null>(
    null,
  );
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const memberRows = await api.team.listMembers(tenantId);
      if (requestSeq.current !== seq) return;
      setMembers(memberRows);
      if (canManage) {
        const invitationRows = await api.team.listInvitations(tenantId);
        if (requestSeq.current !== seq) return;
        setInvitations(invitationRows);
      }
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [tenantId, canManage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRoleChange = async (member: TeamMemberResponse, role: InvitableRole) => {
    setActionError(null);
    try {
      const updated = await api.team.updateMemberRole(tenantId, member.userId, role);
      setMembers((prev) =>
        prev.map((m) => (m.userId === updated.userId ? updated : m)),
      );
    } catch (err) {
      setActionError(translateApiError(t, err));
    }
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setActionError(null);
    try {
      const created = await api.team.invite(tenantId, inviteEmail.trim(), inviteRole);
      setCreatedLink({
        url: created.inviteUrl ?? "",
        email: created.email,
      });
      setCopied(false);
      setInviteEmail("");
      void load();
    } catch (err) {
      setActionError(translateApiError(t, err));
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (invitation: InvitationResponse) => {
    setActionError(null);
    try {
      await api.team.revokeInvitation(tenantId, invitation.id);
      void load();
    } catch (err) {
      setActionError(translateApiError(t, err));
    }
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold text-ink">{t("settings.team.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("settings.team.body")}</p>

      {!canManage ? (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm text-muted">
          {t("settings.team.adminOnlyNote")}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <FieldError message={actionError} />

      <h3 className="mt-5 text-sm font-semibold text-ink">
        {t("settings.team.membersTitle")}
      </h3>
      {loading && members.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("common.loading")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">
                  {member.name ?? member.email}
                  {member.isSelf ? (
                    <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t("settings.team.youLabel")}
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted">{member.email}</div>
              </div>
              {canManage && member.role !== "owner" && !member.isSelf ? (
                <>
                  <select
                    value={member.role}
                    onChange={(e) =>
                      void handleRoleChange(member, e.target.value as InvitableRole)
                    }
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    aria-label={t("settings.team.roleLabel")}
                  >
                    {INVITABLE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t(roleLabelKey(role))}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setRemoveTarget(member)}
                    className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-danger"
                  >
                    {t("settings.team.removeButton")}
                  </button>
                </>
              ) : (
                <span className="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-ink">
                  {t(roleLabelKey(member.role))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink">
            {t("settings.team.inviteTitle")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("settings.team.inviteBody")}
          </p>
          <form
            onSubmit={handleInvite}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            <label className="flex min-w-56 flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-muted">
                {t("settings.team.emailLabel")}
              </span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("settings.team.emailPlaceholder")}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">
                {t("settings.team.roleLabel")}
              </span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableRole)}
                className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
              >
                {INVITABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(roleLabelKey(role))}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {inviting
                ? t("settings.team.inviting")
                : t("settings.team.inviteButton")}
            </button>
          </form>

          {createdLink ? (
            <div className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-4">
              <div className="text-sm font-semibold text-ink">
                {t("settings.team.linkReadyTitle")}
              </div>
              <p className="mt-1 text-sm text-muted">
                {t("settings.team.linkReadyBody", { email: createdLink.email })}
              </p>
              <div className="mt-3 break-all rounded-lg bg-surface p-3 font-mono text-xs text-ink">
                {createdLink.url}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
                >
                  {copied
                    ? t("settings.team.copiedLabel")
                    : t("settings.team.copyButton")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedLink(null)}
                  className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
                >
                  {t("settings.team.doneButton")}
                </button>
              </div>
            </div>
          ) : null}

          <h3 className="mt-6 text-sm font-semibold text-ink">
            {t("settings.team.pendingTitle")}
          </h3>
          {invitations.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("settings.team.pendingEmpty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {invitation.email}
                    </div>
                    <div className="text-xs text-muted">
                      {t(roleLabelKey(invitation.role))}
                      {invitation.status === "pending"
                        ? ` · ${t("settings.team.expiresLabel", {
                            date: formatDateTime(invitation.expiresAt, locale),
                          })}`
                        : ""}
                    </div>
                  </div>
                  <span className="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-ink">
                    {t(
                      `settings.team.status${invitation.status[0].toUpperCase()}${invitation.status.slice(1)}` as TranslationKey,
                    )}
                  </span>
                  {invitation.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(invitation)}
                      className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-danger"
                    >
                      {t("settings.team.revokeButton")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {removeTarget ? (
        <RemoveMemberModal
          t={t}
          tenantId={tenantId}
          target={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

function RemoveMemberModal({
  t,
  tenantId,
  target,
  onClose,
  onRemoved,
}: {
  t: Translate;
  tenantId: string;
  target: TeamMemberResponse;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRemove = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.team.removeMember(tenantId, target.userId);
      onRemoved();
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
        <h2 className="text-lg font-bold text-ink">
          {t("settings.team.removeTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {t("settings.team.removeBody", { name: target.name ?? target.email })}
        </p>
        <FieldError message={error} />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleRemove}
            disabled={submitting}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting
              ? t("settings.team.removing")
              : t("settings.team.removeButton")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("settings.team.cancelButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
