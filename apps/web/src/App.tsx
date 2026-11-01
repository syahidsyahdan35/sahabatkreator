import { useEffect, useMemo, useState } from "react";
import {
  createTranslator,
  type Locale,
  type TranslationKey,
} from "@sahabat-kreator/i18n";
import { NAV_REGISTRY, type NavItem } from "./navigation/registry";
import { Sidebar } from "./components/Sidebar";
import { MobileBottomBar } from "./components/MobileBottomBar";
import { MoreSheet } from "./components/MoreSheet";
import { DashboardPage } from "./pages/DashboardPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { useTheme, type ThemeMode } from "./theme";

// Badge demo Fase 0 — nanti berasal dari query yang sama untuk desktop & mobile (§10.1).
const DEMO_BADGES = { unreadInbox: 3, pendingApprovals: 1 } as const;

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return localStorage.getItem("sk-locale") === "id" ? "id" : "en";
    } catch {
      return "en";
    }
  });
  const [activeId, setActiveId] = useState("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    try {
      localStorage.setItem("sk-locale", locale);
    } catch {
      /* abaikan */
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const activeItem: NavItem =
    NAV_REGISTRY.find((i) => i.id === activeId) ?? NAV_REGISTRY[0]!;
  const moreActive = activeItem.mobile.slot === "more";

  const navigate = (item: NavItem) => {
    setActiveId(item.id);
    setMoreOpen(false);
  };

  const themeLabel = (m: ThemeMode) =>
    t(m === "light" ? "common.themeLight" : m === "dark" ? "common.themeDark" : "common.themeSystem");

  const controls = (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
          {t("common.language")}
        </div>
        <div className="flex gap-1">
          {(["en", "id"] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`rounded-md px-3 py-1 text-sm ${
                locale === l
                  ? "bg-accent font-semibold text-white"
                  : "bg-elevated text-ink"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
          {t("common.theme")}
        </div>
        <div className="flex gap-1">
          {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setThemeMode(m)}
              className={`rounded-md px-3 py-1 text-sm ${
                themeMode === m
                  ? "bg-accent font-semibold text-white"
                  : "bg-elevated text-ink"
              }`}
            >
              {themeLabel(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <Sidebar t={t} activeId={activeId} onNavigate={navigate} badges={DEMO_BADGES} controls={controls} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
        <div className="mb-6 md:hidden">
          <div className="text-lg font-bold">{t("app.name")}</div>
          <div className="text-xs text-muted">{t("app.tagline")}</div>
        </div>
        {activeId === "dashboard" ? (
          <DashboardPage t={t} locale={locale} />
        ) : (
          <PlaceholderPage t={t} titleKey={activeItem.labelKey} />
        )}
      </main>
      <MobileBottomBar
        t={t}
        activeId={activeId}
        moreActive={moreActive}
        onNavigate={navigate}
        onMore={() => setMoreOpen(true)}
        badges={DEMO_BADGES}
      />
      <MoreSheet
        t={t}
        open={moreOpen}
        activeId={activeId}
        onClose={() => setMoreOpen(false)}
        onNavigate={navigate}
        controls={controls}
      />
    </div>
  );
}
