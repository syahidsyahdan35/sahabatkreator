import { formatNumber, type Locale, type TranslationKey } from "@sahabat-kreator/i18n";
import { CreateWorkspaceForm } from "../components/WorkspaceSwitcher";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface DashboardPageProps {
  t: Translate;
  locale: Locale;
}

const ROLE_KEYS: Record<string, TranslationKey> = {
  owner: "workspace.roles.owner",
  admin: "workspace.roles.admin",
  agent: "workspace.roles.agent",
  viewer: "workspace.roles.viewer",
};

/**
 * Dashboard (Fase 1C): konteks workspace aktif dari API.
 * - Belum punya workspace → keadaan kosong + form buat workspace di tempat.
 * - Sudah ada → banner workspace aktif + peran; statistik di bawahnya tetap
 *   placeholder dan DIBERI LABEL jelas (metrik live datang di fase berikutnya).
 */
export function DashboardPage({ t, locale }: DashboardPageProps) {
  const { status, tenants, active, reload } = useWorkspace();

  const stats: Array<{ labelKey: TranslationKey; value: number }> = [
    { labelKey: "dashboard.statContacts", value: 1284 },
    { labelKey: "dashboard.statConversations", value: 37 },
    { labelKey: "dashboard.statBroadcasts", value: 12 },
    { labelKey: "dashboard.statAgentReplies", value: 862 },
  ];

  return (
    <section>
      <h1 className="text-2xl font-bold text-ink">{t("dashboard.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("dashboard.subtitle")}</p>

      {status === "loading" ? (
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      ) : status === "error" ? (
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
      ) : tenants.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">{t("workspace.emptyTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{t("workspace.emptyBody")}</p>
          <div className="mt-4 max-w-md">
            <CreateWorkspaceForm t={t} />
          </div>
        </div>
      ) : active ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3">
          <span className="text-sm font-semibold text-ink">
            {t("workspace.dashboardContext", { name: active.name })}
          </span>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
            {t("workspace.yourRole", {
              role: t(ROLE_KEYS[active.role] ?? "workspace.roles.viewer"),
            })}
          </span>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.labelKey} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-2xl font-bold text-ink">{formatNumber(s.value, locale)}</div>
            <div className="mt-1 text-xs text-muted">{t(s.labelKey)}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 rounded-lg bg-elevated px-4 py-3 text-sm text-muted">{t("dashboard.note")}</p>
    </section>
  );
}
