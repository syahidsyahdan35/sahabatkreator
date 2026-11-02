import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Dev lokal: teruskan /api ke API lokal (termasuk WebSocket webchat).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3101",
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
        // Fase 1F: WebSocket widget webchat (/api/webchat/ws) WAJIB
        // diteruskan sebagai upgrade ke API — tanpa ws:true koneksi
        // realtime pengunjung putus di Vite preview.
        ws: true,
      },
    },
  },
});
