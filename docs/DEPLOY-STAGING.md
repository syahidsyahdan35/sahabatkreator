# Deploy Staging — botara.my.id

Catatan deploy staging pertama Sahabat Kreator (Fase 0) ke server staging
(103.186.31.46) di balik Cloudflare Tunnel. Ditulis 2026-11-01.

## Topologi

```
Publik https://botara.my.id
  └─ Cloudflare Tunnel (remotely managed) → 127.0.0.1:5180 di server
       └─ sahabat-kreator-web.service — Vite preview (Bun) :5180
            ├─ /        → apps/web/dist (SPA "Sahabat Kreator")
            └─ /api/*   → proxy Vite (vite.config.ts `preview.proxy`,
                          path utuh tanpa strip) → 127.0.0.1:3101
       └─ sahabat-kreator-api.service — API Hono (Bun, dist/index.js) :3101
            route dilayani di root DAN di bawah prefix /api
            (GET /health, GET /api/health, GET /version, GET /api/version)
```

Target publik: `https://botara.my.id/` → SPA Sahabat Kreator;
`https://botara.my.id/api/health` → `{"status":"ok",...}`.

## Lokasi & service di server

- Kode di server: `/home/ubuntu/sahabat-kreator/` (salinan repo, termasuk
  `node_modules` hasil build di VM pengembangan — symlink relatif pnpm tetap
  valid; tidak ada install ulang di server).
- Build dilakukan di VM pengembangan: `pnpm --filter @sahabat-kreator/api
  --filter @sahabat-kreator/web build`, lalu seluruh repo di-rsync ke server.
- Unit systemd (user `ubuntu`, runtime Bun di `/home/ubuntu/.bun/bin/bun`):
  - `sahabat-kreator-api.service` — WorkingDirectory `.../apps/api`,
    `ExecStart=/home/ubuntu/.bun/bin/bun dist/index.js`,
    env `NODE_ENV=production`, `API_PORT=3101`, `Restart=always`.
  - `sahabat-kreator-web.service` — WorkingDirectory `.../apps/web`,
    `ExecStart=/home/ubuntu/.bun/bin/bun node_modules/vite/bin/vite.js preview
    --port 5180 --host 127.0.0.1`, `Restart=always`.
- Environment staging tahap ini TANPA kredensial apa pun (belum ada API key,
  database, atau Redis yang dipakai API Fase 0).
- `apps/web/vite.config.ts` mendaftarkan `preview.allowedHosts: ["botara.my.id"]`
  — tanpa ini Vite preview menjawab 403 untuk semua request ber-Host
  botara.my.id (proteksi DNS rebinding), walau dari localhost tampak normal.

## Pengambilalihan domain

Port 5180 sebelumnya dilayani `botara-app-web.service` (Vite preview proyek
lama botara-app). Pengambilalihan:

```bash
sudo systemctl stop botara-app-web.service
sudo systemctl disable botara-app-web.service
sudo systemctl enable --now sahabat-kreator-api.service sahabat-kreator-web.service
```

File proyek lama TIDAK dihapus; service/proyek lain di server tidak disentuh.

## Verifikasi

```bash
# di server
curl -s http://127.0.0.1:5180/ | grep -o '<title>[^<]*</title>'   # Sahabat Kreator
curl -s http://127.0.0.1:5180/api/health                          # {"status":"ok",...}
systemctl is-active sahabat-kreator-api sahabat-kreator-web       # active, active
systemctl is-active botara-app-web                                # inactive

# publik
curl -s https://botara.my.id/ | grep -o '<title>[^<]*</title>'
curl -s https://botara.my.id/api/health
```

## Rollback

```bash
sudo systemctl stop sahabat-kreator-web.service sahabat-kreator-api.service
sudo systemctl disable sahabat-kreator-web.service sahabat-kreator-api.service
sudo systemctl enable --now botara-app-web.service
```

Setelah rollback, botara.my.id kembali melayani Vite preview botara-app lama
dari port 5180.

## Deploy ulang berikutnya

1. Di VM pengembangan: ubah kode → `pnpm build` (api+web) → commit & push.
2. Rsync repo (termasuk `node_modules` & `dist`) ke `/home/ubuntu/sahabat-kreator/`.
3. Di server: `sudo systemctl restart sahabat-kreator-api sahabat-kreator-web`.
4. Ulangi verifikasi di atas.
