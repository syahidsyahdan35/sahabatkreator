import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Dev lokal: teruskan /api ke API lokal dan /realtime ke gateway
    // WebSocket apps/realtime lokal (Fase 6G).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3101",
        changeOrigin: true,
        ws: true,
      },
      "/realtime": {
        target: "http://127.0.0.1:3103",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    host: true,
    // CORS bawaan Vite preview DIMATIKAN (hotfix webchat 2026-11-02):
    // middleware CORS Vite menjawab preflight OPTIONS /api/* SENDIRI
    // (allow-methods/headers generik TANPA Access-Control-Allow-Origin)
    // sehingga browser memblokir widget webchat yang dipasang di situs
    // lain, walau API sudah benar. Dengan cors:false, preflight
    // diteruskan proxy ke API Hono yang menerapkan CORS permisif HANYA
    // untuk endpoint publik /api/webchat/* (lihat
    // apps/api/src/modules/webchat/routes.ts). Dashboard tetap
    // satu-origin; tidak ada CORS permisif di lapisan ini.
    cors: false,
    // Vite preview menolak Host yang tidak dikenal (proteksi DNS rebinding).
    // Domain staging publik wajib didaftarkan eksplisit, kalau tidak semua
    // request lewat Cloudflare Tunnel (Host: botara.my.id) dijawab 403.
    allowedHosts: ["botara.my.id"],
    // Staging/prod: web dan API satu origin. Vite preview meneruskan /api/*
    // (path utuh, tanpa strip) ke API Hono lokal di port 3101, yang memang
    // melayani route di bawah prefix /api (lihat apps/api/src/index.ts).
    // Port/host aktual di server diatur lewat flag CLI unit systemd.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3101",
        changeOrigin: true,
        ws: true,
      },
      // Fase 6G: satu-satunya jalur WebSocket publik kini /realtime/*
      // menuju apps/realtime (gateway mandiri, port 3103) — socket
      // dashboard (/realtime/dashboard) & widget (/realtime/webchat).
      // (Jalur lama /api/webchat/ws pensiun bersama hub di apps/api.)
      // Di produksi jalur ini pindah ke edge/reverse-proxy, bukan Vite.
      "/realtime": {
        target: "http://127.0.0.1:3103",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
