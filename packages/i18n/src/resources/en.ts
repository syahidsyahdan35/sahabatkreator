/**
 * Resource Inggris — DEFAULT, FALLBACK, dan SUMBER TIPE (RANCANGAN §11.1).
 * Semua teks UI wajib lewat kunci dari file ini. Tidak ada string hardcoded.
 */
export const en = {
  app: {
    name: "Sahabat Kreator",
    tagline: "Agentic chat marketing for creators",
  },
  nav: {
    dashboard: "Dashboard",
    inbox: "Inbox",
    agents: "AI Agents",
    broadcasts: "Broadcasts",
    contacts: "Contacts",
    automations: "Automations",
    knowledge: "Knowledge Base",
    products: "Products",
    channels: "Channels",
    analytics: "Analytics",
    billing: "Billing",
    settings: "Settings",
    more: "More",
  },
  common: {
    language: "Language",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    comingSoon: "Coming soon",
    placeholderBody: "This page is a Phase 0 placeholder. Its features arrive in the next phases of the roadmap.",
  },
  dashboard: {
    title: "Creator Dashboard",
    subtitle: "Today at a glance across all your channels.",
    statContacts: "Total Contacts",
    statConversations: "Active Conversations",
    statBroadcasts: "Broadcasts Sent",
    statAgentReplies: "AI Agent Replies",
    note: "Static summary for the Phase 0 scaffold — live data connects in Phase 1.",
  },
};

/**
 * Bentuk struktur resource: semua daun berupa string.
 * (Sengaja BUKAN tipe literal dari `en` — locale lain harus boleh berisi teks berbeda,
 * yang dicek hanya kelengkapan & bentuk strukturnya.)
 */
export type Resources = typeof en;
