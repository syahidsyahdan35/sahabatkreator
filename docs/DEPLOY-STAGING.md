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

---

## Update Fase 1B — Auth + Tenant API + Postgres staging (2026-11-01)

### Database staging (di server, Docker)

- Container `sahabat-kreator-pg` — image `pgvector/pgvector:pg16`, volume
  `sahabat-kreator-pgdata`, port **hanya** `127.0.0.1:5434`, database
  `sahabat_kreator_staging`, `--restart unless-stopped`. Container/service
  proyek lain tidak disentuh.
- Dua role: `sk_migration` (pemilik/superuser container — hanya untuk
  migrasi) dan `sk_app` (**non-superuser, tanpa BYPASSRLS** — koneksi API,
  agar RLS benar-benar berlaku). Grant `sk_app`: SELECT/INSERT/UPDATE/DELETE
  semua tabel + usage sequences, plus `ALTER DEFAULT PRIVILEGES` dari role
  migrasi agar tabel migrasi berikutnya otomatis ter-grant.
- Kredensial digenerate acak **di server** dan hanya disimpan di
  `/home/ubuntu/sahabat-kreator/.env.staging` (chmod 600, tidak masuk repo):
  `DATABASE_URL` (role `sk_app`), `MIGRATION_DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://botara.my.id`,
  `API_PORT=3101`, `NODE_ENV=production`.
- Migrasi repo (0000–0003) dijalankan dari VM pengembangan memakai role
  migrasi lewat SSH port-forward (`ssh -L 5434:127.0.0.1:5434`).

### Unit API

`sahabat-kreator-api.service` kini memakai
`EnvironmentFile=/home/ubuntu/sahabat-kreator/.env.staging` (ditambah
`After=docker.service`). Tanpa file itu API tetap hidup tetapi modul
tenants menjawab 503 — perilaku fail-safe yang disengaja.
Peringatan operasional: menulis unit dengan `sudo tee` + heredoc bersamaan
gagal (stdin sudo tertabrak heredoc) — tulis file ke home dulu, lalu
`sudo cp`.

### Verifikasi Fase 1B (publik)

Alur penuh terhadap `https://botara.my.id` lulus: sign-up & sign-in
Better Auth (cookie sesi), `POST /api/tenants` → 201 + slug,
`GET /api/tenants` & `GET /api/tenants/:id` → 200, tanpa cookie → 401,
user kedua → 404 pada tenant user pertama & daftar kosong. Akun uji:
`fase1b-pub1@sk.test`, `fase1b-pub2@sk.test` (staging).

Catatan lingkungan: POST dari VM pengembangan ke domain publik timeout
karena proxy egress VM (GET normal; request yang sama dari server ke URL
publik berhasil <2 detik). Ini artefak proxy VM, bukan aplikasi/tunnel —
verifikasi POST publik dijalankan dari server terhadap URL publik asli
(melewati Cloudflare edge + tunnel).

## Deploy ulang berikutnya

1. Di VM pengembangan: ubah kode → `pnpm build` (api+web) → commit & push.
2. Rsync repo (termasuk `node_modules` & `dist`) ke `/home/ubuntu/sahabat-kreator/`.
3. Di server: `sudo systemctl restart sahabat-kreator-api sahabat-kreator-web`.
4. Ulangi verifikasi di atas.

---

## Update Fase 1C — Halaman auth & workspace di web (2026-11-02)

### Perubahan
- Web kini punya halaman `/login` & `/register` (di luar shell), proteksi
  shell via `GET /api/auth/get-session`, area profil + logout, dan pemilih
  workspace (GET/POST /api/tenants) dengan konteks workspace aktif di
  Dashboard. API tidak berubah pada fase ini.
- Deploy: build web di VM → commit `f7fda3e` → rsync seluruh repo →
  service web di-restart (proses Vite preview milik `ubuntu` dihentikan,
  systemd `Restart=always` mengangkat ulang dari file baru — setara
  `systemctl restart sahabat-kreator-web`). `.env.staging` di server utuh.

### Verifikasi Fase 1C (publik, dari server terhadap https://botara.my.id)
- Rantai penuh dengan akun uji BARU `fase1c-pub1@sk.test`: sign-up → 200 +
  cookie sesi; get-session → sesi+user; `POST /api/tenants` → 201
  ("Studio Fase 1C", role owner); `GET /api/tenants` berisi workspace itu;
  sign-in ulang → 200; password salah → 401; tanpa sesi → 401 kontrak.
- Sign-out terbukti dengan akun `fase1c-pub2@sk.test`: sesi aktif →
  `POST /api/auth/sign-out` → `{success:true}` → get-session `null` →
  tenants 401. CATATAN: Better Auth menolak POST tanpa header `Origin`
  (`MISSING_OR_NULL_ORIGIN`) — curl manual wajib `-H "Origin: https://botara.my.id"`;
  browser selalu mengirim header ini, jadi logout dari UI tidak terdampak.
- GET publik dari VM: `/` dan `/login` → 200, judul "Sahabat Kreator",
  bundle `index-CsCqnH_Y.js`. Render UI terkonfirmasi via teks halaman
  hasil render: /login menampilkan form "Welcome back" (Email/Password),
  /register menampilkan "Create your account" (Full name/Email/Password)
  dalam bahasa Inggris (default). Uji klik UI penuh dari VM tetap dibatasi
  artefak POST proxy egress VM seperti fase sebelumnya.

---

## Update Fase 1D — Skema channel/kontak/inbox + API kontak & percakapan (2026-11-02)

### Perubahan
- DB: migrasi `0004_channels_inbox_schema` (generate) + `0005_rls_channels_inbox`
  (custom, pola RLS 0001) — 6 tabel baru: `channel_accounts`,
  `channel_identities`, `contacts`, `media`, `conversations`, `messages`
  (total 21 tabel, 14 policy RLS). Migrasi dijalankan ke staging via SSH
  port-forward dengan role migrasi dari `.env.staging` (file tidak disentuh).
  Grant `sk_app` atas tabel baru otomatis dari ALTER DEFAULT PRIVILEGES
  Fase 1B — terverifikasi `has_table_privilege`.
- API baru (semua wajib sesi + membership, non-member → 404):
  `POST/GET /api/tenants/:tenantId/contacts`, `GET/PATCH .../contacts/:id`,
  `GET .../conversations(?status=)`, `GET/POST .../conversations/:id/messages`.
  POST pesan = fondasi inbox manual: pesan outbound `sender_type=user`
  berstatus `queued` + audit `message.queued`, **belum dikirim ke channel**
  (stub; pengiriman menunggu adapter channel). Web tidak berubah fase ini.
- Deploy: build API di VM → rsync repo → proses API milik `ubuntu`
  dihentikan → systemd `Restart=always` mengangkat binary baru dari
  `dist` hasil rsync (service `sahabat-kreator-api` active, health ok).

### Verifikasi Fase 1D (publik, dari server terhadap https://botara.my.id)
- Skrip E2E (Python di server, akun uji BARU `fase1d-pub1b@sk.test` &
  `fase1d-pub2b@sk.test`): **18/18 PASS** — sign-up → buat tenant →
  POST kontak 201 → GET daftar/search berisi kontak → PATCH
  (pipeline_stage + opt_in_status) → seed SQL langsung (channel_account
  webchat + conversation + 1 pesan inbound) → GET conversations menampilkan
  nama kontak + cuplikan pesan terakhir → GET messages berisi inbound →
  POST balasan → 201 status `queued` (terkonfirmasi di DB) + audit
  `message.queued` tercatat → urutan pesan kronologis benar → user kedua
  mengakses kontak/conversations tenant pertama → 404 `TENANT_NOT_FOUND` →
  tanpa sesi → 401 → `/api/health` ok.
- Catatan alat uji: request Python `urllib` tanpa User-Agent diblokir
  Cloudflare (403); dengan UA browser lolos. Bukan isu aplikasi.
- PGlite lokal: migrasi 0000–0005 bersih, isolasi RLS `contacts` antar
  tenant terbukti (hanya melihat tenant sendiri; insert lintas ditolak).
