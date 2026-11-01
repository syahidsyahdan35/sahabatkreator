import { formatNumber, type Locale, type TranslationKey } from "@sahabat-kreator/i18n";

interface DashboardPageProps {
  t: (key: TranslationKey) => string;
  locale: Locale;
}

/** Dashboard placeholder Fase 0: ringkasan statis, semua label dari i18n. */
export function DashboardPage({ t, locale }: DashboardPageProps) {
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
