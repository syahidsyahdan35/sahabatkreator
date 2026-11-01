import type { TranslationKey } from "@sahabat-kreator/i18n";

/**
 * REGISTRY NAVIGASI TUNGGAL (RANCANGAN §10.1) — satu-satunya sumber kebenaran.
 * Sidebar desktop dan bottom bar mobile me-render array yang SAMA ini.
 * Mengubah menu = mengubah array ini saja. labelKey adalah kunci i18n,
 * BUKAN teks langsung.
 */
export type IconName =
  | "home" | "inbox" | "bot" | "megaphone" | "users" | "workflow" | "book"
  | "bag" | "link" | "chart" | "card" | "settings" | "more";

export interface NavItem {
  id: string;
  labelKey: TranslationKey;
  icon: IconName;
  route: string;
  permission?: string;
  entitlement?: string;
  badge?: "unreadInbox" | "pendingApprovals";
  mobile: { slot: 1 | 2 | 3 | 4 } | { slot: "more" } | { slot: "hidden" };
  order: { desktop: number; more: number };
}

export const NAV_REGISTRY: NavItem[] = [
  { id: "dashboard",   labelKey: "nav.dashboard",   icon: "home",      route: "/",            mobile: { slot: 1 },      order: { desktop: 1,  more: 0 } },
  { id: "inbox",       labelKey: "nav.inbox",       icon: "inbox",     route: "/inbox",       badge: "unreadInbox",      mobile: { slot: 2 },      order: { desktop: 2,  more: 0 } },
  { id: "agents",      labelKey: "nav.agents",      icon: "bot",       route: "/agents",      badge: "pendingApprovals", mobile: { slot: 3 },      order: { desktop: 3,  more: 0 } },
  { id: "broadcasts",  labelKey: "nav.broadcasts",  icon: "megaphone", route: "/broadcasts", mobile: { slot: 4 },      order: { desktop: 4,  more: 0 } },
  { id: "contacts",    labelKey: "nav.contacts",    icon: "users",     route: "/contacts",    mobile: { slot: "more" }, order: { desktop: 5,  more: 1 } },
  { id: "automations", labelKey: "nav.automations", icon: "workflow",  route: "/automations", mobile: { slot: "more" }, order: { desktop: 6,  more: 2 } },
  { id: "knowledge",   labelKey: "nav.knowledge",   icon: "book",      route: "/knowledge",   mobile: { slot: "more" }, order: { desktop: 7,  more: 3 } },
  { id: "products",    labelKey: "nav.products",    icon: "bag",       route: "/products",    mobile: { slot: "more" }, order: { desktop: 8,  more: 4 } },
  { id: "channels",    labelKey: "nav.channels",    icon: "link",      route: "/channels",    mobile: { slot: "more" }, order: { desktop: 9,  more: 5 } },
  { id: "analytics",   labelKey: "nav.analytics",   icon: "chart",     route: "/analytics",   mobile: { slot: "more" }, order: { desktop: 10, more: 6 } },
  { id: "billing",     labelKey: "nav.billing",     icon: "card",      route: "/billing",     mobile: { slot: "more" }, order: { desktop: 11, more: 7 } },
  { id: "settings",    labelKey: "nav.settings",    icon: "settings",  route: "/settings",    mobile: { slot: "more" }, order: { desktop: 12, more: 8 } },
];

/** Item untuk sidebar desktop: semua item terurut order.desktop. */
export const desktopItems: NavItem[] = [...NAV_REGISTRY].sort(
  (a, b) => a.order.desktop - b.order.desktop,
);

/** Tepat 4 tab mobile (slot 1–4), terurut slot. */
export const mobileTabItems: NavItem[] = NAV_REGISTRY.filter(
  (i): i is NavItem & { mobile: { slot: number } } => typeof i.mobile.slot === "number",
).sort((a, b) => (a.mobile.slot as number) - (b.mobile.slot as number));

/** Sisa item yang tampil di sheet "More" pada mobile, terurut order.more. */
export const moreItems: NavItem[] = NAV_REGISTRY.filter(
  (i) => i.mobile.slot === "more",
).sort((a, b) => a.order.more - b.order.more);
