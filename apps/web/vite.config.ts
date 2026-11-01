import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: {
    port: 5173,
    host: true,
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
      },
    },
  },
});
