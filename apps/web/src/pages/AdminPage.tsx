import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PlatformMetaInfo,
  PlatformSettingKey,
  PlatformSettingStatus,
  PlatformSettingTestResult,
  PlatformR2Info,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { LEGAL_PATHS } from "../components/LegalLinks";
import { formatDateTime } from "../utils/format";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface AdminPageProps {
  t: Translate;
  locale: Locale;
}

const TESTABLE: ReadonlySet<PlatformSettingKey> = new Set([
  "openrouter_api_key",
  "r2_access_key_id",
  "r2_secret_access_key",
]);

/**
 * Baris URL read-only + tombol salin (Fase 7D.1) — pola yang sama dengan
 * baris Redirect URI OAuth: nilai ditampilkan mono, salin memberi
 * umpan balik "Tersalin!" selama 2 detik. State salin per baris.
 */
function CopyableUrlRow({
  t,
  label,
  url,
}: {
  t: Translate;
  label: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs text-ink">{url}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => undefined);
          }}
          className="rounded-md bg-elevated px-2 py-1 text-xs font-medium text-ink"
        >
          {copied ? t("admin.copiedLabel") : t("admin.copyButton")}
        </button>
      </dd>
    </div>
  );
}

const KEY_LABELS: Record<PlatformSettingKey, TranslationKey> = {
  openrouter_api_key: "admin.openrouterApiKeyLabel",
  openrouter_model: "admin.openrouterModelLabel",
  r2_access_key_id: "admin.r2AccessKeyIdLabel",
  r2_secret_access_key: "admin.r2SecretAccessKeyLabel",
  meta_app_secret: "admin.metaAppSecretLabel",
  meta_app_id: "admin.metaAppIdLabel",
  meta_ig_config_id: "admin.metaIgConfigIdLabel",
  meta_wa_config_id: "admin.metaWaConfigIdLabel",
};

/**
 * Halaman Panel Admin Platform (Fase 6C) — HANYA dirender untuk user
 * ber-flag isPlatformAdmin (menu pun disembunyikan untuk yang lain, dan
 * API menjawab 404 untuk non-admin). Mengelola kredensial provider milik
 * platform per grup (OpenRouter / R2 / Meta): status per kunci (chip sumber
 * Panel/Env/Belum diatur + jejak ubah), field password untuk nilai baru
 * (nilai tersimpan TIDAK PERNAH dirender kembali — field selalu mulai
 * kosong), tombol Simpan / Hapus (kembali ke env) / Uji koneksi.
 * Grup Meta (Fase 7A.1) hanya berisi App Secret dan SENGAJA tanpa tombol
 * Uji: Meta tidak menyediakan validasi app secret yang berdiri sendiri.
 */
export function AdminPage({ t, locale }: AdminPageProps) {
  const [statuses, setStatuses] = useState<PlatformSettingStatus[]>([]);
  const [r2Info, setR2Info] = useState<PlatformR2Info | null>(null);
  const [metaInfo, setMetaInfo] = useState<PlatformMetaInfo | null>(null);
  const [redirectCopied, setRedirectCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const body = await api.admin.getSettings();
      if (requestSeq.current !== seq) return;
      setStatuses(body.settings);
      setR2Info(body.r2);
      setMetaInfo(body.meta);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
      setStatuses([]);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = (key: PlatformSettingKey) =>
    statuses.find((s) => s.key === key) ?? null;

  const onStatusChanged = (next: PlatformSettingStatus) => {
    setStatuses((prev) =>
      prev.map((s) => (s.key === next.key ? next : s)),
    );
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-ink">{t("nav.admin")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.intro")}</p>

      {error ? (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {loading && statuses.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("common.loading")}</p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-base font-semibold text-ink">
          {t("admin.openrouterTitle")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("admin.openrouterBody")}
        </p>
        <div className="mt-4 space-y-3">
          <SettingRow
            t={t}
            locale={locale}
            settingKey="openrouter_api_key"
            status={byKey("openrouter_api_key")}
            onStatusChanged={onStatusChanged}
          />
          <SettingRow
            t={t}
            locale={locale}
            settingKey="openrouter_model"
            status={byKey("openrouter_model")}
            secret={false}
            onStatusChanged={onStatusChanged}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">{t("admin.r2Title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.r2Body")}</p>
        {r2Info ? (
          <dl className="mt-3 grid max-w-2xl grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">{t("admin.r2AccountLabel")}</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {r2Info.accountId}
              </dd>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">{t("admin.r2EndpointLabel")}</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {r2Info.endpoint}
              </dd>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">{t("admin.r2BucketLabel")}</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {r2Info.bucket}
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="mt-4 space-y-3">
          <SettingRow
            t={t}
            locale={locale}
            settingKey="r2_access_key_id"
            status={byKey("r2_access_key_id")}
            onStatusChanged={onStatusChanged}
          />
          <SettingRow
            t={t}
            locale={locale}
            settingKey="r2_secret_access_key"
            status={byKey("r2_secret_access_key")}
            onStatusChanged={onStatusChanged}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">{t("admin.metaTitle")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.metaBody")}</p>
        <div className="mt-4 space-y-3">
          <SettingRow
            t={t}
            locale={locale}
            settingKey="meta_app_secret"
            status={byKey("meta_app_secret")}
            onStatusChanged={onStatusChanged}
          />
        </div>

        {/*
          Fase 7D — identifier publik OAuth Meta. Berbeda dari kunci
          rahasia di atas: App ID & config ID BUKAN kredensial, jadi
          nilai efektifnya (panel → env) DITAMPILKAN agar bisa
          diverifikasi, dan field-nya teks biasa (bukan password).
          Baris tetap memakai mekanisme simpan/hapus panel yang sama.
        */}
        <p className="mt-6 max-w-2xl text-sm text-muted">
          {t("admin.metaPublicIdsBody")}
        </p>
        {metaInfo ? (
          <dl className="mt-3 grid max-w-2xl grid-cols-1 gap-2 text-sm">
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">
                {t("admin.metaOauthRedirectLabel")}
              </dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs text-ink">
                  {metaInfo.oauthRedirectUri}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(metaInfo.oauthRedirectUri)
                      .then(() => {
                        setRedirectCopied(true);
                        setTimeout(() => setRedirectCopied(false), 2000);
                      })
                      .catch(() => undefined);
                  }}
                  className="rounded-md bg-elevated px-2 py-1 text-xs font-medium text-ink"
                >
                  {redirectCopied
                    ? t("admin.copiedLabel")
                    : t("admin.copyButton")}
                </button>
              </dd>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">{t("admin.metaAppIdLabel")}</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {metaInfo.appId ?? "—"}
              </dd>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">
                {t("admin.metaIgConfigIdLabel")}
              </dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {metaInfo.igConfigId ?? "—"}
              </dd>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <dt className="text-xs text-muted">
                {t("admin.metaWaConfigIdLabel")}
              </dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink">
                {metaInfo.waConfigId ?? "—"}
              </dd>
            </div>
            {/*
              Fase 7D.1 — URL halaman legal publik untuk diisi ke
              pengaturan aplikasi Meta (Privasi & instruksi penghapusan
              data wajib ada untuk App Review). Nilainya diturunkan dari
              origin publik saat ini + path tetap halaman legal.
            */}
            <CopyableUrlRow
              t={t}
              label={t("admin.metaPrivacyUrlLabel")}
              url={`${window.location.origin}${LEGAL_PATHS.privacy}`}
            />
            <CopyableUrlRow
              t={t}
              label={t("admin.metaTermsUrlLabel")}
              url={`${window.location.origin}${LEGAL_PATHS.terms}`}
            />
            <CopyableUrlRow
              t={t}
              label={t("admin.metaDeletionUrlLabel")}
              url={`${window.location.origin}${LEGAL_PATHS.deletion}`}
            />
          </dl>
        ) : null}
        <div className="mt-4 space-y-3">
          <SettingRow
            t={t}
            locale={locale}
            settingKey="meta_app_id"
            status={byKey("meta_app_id")}
            secret={false}
            onStatusChanged={(next) => {
              onStatusChanged(next);
              void load();
            }}
          />
          <SettingRow
            t={t}
            locale={locale}
            settingKey="meta_ig_config_id"
            status={byKey("meta_ig_config_id")}
            secret={false}
            onStatusChanged={(next) => {
              onStatusChanged(next);
              void load();
            }}
          />
          <SettingRow
            t={t}
            locale={locale}
            settingKey="meta_wa_config_id"
            status={byKey("meta_wa_config_id")}
            secret={false}
            onStatusChanged={(next) => {
              onStatusChanged(next);
              void load();
            }}
          />
        </div>
      </section>
    </div>
  );
}

function SettingRow({
  t,
  locale,
  settingKey,
  status,
  secret = true,
  onStatusChanged,
}: {
  t: Translate;
  locale: Locale;
  settingKey: PlatformSettingKey;
  status: PlatformSettingStatus | null;
  /** True = input password (kredensial); false = teks biasa (nama model). */
  secret?: boolean;
  onStatusChanged: (next: PlatformSettingStatus) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | "test" | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [testResult, setTestResult] =
    useState<PlatformSettingTestResult | null>(null);

  const label = t(KEY_LABELS[settingKey]);
  const sourceChip = !status?.isSet
    ? { text: t("admin.sourceNone"), cls: "bg-elevated text-muted" }
    : status.source === "panel"
      ? { text: t("admin.sourcePanel"), cls: "bg-accent/15 text-accent" }
      : { text: t("admin.sourceEnv"), cls: "bg-elevated text-ink" };

  const handleSave = async () => {
    if (!value.trim()) return;
    setBusy("save");
    setRowError(null);
    try {
      const next = await api.admin.setSetting(settingKey, value.trim());
      setValue("");
      setTestResult(null);
      onStatusChanged(next);
    } catch (err) {
      setRowError(translateApiError(t, err));
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    setBusy("clear");
    setRowError(null);
    try {
      const next = await api.admin.clearSetting(settingKey);
      setConfirmClear(false);
      setTestResult(null);
      onStatusChanged(next);
    } catch (err) {
      setRowError(translateApiError(t, err));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    setRowError(null);
    try {
      setTestResult(await api.admin.testSetting(settingKey));
    } catch (err) {
      setRowError(translateApiError(t, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-2xl rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceChip.cls}`}
        >
          {sourceChip.text}
        </span>
      </div>
      {status?.source === "panel" && status.updatedAt ? (
        <div className="mt-1 text-xs text-muted">
          {t("admin.updatedLabel", {
            date: formatDateTime(status.updatedAt, locale),
            by: status.updatedBy ?? "—",
          })}
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-muted">
          {t("admin.newValueLabel")}
        </span>
        <input
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            settingKey === "openrouter_model"
              ? t("admin.openrouterModelPlaceholder")
              : t("admin.newValuePlaceholder")
          }
          autoComplete="off"
          className={inputClassName}
        />
      </label>
      <FieldError message={rowError} />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy !== null || !value.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "save" ? t("admin.saving") : t("admin.saveButton")}
        </button>
        {status?.source === "panel" ? (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={busy !== null}
            className="rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-60"
          >
            {t("admin.clearButton")}
          </button>
        ) : null}
        {TESTABLE.has(settingKey) ? (
          <button
            type="button"
            onClick={handleTest}
            disabled={busy !== null}
            className="rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-ink disabled:opacity-60"
          >
            {busy === "test" ? t("admin.testing") : t("admin.testButton")}
          </button>
        ) : null}
      </div>

      {testResult ? (
        <div className="mt-3 rounded-lg bg-elevated px-3 py-2 text-sm">
          <span
            className={testResult.ok ? "text-accent" : "text-red-600"}
          >
            {testResult.ok
              ? t("admin.testOk")
              : t("admin.testFailed", { code: testResult.code })}
          </span>
          {testResult.ok && testResult.info ? (
            <span className="text-muted">
              {typeof testResult.info.label === "string"
                ? ` · ${t("admin.testInfoLabel")}: ${testResult.info.label}`
                : ""}
              {typeof testResult.info.isFreeTier === "boolean"
                ? ` · ${t("admin.testInfoTier")}: ${testResult.info.isFreeTier ? "✓" : "—"}`
                : ""}
              {typeof testResult.info.limitRemaining === "number"
                ? ` · ${t("admin.testInfoLimitRemaining")}: ${testResult.info.limitRemaining}`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      {confirmClear ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
            <h3 className="text-lg font-bold text-ink">
              {t("admin.clearConfirmTitle")}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {t("admin.clearConfirmBody", { name: label })}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleClear}
                disabled={busy !== null}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy === "clear" ? t("admin.clearing") : t("admin.clearButton")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
