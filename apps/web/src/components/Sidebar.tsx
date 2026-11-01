import type { TranslationKey } from "@sahabat-kreator/i18n";
import { desktopItems, type NavItem } from "../navigation/registry";
import { NavIcon } from "./NavIcon";

interface SidebarProps {
  t: (key: TranslationKey) => string;
  activeId: string;
  onNavigate: (item: NavItem) => void;
  badges: Partial<Record<NonNullable<NavItem["badge"]>, number>>;
  controls: React.ReactNode;
}

/** Sidebar DESKTOP — me-render registry navigasi yang sama dengan mobile (§10.1). */
export function Sidebar({ t, activeId, onNavigate, badges, controls }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="border-b border-line px-5 py-4">
        <div className="text-lg font-bold text-ink">{t("app.name")}</div>
        <div className="text-xs text-muted">{t("app.tagline")}</div>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {desktopItems.map((item) => {
            const active = item.id === activeId;
            const badge = item.badge ? badges[item.badge] : undefined;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    active
                      ? "bg-accent/10 font-semibold text-accent"
                      : "text-ink hover:bg-elevated"
                  }`}
                >
                  <NavIcon name={item.icon} />
                  <span className="flex-1 text-left">{t(item.labelKey)}</span>
                  {badge ? (
                    <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">
                      {badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-line p-4">{controls}</div>
    </aside>
  );
}
