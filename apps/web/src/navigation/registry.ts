import type { TranslationKey } from "@sahabat-kreator/i18n";

/**
 * REGISTRY NAVIGASI TUNGGAL (RANCANGAN §10.1) — satu-satunya sumber kebenaran.
 * Sidebar desktop dan bottom bar mobile me-render array yang SAMA ini.
 * Mengubah menu = mengubah array ini saja. labelKey adalah kunci i18n,
 * BUKAN teks langsung. Field `route` adalah PATH URL asli item itu
 * (Fase 6E): klik menu menavigasi ke path ini, dan item aktif selalu
 * diturunkan DARI URL saat ini lewat `matchNavPath` — tidak ada state
 * "halaman aktif" terpisah di komponen mana pun.
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

/** Hasil pencocokan path URL terhadap registry (Fase 6E). */
export interface NavPathMatch {
  item: NavItem;
  /**
   * Segmen pertama setelah route item — untuk Inbox ini adalah id
   * percakapan pada deep-link `/inbox/:conversationId`. Null bila URL
   * persis sama dengan route item.
   */
  segment: string | null;
}

/**
 * Turunkan item navigasi aktif dari pathname URL. Kecocokan persis
 * didahulukan; selain itu awalan `route + "/"` (route terpanjang menang)
 * menangkap sub-path seperti /inbox/:id. Path tak dikenal jatuh ke item
 * pertama (Dashboard) — perilaku shell yang sama seperti sebelum 6E,
 * agar URL sampah tidak pernah menghasilkan layar kosong.
 */
export function matchNavPath(pathname: string): NavPathMatch {
  for (const item of NAV_REGISTRY) {
    if (pathname === item.route) return { item, segment: null };
  }
  const prefixed = NAV_REGISTRY.filter((i) => i.route !== "/").sort(
    (a, b) => b.route.length - a.route.length,
  );
  for (const item of prefixed) {
    if (pathname.startsWith(`${item.route}/`)) {
      const raw = pathname.slice(item.route.length + 1).split("/")[0] ?? "";
      let segment = raw;
      try {
        segment = decodeURIComponent(raw);
      } catch {
        /* segmen tidak valid — pakai apa adanya */
      }
      return { item, segment: segment === "" ? null : segment };
    }
  }
  return { item: NAV_REGISTRY[0]!, segment: null };
}
