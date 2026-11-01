import type { Resources } from "./en";

/** Resource Bahasa Indonesia — wajib lengkap; kunci yang hilang fallback ke `en`. */
export const id: Resources = {
  app: {
    name: "Sahabat Kreator",
    tagline: "Chat marketing agentic untuk kreator",
  },
  nav: {
    dashboard: "Dashboard",
    inbox: "Inbox",
    agents: "Agent AI",
    broadcasts: "Broadcast",
    contacts: "Kontak",
    automations: "Automation",
    knowledge: "Knowledge Base",
    products: "Produk",
    channels: "Channel",
    analytics: "Analitik",
    billing: "Tagihan",
    settings: "Pengaturan",
    more: "Lainnya",
  },
  common: {
    language: "Bahasa",
    theme: "Tema",
    themeLight: "Terang",
    themeDark: "Gelap",
    themeSystem: "Sistem",
    comingSoon: "Segera hadir",
    placeholderBody: "Halaman ini placeholder Fase 0. Fiturnya tiba pada fase roadmap berikutnya.",
  },
  dashboard: {
    title: "Dashboard Kreator",
    subtitle: "Ringkasan hari ini dari semua channel Anda.",
    statContacts: "Total Kontak",
    statConversations: "Percakapan Aktif",
    statBroadcasts: "Broadcast Terkirim",
    statAgentReplies: "Balasan Agent AI",
    note: "Ringkasan statis untuk scaffold Fase 0 — data live terhubung pada Fase 1.",
  },
};
