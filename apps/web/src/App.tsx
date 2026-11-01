import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTranslator,
  type Locale,
} from "@sahabat-kreator/i18n";
import { NAV_REGISTRY, type NavItem } from "./navigation/registry";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { Sidebar } from "./components/Sidebar";
import { MobileBottomBar } from "./components/MobileBottomBar";
import { MoreSheet } from "./components/MoreSheet";
import { ProfileBlock } from "./components/ProfileBlock";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { DashboardPage } from "./pages/DashboardPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { AgentsPage } from "./pages/AgentsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ContactsPage } from "./pages/ContactsPage";
import { InboxPage } from "./pages/InboxPage";
import {
  UnreadBadgeProvider,
  useUnreadBadge,
} from "./inbox/UnreadBadgeProvider";
import {
  PendingApprovalsProvider,
  usePendingApprovals,
} from "./agents/PendingApprovalsProvider";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ProductsPage } from "./pages/ProductsPage";
import { PayPage } from "./pages/PayPage";
import { WebchatDemoPage } from "./pages/WebchatDemoPage";
import { useTheme, type ThemeMode } from "./theme";

// Badge navigasi berasal dari API workspace aktif — query yang sama untuk
// desktop & mobile (§10.1), registry tidak diubah: unread Inbox dari API
// conversations (UnreadBadgeProvider, Fase 1E) dan pendingApprovals dari
// jumlah draf agent berstatus pending (PendingApprovalsProvider, Fase 3B —
// menggantikan angka demo Fase 0).

/**
 * Router path sederhana (Fase 1C): hanya tiga permukaan —
 * /login & /register (berdiri sendiri, tanpa shell) dan shell dashboard
 * untuk semua path lain. Navigasi antar-menu DI DALAM shell tetap berbasis
 * state activeId seperti Fase 0 (registry navigasi tidak berubah).
 */
function usePathRoute() {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigateTo = useCallback((next: string) => {
    if (window.location.pathname !== next) {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  }, []);
  return { path, navigateTo };
}

type Translator = ReturnType<typeof createTranslator>;

interface ShellProps {
  t: Translator;
  locale: Locale;
  controls: React.ReactNode;
  onNavigateTo: (path: string) => void;
}

/** Shell dashboard TERPROTEKSI: wajib sesi; belum login → dialihkan ke /login. */
function Shell({ t, locale, controls, onNavigateTo }: ShellProps) {
  const { status } = useAuth();

  useEffect(() => {
    if (status === "anonymous") onNavigateTo("/login");
  }, [status, onNavigateTo]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-ink">
        <p className="text-sm text-muted">{t("common.loading")}</p>
      </div>
    );
  }
  if (status !== "authenticated") return null;

  return (
    <WorkspaceProvider>
      <UnreadBadgeProvider>
        <PendingApprovalsProvider>
          <ShellMain
            t={t}
            locale={locale}
            controls={controls}
            onNavigateTo={onNavigateTo}
          />
        </PendingApprovalsProvider>
      </UnreadBadgeProvider>
    </WorkspaceProvider>
  );
}

/** Isi shell (sidebar + konten + bottom bar) — berjalan di dalam provider workspace & badge. */
function ShellMain({ t, locale, controls, onNavigateTo }: ShellProps) {
  const { user, signOut } = useAuth();
  const { totalUnread } = useUnreadBadge();
  const { pendingCount } = usePendingApprovals();
  const [activeId, setActiveId] = useState("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const badges = { pendingApprovals: pendingCount, unreadInbox: totalUnread };

  const activeItem: NavItem =
    NAV_REGISTRY.find((i) => i.id === activeId) ?? NAV_REGISTRY[0]!;
  const moreActive = activeItem.mobile.slot === "more";

  const navigate = (item: NavItem) => {
    setActiveId(item.id);
    setMoreOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    onNavigateTo("/login");
  };

  const profile = (
    <ProfileBlock t={t} user={user} onSignOut={handleSignOut} />
  );
  const workspace = <WorkspaceSwitcher t={t} />;

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <Sidebar
        t={t}
        activeId={activeId}
        onNavigate={navigate}
        badges={badges}
        controls={controls}
        workspace={workspace}
        profile={profile}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
        <div className="mb-6 md:hidden">
          <div className="text-lg font-bold">{t("app.name")}</div>
          <div className="text-xs text-muted">{t("app.tagline")}</div>
        </div>
        {activeId === "dashboard" ? (
          <DashboardPage t={t} locale={locale} />
        ) : activeId === "contacts" ? (
          <ContactsPage t={t} locale={locale} />
        ) : activeId === "inbox" ? (
          <InboxPage t={t} locale={locale} />
        ) : activeId === "agents" ? (
          <AgentsPage t={t} locale={locale} />
        ) : activeId === "knowledge" ? (
          <KnowledgePage t={t} locale={locale} />
        ) : activeId === "channels" ? (
          <ChannelsPage t={t} locale={locale} />
        ) : activeId === "automations" ? (
          <AutomationsPage t={t} locale={locale} />
        ) : activeId === "products" ? (
          <ProductsPage t={t} locale={locale} />
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
        badges={badges}
      />
      <MoreSheet
        t={t}
        open={moreOpen}
        activeId={activeId}
        onClose={() => setMoreOpen(false)}
        onNavigate={navigate}
        controls={controls}
        workspace={workspace}
        profile={profile}
      />
    </div>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return localStorage.getItem("sk-locale") === "id" ? "id" : "en";
    } catch {
      return "en";
    }
  });
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { path, navigateTo } = usePathRoute();

  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    try {
      localStorage.setItem("sk-locale", locale);
    } catch {
      /* abaikan */
    }
    document.documentElement.lang = locale;
  }, [locale]);

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

  // Halaman demo webchat publik (Fase 1F): di luar shell & tanpa sesi —
  // harus bisa dibuka siapa pun seperti situs tenant yang memasang widget.
  if (path === "/webchat-demo") {
    return <WebchatDemoPage t={t} locale={locale} />;
  }

  // Halaman bayar publik (Fase 4A): di luar shell & tanpa sesi — tautan
  // /pay/:code dibagikan penjual ke pembeli. SIMULASI berlabel besar.
  if (path.startsWith("/pay/")) {
    const code = decodeURIComponent(path.slice("/pay/".length)).split("/")[0];
    if (code) {
      return <PayPage t={t} locale={locale} code={code} />;
    }
  }

  return (
    <AuthProvider>
      {path === "/login" ? (
        <LoginPage t={t} locale={locale} controls={controls} onNavigate={navigateTo} />
      ) : path === "/register" ? (
        <RegisterPage t={t} locale={locale} controls={controls} onNavigate={navigateTo} />
      ) : (
        <Shell t={t} locale={locale} controls={controls} onNavigateTo={navigateTo} />
      )}
    </AuthProvider>
  );
}
