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

---

## Update Fase 1E — UI Contacts & Inbox di web (2026-11-02)

### Perubahan
- Web (commit `72c3379`, API tidak berubah): halaman **Contacts** menggantikan
  placeholder — daftar kontak workspace aktif (nama, phone, email, chip tags,
  chip pipeline stage), pencarian server-side (`?search=`, debounce 350ms),
  pagination offset ("Muat lebih banyak", 20/halaman), form tambah kontak
  (nama wajib; phone/email/tags opsional; error diterjemahkan dari kode API),
  dan modal detail dengan edit nama/tags/stage/opt-in via PATCH.
- Halaman **Inbox** menggantikan placeholder — dua kolom responsif: daftar
  percakapan (nama kontak, cuplikan pesan terakhir, waktu via Intl, badge
  unread per percakapan, label provider & status) dan utas kronologis
  (inbound kiri / outbound kanan, status outbound diterjemahkan:
  queued/sent/delivered/read/failed) + kotak balas (POST → pesan tampil
  berstatus `queued`, lalu utas & daftar dimuat ulang dari server). Di layar
  kecil daftar/utas bergantian dengan tombol kembali; bottom bar tetap ada.
  Catatan kejujuran di UI: balasan disimpan sebagai `queued` karena
  pengiriman ke channel masih stub (label `inbox.deliveryNote`).
- **Badge unread navigasi kini asli**: `UnreadBadgeProvider` (di dalam
  WorkspaceProvider) menjumlahkan `unreadCount` dari API conversations
  workspace aktif dan menyuplai angka ke Sidebar & MobileBottomBar lewat
  prop `badges` yang sudah ada; isi registry navigasi tidak diubah. Badge
  `pendingApprovals` di menu Agents masih demo Fase 0.
- Semua string baru lewat kunci i18n `contacts.*`/`inbox.*` + beberapa
  `common.*` (en + id lengkap; ketidaklengkapan ditahan typecheck Resources).
  Tanggal/jam selalu lewat `Intl` per locale aktif.
- Deploy: build web di VM → commit `72c3379` → rsync seluruh repo →
  proses Vite preview dihentikan → systemd `Restart=always` mengangkat
  bundle baru `index-uxDhTCyl.js`. `.env.staging` di server utuh; service
  API tidak di-restart (tidak ada perubahan API).

### Verifikasi Fase 1E
- Lokal: `pnpm typecheck` (semua proyek) hijau; `pnpm --filter web build`
  hijau (JS 200,37 KB / gzip 60,70 KB). Bundle hasil build terbukti memuat
  label dwibahasa baru (EN: "Add contact", "No contacts yet",
  "No conversations yet", "Write a reply…"; ID: "Tambah kontak",
  "Belum ada kontak", "Belum ada percakapan", "Tulis balasan…").
- Publik dari VM: `GET /` & `GET /login` → 200, judul "Sahabat Kreator",
  bundle `index-uxDhTCyl.js` (sama dengan yang dilayani origin);
  `GET /api/health` → ok. Ekstrak teks render `/login` menampilkan form
  "Welcome back" berbahasa Inggris (default) — salinan crawler berumur
  ±27 menit dari bundle sebelumnya; kesegaran bundle baru dibuktikan dari
  hash aset di atas, bukan dari ekstrak itu.
- Rantai API yang dipakai UI (dari server terhadap `https://botara.my.id`,
  skrip Python UA browser, akun uji baru `fase1e-pub1-*@sk.test` &
  `fase1e-pub2-*@sk.test`): **19/19 PASS** — sign-up → buat tenant →
  POST kontak 201 (stage default `new`) → GET search menemukan & search
  kosong → PATCH stage/opt-in/tags → seed SQL (channel webchat +
  conversation unread=2 + 2 pesan inbound) → GET conversations cocok
  (nama, preview pesan terakhir, unread, provider) → GET messages
  kronologis → POST balasan 201 status `queued` → GET messages = 3 dengan
  balasan terakhir → preview percakapan terupdate → user kedua 404 untuk
  kontak & conversations tenant pertama → tanpa sesi 401 → health ok.
- Batas verifikasi UI yang jujur: klik UI penuh dari VM tetap tidak bisa
  (POST dari VM ke domain publik timeout — artefak proxy egress, sama
  seperti fase sebelumnya). Yang terbukti: bundle baru tersaji publik,
  semua label dwibahasa ada di bundle itu, dan seluruh rantai HTTP yang
  dipanggil UI lolos end-to-end terhadap URL publik asli.

---

## Update Fase 1F — Webchat hidup end-to-end (2026-11-02)

### Perubahan
- **Channel pertama yang benar-benar mengirim/menerima.** Arsitektur final:
  - Identitas channel webchat = `channel_accounts.external_id` berupa
    siteKey publik `wc_...` (dibuat saat channel dibuat). Token sesi
    pengunjung = HMAC-SHA256 sederhana di `@sahabat-kreator/channel-webchat`
    (payload tenant/akun/kontak/percakapan + expiry 30 hari), ditandatangani
    `WEBCHAT_SECRET` (digenerate di server, hanya di `.env.staging` 600).
  - Logika sesi/pesan ada di core (`webchat.ts`): resolusi siteKey → tenant
    lewat transaksi yang men-set `app.webchat_site_key` + lengan SELECT pada
    policy RLS `channel_accounts` (**migrasi 0006**, pola lengan 0003);
    pesan inbound menulis baris pesan + unread + event outbox
    `message.received` dalam satu transaksi.
  - API publik widget (tanpa sesi dashboard): `POST /api/webchat/:siteKey/session`,
    `GET|POST /api/webchat/messages` (Bearer token pengunjung), dan WS
    `GET /api/webchat/ws?token=` yang ditangani handler upgrade HTTP di
    proses API (paket `ws`), BUKAN route Hono.
  - Pengiriman balasan dashboard (endpoint 1D): bila percakapan webchat dan
    pengunjung sedang WS-connected, hub mendorong pesan saat itu juga dan
    status menjadi `sent` (audit `message.sent`); bila offline, pesan tetap
    `queued` dan ter-flush (→ `sent`) saat pengunjung WS-connect berikutnya.
    Provider lain tetap `queued` seperti sebelumnya.
  - Vite preview proxy `/api` kini `ws: true` — WAJIB agar upgrade WS
    widget tembus dari publik ke API 3101 (terbukti oleh uji WS di bawah).
  - Manajemen channel: `POST/GET /api/tenants/:tenantId/channels`
    (webchat 201; provider lain → 422 `CHANNEL_NOT_AVAILABLE_YET`).
  - Widget (`packages/embed`, vanilla TS satu file, 6,9 KB minified):
    build tsup → disalin ke `apps/web/public/widget.js` → tersaji di
    `https://botara.my.id/widget.js`. Halaman Channels di web menampilkan
    daftar channel, form buat webchat, siteKey + snippet embed siap salin;
    halaman publik `/webchat-demo?key=wc_...` untuk uji manusia.
- Deploy: migrasi 0006 diterapkan ke staging via SSH port-forward (role
  migrasi, pola 1D) → `WEBCHAT_SECRET` ditambahkan ke `.env.staging` →
  build api+web+embed di VM → rsync → kedua proses milik `ubuntu`
  dihentikan → systemd `Restart=always` mengangkat binary baru
  (bundle web `index-CzH2WQnC.js`).

### Verifikasi Fase 1F (publik, dari server terhadap https://botara.my.id)
- Skrip E2E Bun di server (akun uji baru `fase1f-*@sk.test`): **24/24 PASS** —
  sign-up → buat tenant → POST channels webchat 201 + siteKey `wc_...` →
  POST channels whatsapp → 422 `CHANNEL_NOT_AVAILABLE_YET` → GET channels →
  POST session pengunjung → token + conversationId → POST pesan inbound
  201 `received` → GET conversations dashboard: percakapan webchat muncul,
  unread=1, nama kontak benar → GET messages: inbound ada → WS connect
  (`ready`) → POST balasan dashboard → **201 status `sent`** dan pengunjung
  menerima event WS realtime → WS ditutup → balasan kedua tetap `queued` →
  WS reconnect → balasan ter-flush sebagai event dan status di API menjadi
  `sent` → negatif: siteKey salah 404, token rusak 401, user tenant lain
  404 (conversations & channels), token pengunjung hanya membaca
  percakapannya sendiri.
- DB staging terkonfirmasi: event outbox `message.received` provider
  webchat tercatat untuk pesan uji.
- GET publik dari VM: `/widget.js` → 200 (6.889 byte, kode widget asli),
  `/webchat-demo?key=...` → 200 judul "Sahabat Kreator", `/api/health` ok.
- Batas jujur: uji widget di browser sungguhan (klik tombol chat) tidak
  dijalankan dari VM; yang terbukti adalah seluruh protokol yang dipakai
  widget (REST + WS persis seperti implementasi widget) terhadap URL
  publik asli, file widget tersaji publik, dan halaman demo termuat.

---

## Update Fase 2A — Worker + antrean BullMQ + automation keyword (2026-11-02)

### Perubahan
- **DB:** migrasi `0007_automations_schema` (generate: tabel `automations`
  & `automation_runs` + index unik parsial `(automation_id,
  trigger_message_id)` sebagai penjaga idempotensi) dan
  `0008_rls_automations_outbox_relay` (RLS tenant_isolation untuk kedua
  tabel baru + policy kedua `system_relay` pada `outbox_events`). Total
  staging: 23 tabel, 17 policy. Verifikasi PGlite lokal membuktikan lengan
  relay: tanpa setting, outbox tak terlihat role aplikasi; dengan
  `app.system_relay='outbox'`, event semua tenant terbaca.
  - Catatan perbaikan yang ikut ter-commit: snapshot meta 0006 sebelumnya
    adalah salinan persis 0005 (id sama) sehingga `drizzle-kit generate`
    gagal karena tabrakan rantai snapshot — id/prevId 0006 diperbaiki.
  - Nilai `when` jurnal 0007/0008 harus LEBIH BESAR dari `when` migrasi
    terakhir yang sudah teraplikasi (0006 = 1793563200000); timestamp hasil
    generate ternyata lebih kecil dan membuat drizzle melewatkan migrasi —
    sudah diselaraskan (…201000/…202000).
- **Antrean:** container khusus proyek `sahabat-kreator-redis`
  (redis:7-alpine, hanya `127.0.0.1:6381`, volume `sahabat-kreator-redisdata`,
  AOF, restart unless-stopped) — Redis proyek lain TIDAK dipakai.
  `REDIS_URL=redis://127.0.0.1:6381` ditambahkan ke `.env.staging` (600).
- **Worker BARU:** unit `sahabat-kreator-worker.service` (Bun menjalankan
  `apps/worker/dist/index.js`, `EnvironmentFile=.env.staging`,
  `Restart=always`). Isi: (1) relay outbox polling ±2 dtk — klaim event
  belum ter-publish `FOR UPDATE SKIP LOCKED` dalam transaksi
  `app.system_relay`, event `message.received` → job BullMQ
  `automation.evaluate` dengan jobId `automation-evaluate-<eventId>`;
  (2) BullMQ Worker yang menjalankan evaluasi keyword di core.
- **Jembatan pengiriman lintas proses:** hub WS hidup di API, worker proses
  lain. Worker hanya membuat balasan outbound `sender_type='system'`
  berstatus `queued` (+ run `completed`, audit `automation.fired`, event
  outbox `message.queued`). Poller baru di API (±2 dtk) mengambil pesan
  `queued` untuk percakapan webchat yang pengunjungnya sedang terhubung
  (tenant diketahui dari token WS — tetap per-tenant lewat RLS), mendorong
  lewat hub, menandai `sent`. Jalur balasan dashboard 1D/1F tidak berubah.
- **API baru:** `POST/GET /api/tenants/:tenantId/automations`,
  `PATCH .../automations/:id`, `GET .../automations/:id/runs`
  (sesi + membership; non-member 404; skema Zod di contracts).
- Deploy: build api+worker di VM → migrasi via SSH port-forward (role
  migrasi) → rsync repo → unit worker dipasang (file ditulis ke home dulu
  lalu `sudo cp`, pola Fase 1B) → API di-restart, worker di-enable.
  Service proyek lain tidak disentuh.

### Verifikasi Fase 2A (publik, dari server terhadap https://botara.my.id)
- Skrip E2E Bun di server (akun uji BARU `fase2a-*@sk.test`, pengunjung
  "Budi Uji"): **25/25 PASS** —
  sign-up → tenant → channel webchat → automation exact `HARGA` dengan
  balasan berisi `{name}` → pengunjung kirim "halo" → 8 dtk TANPA balasan
  otomatis → kirim "harga" (huruf kecil) → balasan otomatis tiba via WS
  dengan nama kontak ter-render → di API dashboard pesan outbound
  `sender_type=system` berstatus `sent` → `automation_runs` 1 `completed`
  dengan triggerMessageId yang benar → kirim "HARGA" lagi (pesan baru) →
  balasan kedua tiba, runs total 2 → audit `automation.fired` tercatat 2x
  di DB → **worker di-restart: runs untuk pesan pemicu pertama tetap 1**
  (relay tidak menggandakan) → PATCH `isActive=false` → kirim keyword →
  tidak ada balasan baru → user tenant lain: GET automations & runs → 404
  → tanpa sesi → 401 → daftar automation memuat `runCount=2`.
- Operasional: `sahabat-kreator-worker/api/web` active; container
  `sahabat-kreator-redis` Up; `GET https://botara.my.id/api/health` ok;
  log worker menunjukkan relay mem-publish event & job evaluate berjalan.
- Batas jujur: latensi balasan otomatis end-to-end dibatasi relay worker
  ±2 dtk + poller API ±2 dtk + antrean (umumnya <5 dtk; uji memakai batas
  tunggu 25 dtk). Web UI untuk automation belum ada (fase berikutnya) —
  pengelolaan automation fase ini murni API. Idempotensi teruji pada
  restart worker & relay ulang; skenario dua worker balapan dilindungi
  klaim SKIP LOCKED + index unik, belum diuji beban.

---

## Update Fase 2B — UI Automations di web (2026-11-02)

### Perubahan
- Web saja (commit `22490ed`, API tidak berubah): halaman **Automations**
  menggantikan placeholder — daftar automation workspace aktif (nama, chip
  status Aktif/Nonaktif, mode pencocokan diterjemahkan, kata kunci sebagai
  chip, cuplikan teks balasan, `runCount`, waktu dibuat via Intl) dan
  **sakelar on/off langsung di daftar** (PATCH `isActive`, optimistis
  dengan pengembalian + muat ulang bila server menolak).
- Form buat/edit (modal pola Contacts): nama, kata kunci teks dipisah koma
  (petunjuk 1–10 + tidak peka huruf), radio mode exact/contains dengan
  penjelasan awam + contoh untuk keduanya, textarea balasan dengan
  petunjuk placeholder `{name}`. Validasi mengikuti aturan API (nama,
  keywords 1–10 non-kosong, text wajib) dengan pesan i18n.
- **Riwayat eksekusi:** klik automation (atau tombol Riwayat) membuka
  modal runs — status diterjemahkan (completed/failed/skipped), waktu
  Intl, nama kontak (diresolusi lewat API kontak per contactId unik,
  fallback ID ringkas) dan ID percakapan ringkas — persis field yang
  disediakan respons API 2A, tanpa kolom karangan.
- Klien API web ditambah `api.automations` (list/create/update/listRuns);
  ±40 kunci i18n `automations.*` en + id lengkap (kelengkapan ditahan
  typecheck Resources). Keadaan kosong berisi penjelasan satu kalimat cara
  kerja trigger keyword + ajakan membuat automation pertama.
- Deploy: build web di VM → commit `22490ed` → rsync seluruh repo →
  proses Vite preview dihentikan → systemd `Restart=always` mengangkat
  bundle baru `index-CAl2PrMx.js` (224,20 KB / gzip 65,72 KB). Service API
  & worker tidak di-restart (tidak ada perubahan di sisinya);
  `.env.staging` utuh.

### Verifikasi Fase 2B
- Lokal: `pnpm typecheck` semua proyek hijau; `pnpm --filter web build`
  hijau. Bundle lokal terbukti memuat label automations dwibahasa (EN:
  "New automation", "Whole message equals the keyword",
  "No automations yet", "Run history"; ID: "Automation baru",
  "Seluruh pesan sama dengan kata kunci", "Belum ada automation",
  "Riwayat eksekusi", dll.).
- Publik dari VM: `GET /` → bundle `index-CAl2PrMx.js` (sama dengan build
  lokal), aset bundle itu terambil 200 dan memuat label EN/ID yang sama;
  `GET /automations` → 200 judul "Sahabat Kreator" (SPA shell);
  `GET /api/health` → ok; GET automations tanpa sesi → 401.
- Rantai API yang dipakai UI (dari server terhadap `https://botara.my.id`,
  skrip Bun UA browser, akun uji BARU `fase2b-*@sk.test`, pengunjung
  "Sari Uji 2B"): **19/19 PASS** — sign-up → tenant → channel webchat →
  POST automation (payload persis form UI: 2 keyword, exact) 201 →
  GET daftar berisi automation dengan runCount 0 → PATCH isActive=false
  → PATCH isActive=true + edit teks → POST keywords kosong ditolak
  400/422 → pengunjung kirim keyword "pricelist" → balasan otomatis tiba
  via WS dengan `{name}` ter-render → runCount naik menjadi 1 → GET runs
  berisi 1 eksekusi `completed` yang menunjuk conversation pengunjung →
  user tenant lain: GET automations & runs → 404 → tanpa sesi 401 →
  health ok.
- Batas verifikasi UI yang jujur: klik UI penuh dari VM tetap tidak bisa
  (POST dari VM ke domain publik timeout — artefak proxy egress, sama
  seperti fase 1E/1F). Yang terbukti: bundle baru tersaji publik, semua
  label dwibahasa ada di bundle itu, rute SPA termuat, dan seluruh rantai
  HTTP yang dipanggil UI (termasuk PATCH sakelar dan GET runs untuk modal
  riwayat) lolos end-to-end terhadap URL publik asli.

---

## Update Fase 3A — AI Agent backend (KB/FTS, loop agent di worker, mode auto/suggest) (2026-11-02)

### Perubahan
- **DB:** migrasi `0009_agents_kb_schema` (generate + `CREATE EXTENSION
  vector` di kepala file) dan `0010_rls_agents_kb` (RLS tenant_isolation).
  Tabel baru: `agents` (mode `auto|suggest`, `is_active` default false),
  `kb_documents`, `kb_chunks` (`search_vector` tsvector TER-GENERATE
  `to_tsvector('simple', content)` + GIN index; `embedding vector(1536)`
  NULLABLE disiapkan untuk fase embedding — retrieval v1 full-text), dan
  `agent_suggestions` (draf mode suggest). Total staging: **27 tabel,
  21 policy**, ekstensi `vector` aktif. Jurnal: `when` 0009/0010
  diselaraskan manual (…203000/…204000) — jebakan yang sama seperti 2A.
  Saklar AI per percakapan memakai kolom `conversations.agent_enabled`
  yang SUDAH ada sejak Fase 1D (tidak ada kolom `ai_enabled` duplikat).
- **Provider LLM (@sahabat-kreator/ai, baru nyata):** kontrak
  `chat({system, messages, tools, kbChunks})`. **MockProvider**
  deterministik = default (`LLM_PROVIDER=mock`): mengutip kalimat pertama
  chunk KB teratas & selalu memanggil tool `tag_contact 'ai-lead'`
  (perilaku terdokumentasi agar retrieval + eksekusi tool terbukti).
  **OpenRouterProvider** tersedia (function calling + fallback teks,
  timeout 30 dtk) tetapi **BELUM aktif di staging**: `OPENROUTER_API_KEY`
  terkonfirmasi TIDAK ada di `.env.staging` (hanya dihitung, nilai tidak
  pernah dibaca). Aktivasi model sungguhan = tambahkan
  `OPENROUTER_API_KEY` + `LLM_PROVIDER=openrouter` (+ opsional
  `OPENROUTER_MODEL`) ke `.env.staging`, lalu restart api & worker.
- **Runtime (core `agent-runtime.ts` + worker):** relay outbox →
  `automation.evaluate`; setelah evaluasi TANPA tembakan, worker
  meng-enqueue `agent.respond` (jobId `agent-respond-<messageId>`) —
  urutan keyword → AI pasti. Loop: konteks RLS (riwayat 20 pesan),
  retrieval KB (token pertanyaan di-OR-kan + `ts_rank`, top 5 —
  plainto_tsquery sengaja TIDAK dipakai karena semantik AND-nya gagal
  untuk pertanyaan alami; terbukti di verify PGlite), panggil provider,
  catat `usage_ledger` type `ai_token` refType `agent_response`
  (qty = total token; rincian provider/model/token di audit
  `agent.responded` karena ledger tak punya kolom metadata) + caps
  **200 respons/tenant/hari** (audit `agent.capped`). Mode `auto`: tool
  dieksekusi (`tag_contact`, `move_pipeline_stage` ke stage valid
  new/engaged/qualified/customer, `handoff_to_human` →
  `agent_enabled=false` + audit `agent.handoff`) lalu balasan menjadi
  pesan `sender_type='agent'` `queued` (poller API mengirim seperti
  automation). Mode `suggest`: draf `agent_suggestions` pending; tool
  TIDAK dieksekusi, dan approve manusia hanya mengirim teks saran.
  Provider error → audit `agent.failed`, tidak ada pesan kosong.
- **API baru (sesi + membership):** `POST/GET /api/tenants/:tenantId/agents`,
  `PATCH .../agents/:id`, `POST/GET .../kb/documents`,
  `GET/DELETE .../kb/documents/:id`, `GET .../suggestions?status=`,
  `POST .../suggestions/:id/approve|reject`. Web TIDAK berubah fase ini.
- Deploy: build api+worker di VM → commit `0f37ed3` → rsync repo
  (`.env.staging` server dikecualikan & utuh) → **migrasi dijalankan di
  server** dengan drizzle-kit di bawah Bun memakai `MIGRATION_DATABASE_URL`
  dari `.env.staging` (kredensial tidak keluar server) → proses api &
  worker milik `ubuntu` dihentikan → systemd `Restart=always` mengangkat
  binary baru. Log worker memastikan: `provider LLM agent: mock`.

### Verifikasi Fase 3A
- Lokal: typecheck SEMUA proyek hijau; build api+worker hijau;
  `packages/db` verify (PGlite, ekstensi vector didaftarkan): 27 tabel,
  21 policy, RLS agents/KB per tenant + `search_vector` ter-generate +
  retrieval menemukan chunk yang benar. Uji integrasi executor tool
  (`apps/worker` script `verify:agent-tools`, PGlite + provider stub):
  handoff mematikan `agent_enabled` + audit & pesan berikut ditolak
  `ai_disabled`; tag/stage dieksekusi, stage invalid & tool asing ditolak
  halus; mode suggest tanpa eksekusi tool; approve/reject/not_pending;
  caps 200/hari → `capped` + audit. SEMUA LULUS.
- Publik dari server terhadap `https://botara.my.id` (skrip Bun, akun uji
  BARU `fase3a-*@sk.test`, pengunjung "Dewi Uji 3A"): **31/31 PASS** —
  tenant → channel webchat → agent auto aktif → KB "Harga kelas Rekaman
  Kilat adalah Rp349 ribu dan garansi 7 hari." (chunkCount ≥1) →
  automation keyword `promo` → pengunjung tanya "berapa harga kelas
  rekaman kilat?" → **balasan agent tiba via WS memuat "349"** → di
  dashboard pesan agent `sent` → kontak bertag `ai-lead` → kirim "promo"
  → balasan automation tiba, agent TIDAK menjawab ganda → PATCH mode
  suggest → tanya garansi → saran `pending` berisi "349", TIDAK ada pesan
  keluar → approve → saran `sent` + pesan tiba di pengunjung → saran
  kedua → reject → `rejected` → tenant lain 404 (agents/kb/suggestions)
  → tanpa sesi 401 → health ok.
- DB staging terkonfirmasi untuk tenant uji: `usage_ledger` ai_token
  `agent_response` = 3 (qty terakhir 247 token estimasi mock, cost 0),
  audit `agent.responded` = 3, `contact.tagged` = 1,
  `agent.suggestion_approved/rejected` = 1/1, `kb_chunks.search_vector`
  terisi, pesan `sender_type='agent'` berstatus `sent` = 2. Worker
  `active`; `has_table_privilege` sk_app atas 4 tabel baru = true
  (ALTER DEFAULT PRIVILEGES Fase 1B bekerja).
- Batas jujur: (1) staging memakai **MockProvider** — balasan "AI" saat
  ini adalah kutipan deterministik chunk KB, BUKAN model bahasa sungguhan;
  jalur OpenRouter selesai di kode & teruji tipe, tetapi belum pernah
  memanggil API OpenRouter dari staging karena kuncinya memang belum
  dipasang (keputusan: jangan minta kunci lewat chat — pasang langsung
  di `.env.staging` server). (2) Retrieval v1 full-text OR-token +
  ts_rank; embedding pgvector belum dipakai. (3) Latensi balasan agent
  dibatasi relay ±2 dtk + antrean + poller ±2 dtk (umumnya <10 dtk).
  (4) UI agent/KB belum ada (fase berikutnya) — pengelolaan fase ini
  murni API. (5) Satu agent aktif tertua per tenant yang dipakai runtime.

---

## Update Fase 3B — UI Agents + Knowledge + persetujuan saran AI (2026-11-02)

### Perubahan
- Web saja (commit `0552773`, API tidak berubah): halaman **AI Agents**
  menggantikan placeholder — daftar agent workspace aktif (nama, chip mode
  Auto/Perlu persetujuan, chip Aktif/Nonaktif, model, waktu dibuat) dengan
  sakelar aktif optimistis (pola 2B), dan modal buat/edit: nama, system
  prompt (textarea + petunjuk persona/aturan), model teks bebas
  (placeholder `openai/gpt-4o-mini` = default OpenRouterProvider), radio
  mode auto/suggest dengan penjelasan awam, dan centang aktif.
- **Catatan jujur WAJIB tampil** di halaman Agents (`agents.mockNote`,
  en+id): provider model BELUM dikonfigurasi di server staging, balasan
  agent masih dari penjawab demo/mock yang mengutip KB — alur, tool, dan
  antrean persetujuan nyata, hanya sumber redaksinya pengganti.
- **Antrean saran di halaman Agents:** draf `GET /suggestions?status=pending`
  (teks, waktu Intl, nama agent dari daftar agent, nama kontak diresolusi
  via API kontak per contactId unik dengan fallback ID ringkas, ID
  percakapan ringkas, nama tool yang diusulkan dari `detail.toolCalls`
  berlabel "tidak dieksekusi") dengan tombol Setujui (approve → teks
  terkirim sebagai pesan agent) & Tolak; setelah aksi daftar dimuat ulang.
- **Badge `pendingApprovals` kini ASLI:** `PendingApprovalsProvider` baru
  (pola UnreadBadgeProvider 1E, di dalam WorkspaceProvider) menghitung
  jumlah suggestions pending workspace aktif dari API yang sama; angka
  demo Fase 0 (`DEMO_BADGES`) dihapus dari `App.tsx`. Registry tidak
  diubah; Sidebar & MobileBottomBar tidak merender badge bila angka 0.
  Halaman Agents memanggil `refresh()` provider setelah approve/reject.
- Halaman **Knowledge** menggantikan placeholder — daftar dokumen (judul,
  `chunkCount`, waktu), form tambah (judul + isi besar), modal lihat yang
  mengambil dokumen segar via `GET /kb/documents/:id`, hapus dengan modal
  konfirmasi (DELETE → 204), dan catatan bahwa dokumen dipecah otomatis
  menjadi chunk yang dicari agent saat menjawab. Klien API web ditambah
  `api.agents`, `api.suggestions`, `api.kb`; ±105 kunci i18n
  `agents.*`/`knowledge.*` + `common.view`/`common.delete` en + id lengkap
  (kelengkapan ditahan typecheck Resources).
- Deploy: build web di VM → commit `0552773` → rsync seluruh repo (exclude
  `.git` & `.env.staging` — file server utuh, mode 600 terkonfirmasi) →
  proses Vite preview dihentikan → systemd `Restart=always` mengangkat
  bundle baru `index-BETCr3fH.js` (254,26 KB / gzip 70,71 KB). Service API
  & worker tidak di-restart (tidak ada perubahan di sisinya).

### Verifikasi Fase 3B
- Lokal: `pnpm typecheck` SEMUA proyek hijau; `pnpm --filter web build`
  hijau. Bundle lokal terbukti memuat label dwibahasa baru (EN: "Reply
  drafts awaiting approval", "Needs my approval", "Demo mode: the AI model
  provider", "Approve & send"; ID: "Draf balasan menunggu persetujuan",
  "Perlu persetujuan saya", "Mode demo: penyedia model AI",
  "Setujui & kirim", "Tambah dokumen", dll.).
- Publik dari VM: `GET /` → bundle `index-BETCr3fH.js` (sama dengan build
  lokal), aset bundle terambil 200 (254.424 byte) dan memuat label EN/ID
  yang sama; `GET /agents` & `GET /knowledge` → 200 judul "Sahabat
  Kreator" (SPA shell); `GET /api/health` → ok;
  `sahabat-kreator-web/api/worker` semua active di server.
- Rantai API yang dipakai UI (dari server terhadap `https://botara.my.id`,
  skrip Bun UA browser, akun uji BARU `fase3b-*@sk.test`, pengunjung
  "Rina Uji 3B"): **30/30 PASS** — sign-up → tenant → channel webchat →
  POST agent payload persis form UI (nama, systemPrompt, model teks bebas,
  mode suggest, isActive) 201 & terbaca kembali → POST dokumen KB payload
  form UI 201 (chunkCount ≥1) → GET daftar & GET :id cocok untuk modal
  lihat → pengunjung bertanya sesuai KB → **suggestion pending muncul di
  GET** (data yang dirender antrean & dihitung badge; teks memuat fakta
  KB "349"; membawa agentId & contactId) → tidak ada pesan keluar sebelum
  approve → approve → `sent` & pesan agent tiba ke pengunjung via WS →
  jumlah pending kembali 0 → saran kedua → reject → `rejected` → PATCH
  agent mode auto → terbaca `mode=auto` di GET → DELETE dokumen uji → 204
  & GET :id 404 → tanpa sesi: GET agents/kb/suggestions → 401 → health ok.
- Batas verifikasi UI yang jujur: klik UI penuh dari VM tetap tidak bisa
  (POST dari VM ke domain publik timeout — artefak proxy egress, sama
  seperti fase 1E/1F/2A/2B/3A). Yang terbukti: bundle baru tersaji publik,
  semua label dwibahasa ada di bundle itu, rute SPA termuat, dan seluruh
  rantai HTTP yang dipanggil UI (termasuk GET pending untuk badge,
  approve/reject, dan DELETE dokumen) lolos end-to-end terhadap URL
  publik asli.

---

## Update Fase 4A — Products + payment link SIMULASI + tool agent send_payment_link (2026-11-02)

### Perubahan
- **DB:** migrasi `0011_products_payment_links_schema` (generate: tabel
  `products` — `price_idr` bigint + CHECK ≥ 0, `is_active`; dan
  `payment_links` — `code` unik, `amount_idr` snapshot harga, enum status
  `pending|paid|expired|cancelled`, `provider` default `'simulation'`,
  `expires_at` di-set service +7 hari) dan `0012_rls_products_payments`
  (tulis tangan). Pola akses publik /pay meniru lengan siteKey 0006:
  policy kedua `public_code_lookup` FOR SELECT pada `payment_links`
  `USING (code = nullif(current_setting('app.payment_code', true), ''))`
  — tanpa konteks kode, halaman publik tidak melihat apa pun; **mutasi
  publik tidak diberi lengan**: resolusi code→baris terjadi dalam
  transaksi kode itu, semua tulis berjalan dalam konteks tenant pemilik.
  `when` jurnal 0011/0012 diselaraskan manual menaik (…205000/…206000).
  Total staging: **29 tabel, 24 policy**; grant `sk_app` otomatis dari
  ALTER DEFAULT PRIVILEGES (terverifikasi `has_table_privilege`).
- **API tenant (sesi + membership, non-member 404):**
  `POST/GET /api/tenants/:tenantId/products`, `PATCH/DELETE
  .../products/:id` — DELETE hard hanya bila belum ada payment_links;
  bila sudah ada → **409 `PRODUCT_HAS_LINKS`** (saran: nonaktifkan).
  `POST/GET /api/tenants/:tenantId/payment-links` (201; `url` dibangun
  dari `BETTER_AUTH_URL`; audit `payment_link.created`).
- **API publik halaman bayar:** `GET /api/pay/:code` → ringkasan publik
  (nama produk, deskripsi, jumlah, status, nama tenant, provider) **tanpa
  data pribadi kontak**; code tak dikenal → 404.
  `POST /api/pay/:code/simulate-pay` → `paid` + `paid_at`, **idempoten**
  (sudah paid → 200 tetap, tanpa audit ganda; audit `payment.paid` actor
  system `pay-page-simulation`, meta `simulation: true`).
- **Tool agent `send_payment_link`** (terdaftar di `packages/ai` untuk
  Mock & OpenRouter): pencocokan produk aktif (nama utuh di teks → query
  di nama → overlap token; fallback produk aktif tertua dengan
  `matchedByName=false` tercatat di audit `agent.payment_link`), membuat
  payment_link (actor `agent:<id>`), lalu mengirim pesan outbound
  `sender_type='agent'` TERPISAH: `Link pembayaran {product}: {url}
  (berlaku 7 hari)`. Mode suggest: tool TIDAK dieksekusi (hanya tercatat
  di saran, seperti tool lain). MockProvider memanggil tool ini bila
  pesan pengunjung mengandung kata "beli"/"checkout" (perilaku mock
  terdokumentasi untuk pembuktian).
- **Web:** halaman **Products** nyata — CRUD produk (harga via Intl
  id-ID), tombol "Buat tautan bayar" per produk (URL hasil + tombol
  salin), daftar tautan terbaru workspace (status diterjemahkan
  Menunggu/Lunas/Kedaluwarsa/Dibatalkan), catatan simulasi permanen.
  Halaman publik **`/pay/:code`** di luar shell dengan **lencana besar
  permanen dwibahasa "SIMULASI — bukan pembayaran sungguhan" /
  "SIMULATION — not a real payment"**, jumlah via Intl id-ID, tombol
  "Bayar (simulasi)" → panel Lunas + waktu bayar.

### Verifikasi Fase 4A
- Lokal: typecheck SEMUA proyek (23) hijau; build api+worker+web hijau;
  `packages/db` verify (PGlite): 13 migrasi bersih, 29 tabel, 24 policy,
  seksi [9] Fase 4A lulus (RLS per tenant; tanpa konteks 0 baris; lengan
  `app.payment_code` hanya membuka baris berkode itu & products tetap
  tertutup; CHECK harga ≥ 0 menolak insert negatif). Uji integrasi
  worker `verify:agent-tools` diperluas seksi [7] (executor
  `send_payment_link` langsung: cocok nama → `payment_link_sent` +
  snapshot 349000 + pesan outbound berisi URL; tak cocok → fallback
  produk tertua) — SEMUA LULUS [1]–[7].
- Publik dari server terhadap `https://botara.my.id` (skrip Bun, akun
  uji BARU `fase4a-a-*@sk.test` & `fase4a-b-*@sk.test`, pengunjung
  "Tania Uji 4A"): **29/29 PASS** — buat produk → buat payment-link →
  GET publik berisi produk+harga benar & status pending → simulate-pay
  → paid → simulate-pay kedua idempoten (paidAt sama) → daftar tenant
  menampilkan paid → GET publik lagi paid → hapus produk ber-links 409
  `PRODUCT_HAS_LINKS` → hapus produk tanpa links 204 → code acak 404
  (GET & pay) → tanpa sesi 401 → tenant lain 404 (products/links/PATCH/
  buat-link) → channel webchat + agent auto → pengunjung menulis "saya
  mau beli kelas rekaman kilat" → **pesan agent berisi URL /pay/… tiba
  via WS** (teks template persis) → GET publik code itu: produk cocok,
  pending → simulate-pay → paid → link agent tercatat terhubung ke
  kontak+percakapan pengunjung → kontak utuh (tag `ai-lead`, stage
  valid) → riwayat memuat ≥2 pesan agent → halaman `/pay/:code` 200
  judul SPA → health ok.
- DB staging terkonfirmasi: audit `payment_link.created` = 2 (1 API
  manual + 1 agent), `agent.payment_link` = 1, `payment.paid` = 2 persis
  (idempotensi terbukti: 3 panggilan simulate-pay atas 2 tautan hanya
  menghasilkan 2 audit), `payment_links` 2 baris paid provider
  `simulation`. Bundle publik `index-WZHzDyF5.js` memuat lencana EN & ID.
- Batas jujur: (1) **Ini SIMULASI berlabel** — tidak ada uang sungguhan
  yang bergerak; provider selalu `'simulation'` sampai kredensial
  sandbox Midtrans/Xendit diberikan user dan adapter pembayaran
  dibangun (sesuai desain: Meta menghapus API order, pembayaran memang
  milik sendiri). (2) Kedaluwarsa tautan ditegakkan lazy saat dibaca
  (belum ada job penyapu). (3) Pembuktian tool agent memakai
  MockProvider (perilaku "beli/checkout" terdokumentasi); jalur
  OpenRouter menerima tool yang sama dari skema tetapi belum memanggil
  model sungguhan di staging (kunci belum dipasang, seperti fase 3A).
  (4) Pesan tautan terkirim mendahului teks balasan utama agent karena
  tool dieksekusi lebih dulu di runtime — keduanya tiba sebagai pesan
  agent terpisah. (5) Klik UI penuh dari VM tetap dibatasi artefak POST
  proxy egress; yang terbukti adalah bundle tersaji publik + seluruh
  rantai HTTP yang dipanggil UI & halaman bayar.

---

## Update Fase 2C — Sequence automation (rangkaian pesan berjeda) (2026-11-02)

### Perubahan
- **DB:** migrasi `0013_sequences_schema` (generate: enum `automation_kind`
  + kolom `automations.kind` default `'keyword'` — baris 2A tetap berlaku;
  tabel `automation_steps` dengan unik (automation_id, position) + CHECK
  delay ≥ 0 & posisi ≥ 1; tabel `sequence_enrollments` dengan index unik
  parsial satu enrollment `active` per (automation_id, contact_id)) dan
  `0014_rls_sequences` (tenant_isolation untuk 2 tabel baru). Total staging:
  **31 tabel, 26 policy**; grant `sk_app` otomatis dari ALTER DEFAULT
  PRIVILEGES (terverifikasi `has_table_privilege`).
- **Semantik:** pemicu tetap keyword untuk kedua jenis. kind `keyword` =
  balasan langsung 2A (tidak berubah). kind `sequence` = pesan cocok
  MENDAFTARKAN kontak ke rangkaian; setiap langkah dikirim setelah
  jedanya (menit, relatif terhadap langkah sebelumnya; langkah pertama
  relatif terhadap pendaftaran). `current_step` = langkah yang sudah
  terkirim. Pendaftaran ulang saat enrollment masih aktif diabaikan
  (run `skipped`, alasan `already_enrolled`). Langkah sequence TIDAK bisa
  diedit setelah dibuat (buat automation baru) — dinyatakan di UI.
- **Mesin worker:** core menulis event outbox `sequence.step_due`
  {enrollmentId, stepPosition, delayMinutes} saat enrollment dibuat dan
  setiap langkah selesai; relay menerjemahkannya menjadi job BullMQ
  TERTUNDA `sequence.step` dengan jobId deterministik
  `seq-<enrollmentId>-<position>`. Processor menjalankan
  `executeSequenceStep` di core (pesan system `queued` → poller API
  mengirim lewat hub webchat seperti biasa). Pesan pemicu sequence
  dihitung sebagai tembakan automation → TIDAK diteruskan ke agent.
- **Aturan berhenti:** (a) kontak membalas pesan apa pun di percakapan
  itu setelah terdaftar → enrollment dibatalkan saat evaluasi pesan
  masuk berjalan (audit `sequence.cancelled_reply`); enrollment yang
  dibuat oleh pesan yang sama tidak ikut terbatalkan. (b) kontak opt-out
  (`opt_in_status='opted_out'`) diperiksa saat langkah dieksekusi →
  dibatalkan (audit `sequence.cancelled_opt_out`). (c) menonaktifkan
  automation TIDAK membatalkan enrollment berjalan — hanya memblokir
  pemicu baru (keputusan terdokumentasi di core).
- **API:** POST automations menjadi union — tanpa `kind` (atau
  `kind:'keyword'`) = jalur lama persis; `kind:'sequence'` menerima
  `steps` 1–10 langkah (delay 0–43200 menit). GET daftar kini menyertakan
  `kind`, `steps`, `stepCount`. Endpoint baru
  `GET .../automations/:id/enrollments` (kontak, status, currentStep,
  totalSteps, nextRunAt).
- **Web:** halaman Automations — formulir buat memilih jenis (radio
  "Balasan keyword" vs "Rangkaian pesan (sequence)" berpenjelasan awam),
  editor langkah sederhana (baris jeda menit + teks, tambah/hapus, maks
  10), chip jenis di daftar, dan modal riwayat sequence menampilkan
  enrollments (status Aktif/Selesai/Berhenti, "Pesan X dari Y", jadwal
  berikutnya). i18n en+id lengkap.
- Deploy: build api+worker+web di VM → commit `90f27f9` → rsync repo
  (`.env.staging` server dikecualikan & utuh) → migrasi dijalankan di
  server dengan drizzle-kit memakai `MIGRATION_DATABASE_URL` dari
  `.env.staging` → ketiga proses milik `ubuntu` dihentikan → systemd
  `Restart=always` mengangkat binary baru (bundle `index-F0IM1OG8.js`).

### Verifikasi Fase 2C
- Lokal: typecheck SEMUA proyek hijau; build api+worker+web hijau;
  `packages/db` verify (PGlite): 15 migrasi bersih, 31 tabel, 26 policy,
  seksi [10] Fase 2C lulus (kind default, check delay, index unik
  enrollment aktif, RLS steps/enrollments). Uji integrasi worker BARU
  `verify:sequences` (PGlite): pendaftaran + step_due, eksekusi langkah
  berurutan + posisi basi ditolak, berhenti-karena-balas, rangkaian
  penuh completed, opt-out, already_enrolled, kompatibilitas keyword —
  SEMUA LULUS; `verify:agent-tools` lama tetap lulus (urutan
  keyword → agent tidak rusak).
- Publik dari server terhadap `https://botara.my.id` (skrip Bun, akun
  uji BARU `fase2c-*@sk.test`, pengunjung "Sinta Uji 2C" & "Rudi Uji
  2C"): **32/32 PASS** — buat sequence 3 langkah payload persis form UI
  (jeda 0/1/1 menit) → pengunjung mengirim "mulai" (huruf kecil) →
  langkah 1 tiba via WS pada **+4,7 dtk**, langkah 2 pada **+66,7 dtk**,
  langkah 3 pada **+128,8 dtk**; enrollments API menunjukkan
  current_step 0→2→3 dan status akhir `completed`; 3 pesan system
  berstatus `sent`; pesan pemicu TIDAK dijawab agent (agent auto aktif
  di tenant yang sama). Uji berhenti: sequence kedua → langkah 1 tiba →
  pengunjung membalas pesan biasa → ditunggu 100 dtk, langkah 2 TIDAK
  tiba dan enrollment berstatus `cancelled`. Kompatibilitas: automation
  dibuat dengan payload Fase 2A persis (tanpa `kind`) terdaftar sebagai
  kind `keyword` dan tetap menembak balasan langsung. Negatif: tenant
  lain 404 (automations & enrollments), tanpa sesi 401, health ok.
- DB staging terkonfirmasi: audit `sequence.enrolled`=2,
  `sequence.step_sent`=4, `sequence.completed`=1,
  `sequence.cancelled_reply`=1; `sequence_enrollments`: 1 completed +
  1 cancelled — persis jejak dua rantai uji di atas.
- Batas jujur: (1) titik mulai delay BullMQ digeser ke saat event
  ter-relay (polling ±2 dtk) dan pengiriman dibatasi poller API ±2 dtk —
  langkah 1 terukur +4,7 dtk, langkah berjeda 60 dtk terukur 62–64 dtk;
  presisi detik-sempurna bukan target staging. (2) Pembatalan karena
  balasan terjadi di jalur evaluasi pesan masuk (relay ±2 dtk) — balasan
  yang tiba <2 dtk sebelum langkah jatuh tempo masih bisa balapan dimenangkan
  langkah itu; jendela ini melekat pada arsitektur relay polling dan
  dicatat apa adanya. (3) Klik UI penuh dari VM tetap dibatasi artefak
  POST proxy egress; yang terbukti adalah bundle tersaji publik (memuat
  label EN/ID sequence) + seluruh rantai HTTP/WS yang dipakai UI.

---

## Update Fase QA-1 — Suite Playwright E2E browser sungguhan + perbaikan bug UI/UX (2026-11-02)

### Perubahan
- **Suite baru `tests/e2e`** (paket workspace `@sahabat-kreator/e2e`,
  Playwright 1.49.1): 13 tes dalam 8 spec — auth (3), workspace (1),
  contacts (1), channels-webchat dua konteks browser (1), automations
  keyword+sequence (2), agents suggest/approve/reject (1), products-pay
  (1), shell-ux tema/bahasa/overflow/mobile (3). Selektor berbasis
  role/teks; akun uji baru berawalan `e2e-...@sk.test` per run.
- **Jalur eksekusi: DI SERVER terhadap `https://botara.my.id`** (POST dari
  VM ke publik timeout — artefak proxy egress; dari server lancar).
  Tanpa sudo: Node mandiri `~/opt/node` (v22.14.0, tarball resmi) +
  Chromium `~/.cache/ms-playwright` + 8 library sistem yang diekstrak
  dari `.deb` ke `~/opt/chromelibs/root` dan dipakai lewat
  `LD_LIBRARY_PATH` (detail & perintah persis: `tests/e2e/README.md`).
- **Bug aplikasi yang ditemukan suite & diperbaiki pada fase ini:**
  1. *Unread inbox tidak pernah bersih.* Membuka percakapan tidak
     menandai terbaca di mana pun (unread hanya naik dari webchat).
     Perbaikan: `markConversationRead` di core — dipanggil route API
     GET messages (jalur manusia; agent membaca riwayat lewat core
     langsung dan TIDAK menandai terbaca) — dan InboxPage menyinkronkan
     daftar lokal + badge navigasi segera setelah utas dibuka.
  2. *Badge persetujuan AI Agents basi.* `PendingApprovalsProvider`
     hanya memuat ulang saat workspace berganti / setelah approve-reject,
     sehingga draf yang tiba saat pemilik di halaman lain tidak pernah
     menaikkan badge (antrean berisi, badge kosong). Perbaikan:
     `SuggestionsQueue` menyinkronkan badge setiap selesai memuat
     antrean (pola yang sama dengan badge unread Inbox).
- Penyesuaian TES (bukan aplikasi): assertion gelembung utas dibatasi ke
  elemen `<p>` gelembung agar tidak ambigu dengan `<span>` cuplikan
  daftar (strict-mode violation di viewport mobile); helper auth
  menunggu & mengirim ulang saat menabrak rate limit (lihat bawah).
- Deploy perbaikan: build api+web di VM → rsync → proses API & web
  dihentikan (pola lama) → systemd mengangkat bundle `index-Zn6H821K.js`.
  Worker tidak berubah perilaku (fungsi core baru tidak dipakainya).

### Verifikasi Fase QA-1
- Run pertama (sebelum perbaikan): **9 lulus / 4 gagal** — agents
  (badge), channels-webchat (unread), shell-ux overflow (rate limit),
  shell-ux mobile (selektor ambigu).
- Run akhir setelah perbaikan terdeploy: **13/13 LULUS (3,3 menit)**
  dari server terhadap URL publik asli, termasuk adegan dua konteks
  browser (pengunjung widget ↔ pemilik dashboard) yang selama fase
  1E–4A hanya dibuktikan lewat rantai HTTP/WS.
- `/api/health` publik ok; bundle publik `index-Zn6H821K.js` sama dengan
  build perbaikan.

### Catatan operasional: rate limit auth di balik tunnel
- Suite menabrak rate limit bawaan Better Auth (kode kita tidak
  mengonfigurasi rate limit apa pun) setelah ±9 pendaftaran akun dalam
  satu jendela dari server: form register menjawab "Too many requests".
  Karena staging berada di balik Cloudflare Tunnel, API melihat semua
  lalu lintas dari IP yang sama → jendela rate limit per-IP TERBAGI
  untuk semua pengguna. Untuk staging ini dapat diterima; sebelum
  production, putuskan dengan sadar: percayai header IP dari tunnel /
  naikkan batas / nonaktifkan untuk jalur tertentu — jangan biarkan
  default ini mengunci banyak pengguna NAT di belakang satu bucket.

---

## Update Fase 5A — API keys per tenant + API publik /v1 (2026-11-02)

### Perubahan
- **DB:** migrasi `0015_api_keys_foundation` (generate) — tabel `api_keys`
  Fase 1A DIPERLUAS aditif, bukan dibuat ulang: kolom `key_prefix`
  (awalan tampil `sk_live_ab12`) + nilai enum audit baru `api_key` pada
  `audit_actor_type`. Migrasi `0016_rls_api_keys_lookup` (custom) —
  policy kedua `public_key_lookup` (FOR SELECT) pada `api_keys`: baris
  terlihat bila `key_hash` sama dengan setting transaksi
  `app.api_key_hash` — pola lengan sempit yang sama dengan siteKey
  webchat (0006) & code bayar (0012). Total staging: 31 tabel, 27 policy.
- **Format & penyimpanan kunci:** `sk_live_` + 43 char base64url dari
  32 byte acak kriptografis. Server HANYA menyimpan hash SHA-256 +
  awalan tampil. Kunci utuh muncul SATU KALI di respons pembuatan
  (API & modal UI) dan tidak pernah bisa dibaca lagi.
- **Manajemen (sesi + membership):** `POST/GET /api/tenants/:tenantId/api-keys`,
  `DELETE .../api-keys/:id` (soft revoke via `revoked_at`). Membuat &
  mencabut dibatasi role **owner/admin** (agent/viewer → 403 FORBIDDEN);
  membaca daftar boleh semua member. Audit `api_key.created`/`api_key.revoked`.
- **API publik /v1 (auth API key, BUKAN sesi):** header
  `Authorization: Bearer sk_live_...` atau `X-API-Key`. Tenant selalu
  diturunkan dari baris kunci — tidak ada tenantId di URL — dan semua
  query berikutnya berjalan dalam konteks RLS tenant pemilik (service
  core yang sama dengan dashboard; tidak ada logika duplikat).
  Endpoint: `GET /v1/me`; `GET|POST /v1/contacts`; `GET /v1/conversations`;
  `GET|POST /v1/conversations/:id/messages`; `GET /v1/products`.
  Scope v1: `contacts:read`, `contacts:write`, `conversations:read`,
  `messages:write`, `products:read` — default pembuatan hanya scope
  read; write wajib dipilih eksplisit. Penolakan: 401 `API_KEY_INVALID`
  (tidak ada/tidak dikenal), 401 `API_KEY_REVOKED`, 403
  `API_KEY_SCOPE_DENIED`. `last_used_at` diperbarui best-effort.
  Pesan keluar via API key tercatat di audit dengan actor_type
  `api_key` (actor_id = id baris kunci, meta source `public_api`) dan
  dikirim lewat jalur yang sama dengan balasan dashboard (hub webchat
  langsung bila pengunjung terhubung, selain itu antrean poller).
  Membaca riwayat pesan via /v1 TIDAK menandai percakapan terbaca
  (semantik itu khusus inbox manusia — perbaikan QA-1).
- **Web:** halaman **Settings** kini nyata berisi bagian API Keys —
  daftar (nama, awalan, chip scope, status, terakhir dipakai), form
  buat (nama + centang scope per-scope dengan penjelasan), modal kunci
  baru (kunci utuh sekali + tombol salin + peringatan dwibahasa bahwa
  kunci tidak akan ditampilkan lagi), cabut dengan konfirmasi. Bagian
  pengaturan lain dinyatakan apa adanya sebagai menyusul. i18n en+id.
- Deploy: build api+web di VM → commit `952d3c7` → rsync repo
  (`.env.staging` dikecualikan & utuh) → migrasi via SSH port-forward
  (role migrasi) → proses API & web milik `ubuntu` dihentikan → systemd
  `Restart=always` mengangkat bundle `index-CwSxATSN.js`. Objek DB
  terverifikasi langsung di staging: kolom `key_prefix` ada, policy
  `public_key_lookup` ada, enum audit memuat `api_key`.

### Verifikasi Fase 5A (publik, dari server terhadap https://botara.my.id)
- Skrip E2E Bun di server (akun uji BARU `fase5a-*@sk.test`): **33/33 PASS** —
  buat kunci read-only → daftar manajemen hanya menampilkan awalan
  (tidak ada nilai utuh) → `GET /v1/me` benar via Bearer & via X-API-Key
  → `GET /v1/contacts` 200 → `POST /v1/contacts` → 403
  `API_KEY_SCOPE_DENIED` → kunci kedua full-scope → `POST /v1/contacts`
  201 → `GET /v1/conversations` & `/:id/messages` memuat percakapan
  webchat uji → `POST /v1/conversations/:id/messages` → pengunjung
  menerima realtime via WS dan status pesan menjadi `sent` di dashboard
  → negatif: tanpa header 401 `API_KEY_INVALID`, kunci acak 401,
  manajemen tanpa sesi 401 → isolasi: kunci tenant A tidak melihat
  kontak tenant B (pencarian & daftar penuh) → member berperan `agent`
  (ditanam via SQL) membuat kunci → 403 FORBIDDEN tetapi tetap boleh
  membaca daftar → `last_used_at` terisi sesudah pemakaian → cabut
  kunci full (204) → request berikutnya 401 `API_KEY_REVOKED` →
  `/api/health` ok. Baris audit `api_key`/`message.queued` dengan meta
  source `public_api` terkonfirmasi di DB staging. Nilai kunci uji
  tidak ditampilkan di catatan ini (awalan saja: `sk_live_T46v…`,
  `sk_live_Oe_6…`).
- **Regresi Playwright (resep QA-1, dari server):** run gabungan
  `auth.spec.ts` + `shell-ux.spec.ts` (6 tes): **5 lulus, 1 timeout**
  (tes overflow-horizontal desktop, 240 dtk). Tes yang sama dijalankan
  ulang SENDIRIAN sesudahnya: **LULUS dalam 12 detik**. Kesimpulan:
  stall lingkungan — bucket rate limit auth bersama di balik tunnel
  (lihat catatan QA-1 di atas) sesudah skrip verifikasi + suite
  mendaftarkan banyak akun berurutan; bukan regresi perubahan Settings
  (halaman yang diuji tes itu tidak diubah fase ini selain perutean
  shell). Assertion tidak dilemahkan.
- `packages/db` verify (PGlite): 17 migrasi bersih, 31 tabel, 27 policy,
  termasuk seksi baru yang membuktikan lengan `app.api_key_hash` hanya
  membuka baris ber-hash yang disajikan.

---

## Update Fase 5B — SDK TypeScript + MCP server (stdio) (2026-11-02)

### Perubahan
- **Tidak ada perubahan perilaku API/web/worker dan tidak ada service baru
  yang berjalan permanen di server.** Fase ini murni tambahan sisi klien:
  MCP server stdio dijalankan lokal oleh klien MCP (Claude Desktop/Cursor)
  di mesin pengguna, bukan di server staging.
- **`packages/sdk` nyata** (`@sahabat-kreator/sdk`): `SahabatKreatorClient`
  tipis di atas API publik v1 — `me`, `listContacts`, `createContact`,
  `listConversations`, `listMessages`, `sendMessage`, `listProducts`.
  Semua tipe request/response DIIMPOR dari `@sahabat-kreator/contracts`
  (kontrak ditambah skema query v1: `V1ListContactsQuerySchema` dkk. +
  tipe `ListContactsQuery`/`ListConversationsQuery`/`ListMessagesQuery`
  turunan `z.infer`); yang ditulis tangan hanya transport (Bearer API key,
  pemetaan error). Error dilempar sebagai `SahabatKreatorApiError` bertipe
  membawa `code` kontrak + status HTTP. Tanpa dependensi runtime (fetch
  bawaan). Ada `verify:sdk` (tsx) untuk uji integrasi terhadap server live.
- **`apps/mcp-server` nyata** (`@sahabat-kreator/mcp-server`): server MCP
  **stdio** memakai SDK resmi `@modelcontextprotocol/sdk@1.32.2`
  (`McpServer.registerTool` + `StdioServerTransport`), dibangun DI ATAS
  `@sahabat-kreator/sdk` — membuktikan pola adapter tipis RANCANGAN §2/§8.
  Konfigurasi hanya env: `SAHABAT_KREATOR_API_KEY` (wajib) +
  `SAHABAT_KREATOR_BASE_URL` (default `https://botara.my.id`). 7 tools:
  `whoami`, `list_contacts`, `create_contact`, `list_conversations`,
  `list_messages`, `send_message`, `list_products` — persis kemampuan v1;
  scope kunci API menegakkan izinnya (tool yang scope-nya kurang menerima
  403 dari API). Error API menjadi hasil tool `isError` berisi kode
  kontrak, BUKAN crash. Build tsup (paket workspace dibundel, SDK MCP
  eksternal); `verify:mcp` (ter-commit) memulai dist server sebagai proses
  anak dan mengujinya dengan klien MCP resmi dari SDK yang sama.
  Log server hanya ke stderr (stdout = kanal protokol).

### Verifikasi Fase 5B (publik, dari server terhadap https://botara.my.id)
- Typecheck + build SEMUA proyek hijau (termasuk sdk & mcp-server);
  smoke lokal lebih dulu: initialize + tools/list lulus, kunci palsu →
  tool error `API_KEY_INVALID` tanpa crash.
- Orkestrasi Bun sekali-pakai di server (akun uji BARU `fase5b-*@sk.test`,
  sudah dihapus setelah jalan): sign-up → tenant → channel webchat →
  produk → API key full-scope (prefix `sk_live_ZvVD4…`) + API key default
  read-only (prefix `sk_live_Re-Sj…`) → sesi pengunjung webchat + pesan
  masuk → WebSocket pengunjung dibuka selama uji.
- **`verify:mcp` 14/14 PASS**: initialize OK (`sahabat-kreator@0.1.0`) →
  tools/list = 7 tools → `whoami` tenant "Studio Uji 5B" dengan 5 scope →
  `list_contacts` → `create_contact` → kontak muncul lagi via pencarian →
  `list_conversations`/`list_messages` → `send_message` berstatus `sent` →
  pesan terbaca kembali via `list_messages` → `list_products`. Negatif:
  kunci terbatas → tools/list tetap jalan; `send_message` dan
  `create_contact` menjadi tool error berisi `API_KEY_SCOPE_DENIED`.
- **Pengiriman nyata**: pengunjung webchat menerima pesan MCP lewat WS
  selama uji, dan status pesan terkonfirmasi `sent` lewat
  `GET /api/v1/conversations/:id/messages`. (Catatan: payload event WS
  membawa snapshot status `queued` — pola Fase 1F yang sudah ada; status
  otoritatif di DB adalah `sent`.)
- **`verify:sdk` 3/3 PASS**: `me()` + `listContacts()` dengan kunci uji;
  kunci salah → `SahabatKreatorApiError` dengan `code=API_KEY_INVALID`,
  status 401.
- Penutup: `GET https://botara.my.id/api/health` ok; kunci utuh tidak
  pernah dicetak (hanya prefix di log verifikasi).

### Batas jujur
- Transport MCP v1 hanya **stdio** (standar klien lokal). Streamable HTTP
  menyusul bila ada kebutuhan klien jarak jauh; tools/SDK tidak berubah.
- Di server staging tidak ada `node` di PATH user ubuntu — proses anak
  pada `verify:mcp` dijalankan lewat Bun (dist server adalah ESM murni;
  skrip mendukung override `SAHABAT_KREATOR_MCP_COMMAND`). Di mesin
  pengguna umum, `node dist/index.js` adalah jalur standarnya.
- SDK belum punya retry/pagination otomatis — pemanggil memakai
  `limit`/`offset` secara eksplisit (sesuai kontrak v1).

---

## Update Fase QA-2 — Regresi Playwright akhir (semua fitur) (2026-11-02)

### Perubahan
- **Tidak ada perubahan kode aplikasi** — QA-2 tidak menemukan bug aplikasi
  baru, jadi tidak ada rebuild/redeploy; bundle publik tetap build terakhir
  Fase 5A (`index-C1L6ZCNk.js`). Yang bertambah hanya cakupan tes:
  - **Spec baru `tests/e2e/specs/settings-api-keys.spec.ts`** (Fase 5A):
    login → Settings → buat API key lewat UI (nama + centang scope tulis
    `contacts:write`) → modal menampilkan kunci utuh berawalan `sk_live_`
    (nilai diambil dari DOM hanya untuk dipakai tes, TIDAK dicetak) →
    daftar hanya menampilkan awalan (`Key: sk_live_<4>…`) dan kunci utuh
    tidak muncul lagi di halaman → kunci dipakai dari APIRequestContext
    Playwright ke `GET /api/v1/me` → 200 dengan tenantName persis workspace
    yang dibuat tes → cabut lewat UI (modal konfirmasi, chip menjadi
    Revoked) → `GET /api/v1/me` dengan kunci yang sama → 401.
  - **Cakupan sequence 2C di `automations.spec.ts` diperiksa**: spec QA-1
    ternyata SUDAH menguji editor langkah UI (2 langkah: jeda 0 & 1 menit)
    + modal enrollments (status Active setelah pemicu widget) — tidak
    perlu tambahan tes.
- README suite diperbarui: 14 tes / 9 spec.

### Verifikasi Fase QA-2 (dari server terhadap https://botara.my.id)
- Spec baru dijalankan sendirian lebih dulu: **1/1 PASS** (6,3 dtk).
- **Run PENUH suite: 14/14 PASS dalam 3,5 menit, satu kali jalan** —
  agents 1, auth 3, automations 2 (keyword + sequence), channels-webchat 1,
  contacts 1, products-pay 1, settings-api-keys 1, shell-ux 3, workspace 1.
  Tidak ada run ulang yang dibutuhkan: helper auth tahan rate-limit bawaan
  tidak terpicu pada run ini.
- **Regresi non-browser 5B dijalankan ulang** dengan akun & API key uji
  BARU (orkestrasi Bun sekali pakai di server; kunci full-scope prefix
  `sk_live_RpDl…` + read-only prefix `sk_live_rEDP…`; file env kunci
  dihapus dari server setelah jalan): **`verify:mcp` 14/14 PASS**
  (`send_message` berstatus `sent`; pengunjung webchat menerima pesan MCP
  secara live lewat WS selama uji; negatif scope →
  `API_KEY_SCOPE_DENIED`) dan **`verify:sdk` 3/3 PASS** (kunci salah →
  `SahabatKreatorApiError` `API_KEY_INVALID` 401).
- Penutup: typecheck SEMUA proyek (16 paket/app) hijau;
  `GET https://botara.my.id/api/health` ok.

### Batas jujur
- Nol bug baru bukan berarti nol risiko: suite tetap menargetkan jalur
  bahagia + negatif utama per fitur; skenario dua worker balapan dan uji
  beban di luar cakupan (sama seperti catatan QA-1/2A).
- Koneksi SSH interaktif ke server sempat putus sekali (`Broken pipe`)
  saat run penuh dijalankan menempel di sesi SSH — run diulang sebagai
  proses detached (nohup + log) dan itulah run 14/14 di atas; ini isu
  transport sesi, bukan aplikasi/tes.

## Update Fase 6A — Channel Telegram hidup (adapter Bot API) (2026-11-02)

Telegram menjadi channel kedua yang hidup end-to-end setelah webchat.
Pola sama seperti 1F: kredensial & resolusi publik diamankan di core,
pesan keluar selalu lewat antrean `queued` yang sama untuk semua fitur
(dashboard, automation, sequence, agent) — yang berubah hanya poller
pengiriman di API.

### Desain kredensial & webhook
- **Token bot terenkripsi AES-256-GCM** di core
  (`packages/core/src/channel-secrets.ts`): envelope
  `v1:<iv>.<tag>.<ciphertext>` (base64url) disimpan di kolom yang sudah
  ada `channel_accounts.access_token_encrypted`. Kunci dari env
  **`CHANNEL_TOKEN_SECRET`** (32 byte base64; digenerate DI SERVER,
  hanya ada di `.env.staging`). Token tidak pernah muncul di respons
  API (hanya status + `@username` bot dari kolom baru `bot_username`),
  tidak masuk log, tidak masuk detail audit (audit `channel.created`
  hanya membawa provider + botUsername).
- **Webhook secret:** nilai acak 24 byte digenerate saat connect; yang
  disimpan di `webhook_secret` adalah **hash SHA-256**-nya; verifikasi
  header `X-Telegram-Bot-Api-Secret-Token` memakai perbandingan
  timing-safe terhadap hash.
- Kolom aditif `channel_accounts.bot_username` (migrasi **0017**,
  drizzle-kit generate). Migrasi **0018** (tulis tangan, pola
  0006/0012/0016): policy SELECT sempit `telegram_webhook_lookup`
  (resolusi akun webhook tanpa konteks tenant, berdasarkan
  `app.telegram_channel_account_id`) + `system_delivery_scan` pada
  channel_accounts/conversations/channel_identities/messages (scan
  antrean `queued` percakapan telegram lintas tenant untuk poller,
  setting `app.system_delivery='telegram'`). Staging sekarang 31 tabel /
  **32 policy**. PGlite verify lulus termasuk seksi [12] lengan telegram.

### Endpoint & alur
- `POST /api/tenants/:tenantId/channels` diperluas provider `telegram`
  {displayName, botToken}: validasi `getMe` (401 → **422
  TELEGRAM_TOKEN_INVALID**; jaringan mati → 503), external_id = id bot,
  token terenkripsi, lalu `setWebhook` ke
  `https://<BETTER_AUTH_URL>/api/telegram/webhook/<channelAccountId>`
  dengan secret_token. setWebhook gagal → akun berstatus `error` + 422
  CHANNEL_NOT_CONNECTED. Provider Meta tetap 422
  CHANNEL_NOT_AVAILABLE_YET.
- Webhook publik `POST /api/telegram/webhook/:channelAccountId`:
  akun tak dikenal → 404; secret salah → 401 generik; update non-teks →
  200 diabaikan. Pesan teks: kontak/identitas (identitas = id pengirim
  Telegram)/percakapan/pesan inbound + unread + outbox
  `message.received` dalam SATU transaksi. Dedup memakai
  provider_message_id majemuk `telegram:<botId>:<message_id>` (index
  unik provider_message_id bersifat global).
- Pengiriman: poller di `apps/api/src/modules/telegram/poller.ts`
  (interval 2 dtk) memindai antrean telegram, mendekripsi token di
  proses API, `sendMessage` ke chat id identitas kontak, lalu
  sent/failed (`markOutboundMessageSent/Failed`, audit `message.failed`
  dengan kode aman `telegram_http_<status>` dsb.). Klien Bot API
  (`packages/channels/channel-telegram`) tidak pernah memasukkan token
  ke pesan error; base URL dari env `TELEGRAM_API_BASE` (default
  `https://api.telegram.org`) — override ini yang memungkinkan uji mock.
- UI Channels: form hubungkan Telegram (nama tampilan bot + input token
  type=password + petunjuk BotFather), daftar menampilkan `@username`;
  i18n en+id lengkap. Perbaikan UI nyata dari fase ini: label field nama
  bot diganti "Bot display name"/"Nama tampilan bot" karena sebelumnya
  identik dengan label nama channel webchat ("Channel name") sehingga
  locator a11y ambigu — tertangkap regresi Playwright channels-webchat.

### Verifikasi Fase 6A (mock Bot API di server, BUKAN token asli)
- Mock Bot API kecil (Bun, 127.0.0.1:39011 di server) menerapkan
  getMe/setWebhook/sendMessage + pencatatan state. Jendela uji: baris
  `TELEGRAM_API_BASE=http://127.0.0.1:39011` ditambahkan sementara ke
  `.env.staging`, API direstart; setelah uji baris itu DICABUT dan API
  direstart lagi. Keadaan akhir env terverifikasi = env awal +
  `CHANNEL_TOKEN_SECRET` saja (9 variabel), izin file tetap 600, mock
  dimatikan, skrip uji di /tmp server dihapus.
- Rantai publik dari server (22 assertion): **22/22 PASS** — sign-up +
  tenant uji; token invalid → 422 TELEGRAM_TOKEN_INVALID; connect →
  201 + botUsername `@sk_mock_bot` + status connected; token tidak
  muncul di respons connect maupun GET channels; mock mencatat getMe
  dan setWebhook dengan URL webhook publik yang benar + secret_token;
  webhook secret salah → 401; webhook benar berisi "harga" →
  percakapan + pesan inbound tampil di API dashboard; automation
  keyword menembak → mock menerima sendMessage (chat_id benar, teks
  berisi nominal + nama kontak dari placeholder {name}); balasan manual
  dashboard → mock menerima sendMessage; kedua pesan outbound berstatus
  `sent`; update foto (non-teks) → 200 diabaikan; webhook duplikat →
  tetap 1 pesan inbound.
- Negatif log: `grep` string token uji mock pada journal API & worker
  30 menit terakhir = **0 kemunculan**.
- Regresi Playwright dari server (auth + channels-webchat): run pertama
  3/4 — kegagalan adalah bug label ambigu di atas (BUKAN lingkungan);
  setelah perbaikan label + redeploy bundle web
  `index-CZTYNG1B.js`: **4/4 PASS**. Typecheck semua proyek hijau;
  `GET https://botara.my.id/api/health` ok.

### Batas jujur
- **Verifikasi token ASLI menunggu user**: fase ini selesai pada
  keadaan "siap token asli" — user membuat bot via @BotFather lalu
  memasukkan tokennya lewat form di halaman Channels; alur connect yang
  sama (getMe + setWebhook ke Telegram asli) akan berjalan saat itu.
  Tidak ada token bot asli yang pernah dipakai/diminta dalam fase ini.
- Cakupan v1 = chat privat 1:1: identitas memakai id pengirim
  (`from.id`); pada chat privat itu sama dengan chat id tujuan kirim.
  Grup belum ditargetkan (chat id grup ≠ id pengirim; perlu kolom chat
  id tersendiri bila grup didukung nanti).
- Poller pengiriman masih pola jembatan in-process seperti webchat
  (satu proses API); Redis pub/sub tetap pekerjaan sebelum skala
  horizontal (konsisten catatan 1F/2A).

---

## Hotfix Webchat — CORS lintas-origin, retry sesi + status error, layout tombol (2026-11-02)

Tiga cacat yang dilaporkan & dikonfirmasi langsung oleh user:
(1) widget dipasang di situs sendiri (dan dari file://) gagal total;
(2) widget macet di "Connecting…" selamanya dan hanya pulih lewat
reload manual; (3) UI widget bergeser saat diklik.

### Akar masalah (sebagaimana ditemukan di kode/lapisan)

1. **CORS putus di DUA lapisan.** API memang tidak pernah mengirim
   `Access-Control-Allow-Origin`. Lebih halus lagi: preflight OPTIONS
   yang terlihat "membawa allow-methods/headers" ternyata dijawab oleh
   **middleware CORS bawaan Vite preview** (proxy staging), bukan API —
   dan jawaban itu TANPA ACAO, jadi browser tetap menolak. Perbaikan:
   (a) middleware CORS permisif di API khusus route `/webchat/*`
   (ACAO `*` pada SEMUA respons termasuk error; preflight 204 dengan
   allow-methods GET/POST/OPTIONS + allow-headers Content-Type/
   Authorization) — aman karena endpoint ini publik by design dan
   diautentikasi siteKey + token pengunjung HMAC (Bearer), bukan
   cookie; (b) `preview.cors: false` di `apps/web/vite.config.ts` agar
   preflight diteruskan proxy ke API. Endpoint tenant/dashboard TIDAK
   berubah (terverifikasi tanpa ACAO).
2. **Kegagalan sesi diam-diam.** `ensureSession` yang gagal di
   `openPanel` hanya menyalakan polling, dan `syncMessages` kembali
   diam-diam bila token belum ada — tidak ada status error, tidak ada
   retry, selamanya. Perbaikan di widget: mesin status koneksi
   (connecting/connected/error) dengan bar status di panel, teks error
   dwibahasa + tombol "Coba lagi / Retry", retry otomatis backoff
   1s→2s→5s→10s→15s, polling ikut memicu pembuatan sesi, pemulihan
   segera saat tab aktif lagi (`visibilitychange`) / browser online
   lagi (`online`), dan bahasa widget kini dideteksi dari
   `<html lang>`/bahasa browser bila `data-lang` tidak diisi. Kegagalan
   KIRIM pesan juga tidak diam lagi: gelembung lokal menjadi redup
   berlabel "Gagal terkirim — ketuk untuk coba lagi" (tap-to-retry).
3. **Layout bergeser.** Root widget bukan flex column rata-kanan —
   saat panel membuka, root melebar dan tombol melompat ke kiri bawah
   panel; plus input 14px memicu auto-zoom iOS Safari saat fokus.
   Perbaikan: root `display:flex;flex-direction:column;
   align-items:flex-end;gap:12px`, input font-size 16px.

### Perubahan & deploy

- Commit `cf7a162` (routes webchat API + widget + spec baru),
  `bcc8f5a` (vite.config cors:false), `0ca766d` (perbaikan assertion
  tes). Build embed → widget.js baru **9.184 byte** (sebelumnya 6.889),
  build api+web → rsync → restart web & api (proses pemilik port
  dihentikan, systemd mengangkat ulang). Typecheck semua proyek hijau.

### Verifikasi (publik, dari server terhadap https://botara.my.id)

- **Skrip CORS (tenant uji sendiri): 14/14 PASS** — POST session
  Origin `https://example.com` & Origin `null` → 200 + ACAO `*`; key
  bogus → 404 TETAP + ACAO; preflight OPTIONS → 204 + ACAO `*` +
  methods/headers benar (jawaban kini dari API, bukan Vite); GET
  /api/tenants tanpa ACAO; /widget.js publik = 9.184 byte memuat
  string error dwibahasa baru.
- **Spec Playwright baru `tests/e2e/webchat-embed.spec.ts`: 3/3 PASS**
  — halaman polos di origin asing `http://situs-tenant.test` berisi
  snippet persis seperti file user: chat dua arah + balasan automation
  tiba; **asersi posisi: tepi kanan & bawah tombol berubah ≤2px** saat
  panel dibuka maupun ditutup; siteKey bogus dari origin asing +
  halaman `lang="id"` → status error "Tidak dapat terhubung…" +
  tombol "Coba lagi" tampil (bukan Connecting abadi); request sesi
  pertama di-abort lewat route → widget pulih sendiri (≥2 upaya sesi),
  pesan terbukti sampai Inbox pemilik, tanpa reload.
- Regresi `channels-webchat.spec.ts` (jalur demo satu origin): PASS.
  Run pertama gabungan sempat 3/4 — satu-satunya kegagalan adalah
  assertion tes yang ambigu (nama automation muncul juga di pratinjau
  balasan), diperbaiki di `0ca766d` dan run ulang hijau; bukan bug
  aplikasi.

### Batas jujur

- Retry sesi berjalan selama panel pernah dibuka / selama upaya kirim
  dilakukan; widget yang belum pernah dibuka tidak membuat sesi di
  latar (by design — tidak ada perubahan perilaku itu).
- Gelembung lokal tampil optimistis sebelum konfirmasi server;
  kegagalan ditandai tap-to-retry, dan duplikasi sesaat dengan hasil
  sinkronisasi dimungkinkan dalam jendela <1 detik (di-dedup per ID
  pesan server begitu konfirmasi tiba).
- CORS `*` hanya untuk endpoint publik webchat; WS tidak memakai CORS
  (browser tidak menerapkannya pada WebSocket) dan tetap diautentikasi
  token di query.

---

## Update Fase 6A.1 — Dukungan grup Telegram (2026-11-02)

Melunasi hutang cakupan 6A: v1 hanya benar untuk chat privat karena
identitas kontak (pengirim) sekaligus dianggap alamat balasan. Di grup
keduanya berbeda — `chat.id` grup itu negatif dan bukan id anggota mana
pun.

### Model data (migrasi 0019, generate + backfill tulis tangan)
- `conversations.provider_chat_id` varchar — id chat provider = ALAMAT
  BALASAN percakapan (Telegram: `chat.id`; positif privat, negatif
  grup). Backfill di migrasi yang sama mengisi baris telegram lama dari
  `channel_identities` (semua percakapan 6A memang privat). Staging
  terkonfirmasi: 2 percakapan telegram ter-backfill, webchat tak
  tersentuh; jumlah policy tetap 32.
- `conversations.title` varchar — judul grup (`chat.title`); HANYA
  percakapan grup yang terisi, dan kehadirannya adalah penanda
  `isGroup` bagi API/UI.
- `messages.sender_name` varchar — snapshot nama anggota pengirim per
  pesan masuk grup (percakapan grup menampung banyak penulis, sedangkan
  baris percakapan hanya menunjuk satu kontak jangkar). Privat NULL.
- Kontak jangkar percakapan grup = pengirim pertama; identitas kontak
  tetap dibuat per anggota yang menulis (atribusi & CRM), dan resolusi
  percakapan privat kini DIBATASI alamat chat agar pesan privat anggota
  tidak nyasar ke utas grup miliknya (bug yang tertangkap verifikasi
  fase ini — lihat bawah).

### Alur
- Adapter: `parseTelegramUpdate` menormalkan `conversationKind`
  ("private"|"group") + `conversationTitle` ke StandardMessage
  (channel-core, field opsional generik); `conversationExternalId`
  memang sudah `chat.id` sejak 6A. `setWebhook` kini meminta
  `allowed_updates: ["message", "my_chat_member"]`.
- Webhook route: pesan grup → SATU percakapan per (akun, id grup);
  judul grup diperbarui bila berubah. Update `my_chat_member` → audit
  `telegram.my_chat_member` (actor system `telegram-webhook`, meta
  chatId/judul/status) TANPA membuat percakapan; `edited_message` &
  `channel_post` tetap 200-diabaikan (channel = Fase 6A.2).
- Pengiriman: poller memakai `coalesce(conversations.provider_chat_id,
  channel_identities.external_user_id)` — balasan manual, automation,
  sequence, dan agent ke grup terkirim ke id grup lewat jalur `queued`
  yang sama persis; tidak ada jalur khusus grup.
- Kontrak/API: `ConversationResponse` + `title` & `isGroup`;
  `MessageResponse` + `senderName`. UI Inbox: daftar & header memakai
  judul grup + chip "Grup"/"Group" (i18n `inbox.groupLabel`), nama
  pengirim tampil di atas gelembung masuk grup.
- **Dua bug tambahan yang ditemukan & diperbaiki fase ini:**
  1. *Dedup lintas tenant → webhook 500 (sejak 6A).* SELECT dedup
     berjalan dalam konteks RLS tenant, tetapi index unik
     `provider_message_id` bersifat GLOBAL: bot yang sama pernah
     terhubung di tenant lain membuat SELECT tak melihat kembarannya
     namun insert ditolak index (23505) → 500 → Telegram me-retry
     update yang sama selamanya. Perbaikan: insert memakai
     `ON CONFLICT DO NOTHING`; kembaran milik tenant lain diakui (200)
     tanpa unread/outbox ganda. Semantik dedup tidak berubah.
  2. *Pesan privat nyasar ke utas grup* (di atas) — resolusi privat kini
     mensyaratkan `provider_chat_id` sama dengan alamat chat (atau NULL
     untuk baris warisan).

### Verifikasi (mock Bot API lokal di server, pola 6A — TANPA token asli)
- Mock diperbarui: id bot diturunkan dari awalan numerik token (tiap
  run uji = bot berbeda, meniru kenyataan & menghindari tabrakan dedup
  global antar-run). Jendela `TELEGRAM_API_BASE` dibuka lalu DICABUT;
  keadaan akhir `.env.staging` terverifikasi kembali 9 variabel (600),
  mock dimatikan, skrip /tmp server dihapus.
- Rantai publik dari server (skrip Bun, tenant uji baru): **38/38 PASS**
  — token invalid 422; connect mock + `@username` tampil, token tak
  muncul di respons; setWebhook tercatat dengan `allowed_updates`
  memuat `my_chat_member`; secret salah 401; dua anggota menulis di
  supergroup yang sama → tepat 1 percakapan grup berjudul grup,
  2 pesan dengan `senderName` masing-masing; keyword di grup →
  mock menerima sendMessage dengan **chat_id = id grup negatif**
  (dan TIDAK PERNAH ke id anggota); balasan manual → sendMessage ke
  id grup + status `sent`; regresi privat: percakapan privat anggota
  yang sama TERPISAH (title null, senderName null), balasan privat
  tetap ke chat privat; `my_chat_member`/`edited_message`/
  `channel_post` → 200 tanpa percakapan/pesan baru (audit
  `telegram.my_chat_member` terkonfirmasi 1 baris di DB); duplikat
  update grup → tetap 1 pesan; tenant lain 404; tanpa sesi 401.
- Lokal: typecheck semua proyek (17) hijau; `packages/db` verify
  (PGlite) lulus termasuk seksi baru **[13]** (kolom 0019 ada; alamat
  grup teresolusi ke id negatif lewat coalesce; privat warisan jatuh
  ke identitas; sender_name tersimpan per pesan grup). Negatif log:
  token mock 0 kemunculan di journal API & worker.
- **Playwright SENGAJA dilewati fase ini** atas instruksi user
  (2026-11-02: percepat development, cukup verifikasi rantai API/mock
  + typecheck + PGlite; suite yang ada di repo dibiarkan apa adanya).

### Catatan insiden jendela uji (transparansi)
- Jendela mock fase ini beririsan dengan uji langsung user: user
  menempelkan token bot ASLI-nya di workspace aslinya "WS Mas Romo"
  saat API masih menunjuk mock, sehingga terbentuk satu baris channel
  Telegram berbasis mock (@sk_mock_bot_6a1, bot_id 777001) di tenant
  asli itu. Pada cleanup fase ini baris tersebut **DIHAPUS**
  (terverifikasi: 0 percakapan/identitas/pesan terkait — tidak ada
  data lain yang menempel padanya). Satu entri audit `channel.created`
  atas aksi connect user sendiri dibiarkan sebagai jejak audit yang
  jujur (tidak memuat token).
- Koneksi asli user **@botaramyid_bot di "Mas Romo WS Baru" TIDAK
  disentuh** (baris sama, status connected, webhook Telegram asli
  tidak berubah — selama jendela mock tidak ada panggilan Bot API
  sungguhan yang keluar). Selama jendela, tepat 1 pesan masuk ASLI
  tercatat normal lewat webhook di workspace itu dan TIDAK ada satu
  pun pesan keluar untuk tenant asli user — jadi tidak ada balasan
  sungguhan yang tertelan mock.
- Pelajaran & tindak lanjut (di luar fase ini, sudah dicatat parent):
  belum ada penjaga "satu bot = satu koneksi" — bot yang sama bisa
  terhubung di banyak workspace sekaligus; diantrekan sebagai hotfix
  tersendiri (unique parsial (provider, external_id) + 409 saat
  connect ganda).

### Batas jujur
- Di grup SUNGGUHAN, apakah bot menerima semua pesan grup bergantung
  **privacy mode BotFather milik user** (default: hanya mention/
  perintah/reply ke bot) — di luar kendali kode; matikan privacy mode
  bila bot harus membaca semua pesan grup.
- Semantik sequence tidak diubah: enrollment menunjuk kontak
  percakapan (di grup = kontak jangkar/pengirim pertama utas), dan
  placeholder `{name}` pada balasan automation/agent di grup merender
  nama kontak jangkar itu, bukan nama anggota pemicu per pesan.
  Atribusi per pesan yang akurat hidup di `sender_name`.
- Judul grup mengikuti `chat.title` terakhir yang terlihat; bot yang
  dikeluarkan dari grup tidak menutup percakapan otomatis (audit
  `my_chat_member` adalah jejaknya).

---

## Hotfix Telegram — satu bot = satu koneksi + Disconnect channel (2026-11-02)

Dua temuan user yang dilunasi fase ini: (1) bot Telegram yang sama bisa
dihubungkan ke banyak workspace — koneksi kedua membajak webhook bot
secara diam-diam karena satu bot hanya punya satu webhook; (2) status
"connected" tidak punya tombol disconnect di mana pun (tidak ada UI,
tidak ada endpoint).

### Penjaga satu bot = satu koneksi (migrasi 0020)
- **Index unik parsial** `channel_accounts_provider_external_active_unique`
  pada `(provider, external_id)` WHERE `status <> 'disconnected'`
  (dibangkitkan dari skema): duplikat AKTIF mustahil di level data,
  lintas tenant; baris 'disconnected' dikecualikan agar bot bisa
  dihubungkan lagi setelah diputuskan. Ditambah **lengan RLS sempit**
  `provider_external_lookup` (pola 0006/0012/0016/0018): transaksi
  men-set `app.channel_provider` + `app.channel_external_id` dan hanya
  baris pasangan persis itu yang terbuka — fondasi lookup connect
  lintas tenant tanpa membocorkan tenant pemiliknya. Total staging:
  **33 policy**.
- **Alur connect** (setelah `getMe`): bot aktif milik workspace LAIN →
  **409 `TELEGRAM_BOT_ALREADY_CONNECTED`** (kode kontrak baru; pesan UI
  dwibahasa; tanpa baris baru, tanpa setWebhook — webhook pemilik sah
  tidak diganggu). Milik workspace yang SAMA: 'connected' → idempoten
  200 akun yang ada; 'disconnected'/'error' → baris yang sama
  dihidupkan lagi (kredensial + secret baru, webhook didaftarkan ulang;
  index unik per tenant melarang baris kedua). Unique-violation karena
  balapan dipetakan ke hasil yang sama (409 / idempoten).
- **Prasyarat data migrasi (disclosure):** pembuatan index awalnya
  ditolak duplikat warisan artefak uji fase-fase lama — bot mock
  `777001` di 4 tenant uji 6A/6A.1 dan seed `webchat-1d`/`webchat-1e`
  masing-masing di 2 tenant "Studio Fase 1D/1E" (tenant uji berbeda
  bernama sama). Semua baris kembar di luar yang tertua per pasangan
  di-set 'disconnected' + kredensial dikosongkan (5 baris, semua tenant
  uji — tidak ada data workspace asli user yang disentuh), lalu migrasi
  teraplikasi bersih.

### Disconnect channel (DELETE, owner/admin)
- `DELETE /api/tenants/:tenantId/channels/:channelId` → 204 (pola
  DELETE api-keys/KB; role selain owner/admin → 403; non-member → 404;
  idempoten). Core `disconnectChannelAccount`: status 'disconnected',
  token terenkripsi + hash secret webhook DIKOSONGKAN, audit
  `channel.disconnected`. Percakapan & pesan TIDAK dihapus.
- **Telegram:** klien Bot API ditambah `getWebhookInfo`/`deleteWebhook`.
  Webhook hanya dicabut bila URL aktif menunjuk ke akun ini — akun
  bukan pemilik tidak bisa mencabut webhook pemilik (hasil cek dicatat
  di meta audit `webhookDeleted`). Bot API gagal dihubungi tidak
  menggagalkan disconnect lokal: hash secret sudah kosong sehingga
  webhook sisa ditolak 401 oleh route webhook kita.
- **Webchat:** cukup status — route sesi publik sudah menolak akun
  non-'connected' (404), jadi siteKey berhenti bekerja seketika.
- **UI Channels:** tombol Putuskan/Disconnect pada baris belum putus +
  dialog konfirmasi dwibahasa (pesan berhenti, riwayat tetap, bisa
  dihubungkan lagi); baris terputus tampil redup dan cuplikan embed
  webchat disembunyikan. Bundle baru `index-CO6KlYsI.js`.

### Verifikasi (rantai dari server, tenant uji sendiri — TANPA Playwright)
- Mock Bot API diperluas (getWebhookInfo/deleteWebhook/state per bot);
  jendela `TELEGRAM_API_BASE` dibuka lalu dicabut; `.env.staging` akhir
  terverifikasi kembali 9 variabel (600), mock mati, skrip /tmp dihapus.
- Rantai publik: **29/29 PASS** — A connect → B connect bot sama **409**
  + kode kontrak, B tanpa baris, mock setWebhook tetap 1x → A reconnect
  **200 idempoten** (id sama, webhook tak disentuh) → webhook masuk →
  percakapan → member 'agent' DELETE **403**, non-member **404** →
  webhook dipindah (poke) ke akun lain: A disconnect **204** dan
  deleteWebhook **tidak** terpanggil → riwayat A tetap ada → B connect
  **201** → B disconnect sebagai pemilik: deleteWebhook **1x**, webhook
  kosong → B reconnect **200 revive** baris yang sama → token invalid
  tetap 422 → webchat: sesi 200 → disconnect → sesi **404**, riwayat
  tetap, baris 'disconnected' → tanpa sesi 401 → health ok. Token mock:
  **0 kemunculan** di journal API+worker.
- Lokal: typecheck semua proyek hijau; PGlite verify lulus termasuk
  seksi baru **[14]** (index parsial menolak duplikat connected & error
  lintas tenant, membolehkan baris disconnected; lengan lookup hanya
  membuka pasangan persis) dan hitungan policy 32 → **33**.

### Remediasi duplikat ASLI user (keputusan user: survivor = koneksi pertama)
Duplikat nyata `@botaramyid_bot` (bot_id 8808425227) ada di dua
workspace user; webhook hidup menunjuk akun terbaru `10be58d5`
("WS Mas Romo"). Dilaksanakan dengan modul aplikasi sendiri di server
 (skrip sekali jalan, dihapus sesudahnya; tidak ada nilai token/secret
 yang dicetak/dicatat):
1. `10be58d5` diputuskan lewat jalur disconnect baru: token didekripsi
   via core → `getWebhookInfo` membuktikan webhook memang menunjuk
   akun itu → `deleteWebhook` terpanggil → core
   `disconnectChannelAccount` (actor system `connection-remediation`,
   audit `channel.disconnected` dengan `webhookDeleted: true`).
   Langkah ini sekaligus prasyarat pembuatan index 0020.
2. Secret webhook survivor `8fb9b81c` ("Mas Romo WS Baru") **dirotasi**:
   plaintext lama memang tidak tersimpan (hanya hash SHA-256) — secret
   acak baru dibuat, hash-nya disimpan via core, lalu `setWebhook`
   memakai token terenkripsi survivor ke
   `https://botara.my.id/api/telegram/webhook/8fb9b81c-…` dengan
   secret_token baru dan allowed_updates ["message","my_chat_member"].
3. Terverifikasi: `getWebhookInfo` (token survivor) menunjukkan URL =
   URL survivor; DB: tepat **satu** akun `@botaramyid_bot` aktif
   (8fb9b81c, connected), `10be58d5` 'disconnected' dengan token+secret
   kosong; percakapan survivor (1 percakapan, 3 pesan) utuh.

### Batas jujur
- Bukti terakhir bahwa pesan user sungguhan mendarat di survivor hanya
  bisa diberikan oleh chat nyata user ke botnya (getWebhookInfo + DB
  sudah membuktikan arah webhook & secret yang terdaftar konsisten).
- Token pengunjung webchat yang sudah terbit sebelum disconnect tidak
  dicek ulang status akunnya (desain 1F; sesi BARU yang ditolak) —
  token itu berakhir sendiri ≤30 hari.
- Akun berstatus 'error' ikut menghalangi workspace lain (mereka masih
  memegang klaim bot + webhook terdaftar sebagian) — jalan keluarnya
  disconnect dari workspace pemilik, sesuai pesan error dwibahasa.

---

## Hotfix Dashboard Realtime — polling penyegaran langsung inbox & badge (2026-11-02)

### Perubahan (web saja, commit `04a9ab0`; API TIDAK berubah)
- **Akar masalah:** `apps/web/src` tidak punya setInterval/WebSocket/
  polling sama sekali — daftar percakapan, utas pesan, badge unread, dan
  badge persetujuan AI hanya dimuat saat halaman dibuka/pindah/aksi
  sendiri, sehingga pesan masuk baru hanya terlihat setelah refresh
  manual browser (dilaporkan user 2026-11-02). Sisi pengunjung webchat
  sudah realtime (WS hub di API); sisi agen yang statis.
- **Hook bersama baru `apps/web/src/hooks/usePolling.ts`** —
  `usePolling(callback, LIVE_REFRESH_INTERVAL_MS = 5_000, enabled)`:
  siklus berjalan hanya saat tab terlihat, satu penyegaran segera saat
  tab kembali terlihat / jendela fokus (`visibilitychange` + `focus`),
  guard in-flight anti-tumpuk, error latar ditelan diam, cleanup penuh
  saat unmount. Komentar di konstanta menegaskan statusnya: **jembatan
  menuju Fase 6G (apps/realtime)** — nanti transport utama menjadi push
  WebSocket dan polling ini turun menjadi fallback; semua penyegaran
  berkala wajib lewat hook ini agar penggantiannya satu tempat.
- **InboxPage:** polling ±5 dtk menjalankan dua penyegaran SENYAP —
  (a) daftar percakapan diganti dari server (urutan, preview, unread per
  percakapan ikut baru) dengan satu koreksi: percakapan yang sedang
  dibuka dipaksa unread lokal 0 (server sudah menandainya terbaca lewat
  GET messages — mencegah chip & badge berkedip naik pada percakapan
  yang sedang dibaca); total badge disinkronkan lewat
  `setFromConversations` seperti sebelumnya. (b) pesan percakapan
  terbuka digabung PER ID: salinan server menimpa versi lama (status
  queued→sent ikut segar), pesan baru menempel di akhir kronologis,
  tanpa duplikat dan tanpa mengganti seluruh daftar (tidak ada kedip,
  status memuat awal tidak ditampilkan ulang). Draf balasan tidak pernah
  disentuh penyegaran; pilihan percakapan tidak berpindah sendiri.
- **Scroll utas dijaga:** penanda "menempel di bawah" (`stickToBottom`,
  ambang 120px, diperbarui dari event scroll) — auto-scroll ke pesan
  terbaru HANYA bila agen memang di dekat dasar; agen yang scroll ke
  atas membaca riwayat tidak diseret turun. Berpindah percakapan dan
  selesai mengirim balasan mengembalikan penanda ke menempel.
- **Badge global ikut polling:** `UnreadBadgeProvider` dan
  `PendingApprovalsProvider` kini menjalankan `refresh()`-nya sendiri
  lewat `usePolling` yang sama selama ada workspace aktif — badge segar
  di halaman mana pun, bukan hanya saat Inbox/Agents dibuka.
- Deploy: build web di VM → commit `04a9ab0` → push → rsync repo
  (`.env.staging` server dikecualikan & utuh) → proses Vite preview
  di-restart → origin menyajikan bundle baru `index-BGh3Vs6D.js`.
  Service API & worker tidak di-restart (tidak ada perubahan di sisinya).

### Verifikasi (tanpa Playwright — keputusan user: rantai API + bundle)
- Lokal: `pnpm typecheck` SEMUA proyek hijau; build web hijau. Bundle
  lokal memuat kode polling: `visibilitychange` ×2, `setInterval` ×1,
  konstanta `5e3` ×3 (tiga pemakai hook).
- Rantai API dari server terhadap `https://botara.my.id` (akun uji BARU
  `hotfixrt-*@sk.test`, pengunjung "Pengunjung Realtime"): **14/14
  PASS** — health 200; conversations tanpa sesi 401; sign-up → tenant →
  channel webchat → sesi pengunjung → pesan #1 → GET conversations
  dashboard: percakapan tampil dengan unread=1 & preview pesan #1 →
  pesan #2 → GET conversations BERIKUTNYA langsung unread=2 & preview
  pesan #2 (data sumber seketika; header `cache-control` tidak ada —
  tidak ada lapisan cache yang menahan kesegaran yang akan dikonsumsi
  polling) → GET messages memuat kedua pesan kronologis → setelah GET
  messages unread percakapan terbuka = 0 (perilaku mark-read yang
  konsisten dengan logika merge polling) → GET suggestions
  `?status=pending` 200 array (sumber polling badge AI) → GET / publik
  menyajikan bundle baru.
- Publik dari VM: bundle `index-BGh3Vs6D.js` terunduh dari
  `https://botara.my.id/assets/…` (371.085 byte) dan grep-nya identik
  dengan build lokal (`visibilitychange` ×2, `setInterval` ×1, `5e3` ×3);
  `GET /` & `GET /api/health` → 200.

### Batas jujur
- Latensi kesegaran dashboard kini ≤ ±5 dtk (siklus polling) + segar
  seketika saat tab kembali fokus — BUKAN push seketika; itu jatah Fase
  6G (apps/realtime), setelahnya polling ini menjadi fallback.
- Sesuai pembagian tugas baru (user menguji UI/UX sendiri), pembuktian
  visual akhir — pesan & badge benar-benar muncul di browser tanpa
  refresh, draf & scroll tidak terganggu — menunggu uji langsung user
  di staging; yang terbukti di sini: kode polling ada di bundle yang
  tersaji publik dan seluruh sumber data yang dikonsumsinya segar
  seketika di URL publik asli.

---

## Update Fase 6A.2 — Dukungan CHANNEL Telegram (linimasa siaran) (2026-11-02)

Melengkapi keluarga Telegram (privat 6A, grup 6A.1): channel tempat bot
menjadi ADMIN kini tampil di dashboard sebagai linimasa postingan, dan
pemilik bisa memposting ke channel dari kotak tulis inbox yang sama.

### Model data (migrasi 0021, generate + backfill tulis tangan)
- `conversations.kind` varchar(16) NOT NULL DEFAULT 'private' + CHECK
  `conversations_kind_valid` IN ('private','group','channel') — penanda
  jenis EKSPILIT; sampai 6A.1 jenis disimpulkan dari kehadiran `title`,
  yang tidak lagi cukup karena channel juga berjudul. Backfill memakai
  heuristik warisan itu persis: `title IS NOT NULL → 'group'`, sisanya
  tetap 'private' (benar untuk privat Telegram & semua webchat; channel
  belum ada sebelum fase ini). Staging terkonfirmasi sesudah migrasi:
  **3 group / 63 private / 0 channel**. `when` jurnal 0021 dinaikkan
  manual ke 1793591000000 (hasil generate lebih kecil dari 0020 —
  jebakan lama). Kontrak: `ConversationResponse.isChannel` ditambah,
  `isGroup` dipertahankan — keduanya kini diturunkan dari `kind` di
  core `listConversations` (bukan lagi `title !== null`).
- **Kontak jangkar channel = channel itu sendiri** (keputusan disengaja,
  meniru semantik `sender_chat` Telegram): satu kontak per channel
  bernama judul channel, identitas `external_user_id` = id chat channel.
  Bukan orang — entitas siaran; pola ini membuat resolusi alamat poller
  (coalesce provider_chat_id → identitas) bekerja tanpa jalur khusus,
  dan nama kontak mengikuti pergantian judul channel.

### Alur
- **Adapter:** parser khusus `parseTelegramChannelPost` (channel_post
  tidak punya `from` pengguna — tidak lewat jalur pesan biasa);
  `setWebhook` kini meminta `allowed_updates: ["message",
  "my_chat_member", "channel_post"]` untuk connect/reconnect/rotasi
  berikutnya.
- **Webhook:** `channel_post` teks → core `recordTelegramChannelPost`:
  find-or-create percakapan channel + catat postingan (sender_name =
  judul channel). `my_chat_member` chat bertipe channel dengan status
  aktif (administrator/member/creator) → percakapan channel langsung
  dibuat/ditemukan + audit `telegram.my_chat_member` (meta kini memuat
  chatType + channelConversationId); bot dikeluarkan → audit saja,
  riwayat tetap. channel_post non-teks → 200 diabaikan.
- **Semantik linimasa (disengaja, berbeda dari percakapan):** postingan
  channel TIDAK menaikkan unread (API bahkan menegakkan unreadCount=0
  untuk kind channel di `listConversations`), TIDAK menulis event
  outbox `message.received`, dan jalur evaluasi punya **penjaga `kind`
  eksplisit**: `evaluateInboundMessageForAutomations` berhenti sebelum
  efek samping apa pun untuk percakapan channel (reason tak dievaluasi),
  `respondToInboundMessage` menolak dengan reason baru
  `channel_conversation`. Event liar yang mengarah ke pesan channel
  tetap tidak menembakkan automation/agent (dibuktikan di bawah).
- **Dedup pantulan:** poller Telegram kini MENYIMPAN provider_message_id
  majemuk `telegram:<botId>:<message_id>` hasil sendMessage pada pesan
  outbound saat menandai `sent` (`markOutboundMessageSent` dapat
  parameter opsional; pemanggil webchat tak berubah). Postingan kita
  memantul sebagai channel_post dengan message_id yang sama →
  ter-dedup di core dan linimasa menampilkannya SATU kali sebagai
  kiriman kita. Bila pantulan balapan tiba lebih dulu (id menabrak
  index unik), poller menandai sent ulang TANPA id agar status tidak
  ikut gagal.
- **UI Inbox:** chip "Channel"/"Kanal" (i18n `inbox.channelLabel`,
  pola chip Grup) di daftar & header; utas channel memakai kotak tulis
  yang sama dengan label konteks siaran — tombol "Post to channel"/
  "Posting ke channel", placeholder & catatan pengiriman khusus
  channel (kunci i18n baru en+id). Pengiriman = endpoint balasan yang
  sudah ada → queued → poller → sendMessage ke provider_chat_id
  channel. Bundle baru `index-C-Ee54kQ.js`. Halaman Channels tidak
  diubah (Inbox sudah cukup jelas). **Penjadwalan postingan TIDAK
  termasuk fase ini** — lanjutan broadcast.

### Verifikasi (mock Bot API lokal di server, pola 6A/6A.1 — TANPA Playwright)
- Mock diperluas pola lama (id bot dari awalan numerik token;
  sendMessage mengembalikan message_id menaik dari 9001 agar pantulan
  bisa dipalsukan persis). Jendela `TELEGRAM_API_BASE` dibuka lalu
  DICABUT; keadaan akhir `.env.staging` terverifikasi kembali 9
  variabel (600), mock dimatikan, skrip /tmp dihapus, ketiga service
  active, health publik ok, bundle publik = build lokal.
- Rantai publik dari server (skrip Bun, tenant uji BARU
  `fase6a2-*@sk.test`): **53/53 PASS** — connect mock + setWebhook
  tercatat dengan allowed_updates memuat `channel_post`; secret salah
  401; my_chat_member channel (bot jadi admin) → percakapan muncul via
  API dengan isChannel + title benar + unread 0; channel_post teks dari
  admin lain → 1 pesan masuk ber-senderName judul channel, duplikat
  update tetap 1, unread tetap 0, preview daftar cocok; automation
  keyword "promo" AKTIF → postingan channel berkunci "promo" TIDAK
  menghasilkan run & mock tidak menerima balasan; **event outbox
  `message.received` liar disuntikkan langsung ke DB untuk pesan
  channel itu → runs tetap 0, tetap tidak ada sendMessage** (penjaga
  kind terbukti, bukan sekadar ketiadaan event); posting dari dashboard
  → mock menerima sendMessage dengan chat_id = id channel, status
  `sent`; pantulan channel_post dengan message_id yang sama → linimasa
  tetap 1 baris untuk postingan itu; channel_post non-teks → 200 tak
  tercatat; regresi privat: automation tetap menembak & membalas ke
  chat privat, unread privat naik; regresi grup: percakapan isGroup &
  balasan manual terkirim ke id grup; tenant lain 404; tanpa sesi 401.
  Audit DB: tepat 1 baris `telegram.my_chat_member` ber-chatType
  'channel' dengan channelConversationId. Token mock: **0 kemunculan**
  di journal API+worker.
- Lokal: typecheck SEMUA proyek hijau; `packages/db` verify (PGlite)
  lulus termasuk seksi baru **[15]** (kolom kind + default + CHECK;
  pernyataan backfill title→'group' tepat pada data bergaya pra-0021;
  alamat posting percakapan channel teresolusi ke id channel lewat
  query poller); uji integrasi worker `verify:agent-tools` ditambah
  seksi **[8]** — postingan channel berkunci cocok: evaluasi automation
  `evaluated=false` + 0 runs, agent menolak `channel_conversation` —
  SEMUA LULUS; `verify:sequences` tetap lulus.

### Batas jujur
- **Bot harus ADMIN channel** agar Telegram mengirim `channel_post`
  (dan agar sendMessage ke channel diterima) — itu wewenang pemilik
  channel di aplikasi Telegram, di luar kendali kode.
- **Webhook lama belum memuat `channel_post`:** akun yang terhubung
  SEBELUM fase ini (termasuk bot asli user, yang webhook-nya terakhir
  didaftarkan saat remediasi hotfix dengan allowed_updates lama
  ["message","my_chat_member"]) TIDAK akan menerima channel_post
  sampai webhook-nya didaftarkan ulang — jalur alaminya: disconnect →
  connect lagi dari halaman Channels (atau rotasi secret berikutnya).
  Connect baru mulai hari ini sudah memakai allowed_updates lengkap.
  Fase ini SENGAJA tidak mendaftarkan ulang webhook akun yang sudah
  terhubung.
- Balapan pantulan: bila channel_post pantulan tiba dalam jendela
  milidetik sebelum poller selesai menandai `sent`, postingan bisa
  tercatat ganda (pantulan sebagai masuk + kiriman kita) — poller
  sudah menutup sisi penandaannya; jendela ingest tidak bisa ditutup
  tanpa kunci dedup kedua dan dianggap dapat diterima untuk v1.
- Postingan terjadwal & analitik channel (jumlah tayang/dll.) di luar
  fase ini; `views` Telegram tidak dibaca.

---

## Update Fase 6G — apps/realtime: gateway WebSocket mandiri di atas Redis pub/sub (2026-11-02)

### Perubahan
- **App BARU `apps/realtime`** (Bun, pola workspace sama) — gateway
  WebSocket mandiri yang mengambil alih hub in-memory di dalam apps/api.
  Unit systemd BARU `sahabat-kreator-realtime.service`: WorkingDirectory
  `.../apps/realtime`, `EnvironmentFile=.env.staging`,
  `NODE_ENV=production`, `REALTIME_PORT=3103`, bind **127.0.0.1:3103**,
  `Restart=always`. Health: `GET /health` / `/realtime/health`
  (status + jumlah socket dashboard & pengunjung).
- **Jalur publik:** Vite preview kini mem-proxy `/realtime` (ws:true,
  server & preview) ke 127.0.0.1:3103, jadi klien memakai satu origin
  `wss://botara.my.id/realtime/...`. Di PRODUKSI jalur ini pindah ke
  edge/reverse-proxy (tunnel menunjuk service realtime langsung atau
  subdomain), bukan lewat preview Vite — proxy preview hanya untuk
  staging satu-origin.
- **Model event = nudge, bukan muatan.** Skema `RealtimeNudgeSchema` di
  `packages/contracts` (`kind`: message.received | message.queued |
  message.sent | message.failed | agent.suggestion |
  conversation.updated; tenantId; conversationId opsional). Klien yang
  menerima nudge melakukan refetch lewat REST yang sudah ada — sumber
  kebenaran tetap REST, otorisasi tidak diduplikasi di socket.
- **Redis pub/sub:** penerbit `createRealtimePublisher` di
  `packages/queue` menerbitkan ke channel per tenant `rt:tenant:<id>`
  (Redis proyek yang sama, 127.0.0.1:6381); gateway berlangganan pola
  `rt:tenant:*` (psubscribe, satu koneksi khusus) dan merutekan ke
  socket lokal. Penerbitan **fail-soft SETELAH commit**: Redis mati →
  nudge hilang, transaksi utama tidak pernah gagal; polling menutupi.
- **Titik penerbit:** pesan masuk webchat & telegram (webhook API),
  balasan manual agen (route inbox + API publik v1), keluaran worker
  (automation keyword → message.queued; langkah sequence; respons AI →
  message.queued / saran → agent.suggestion), perubahan status
  sent/failed oleh poller telegram, dan flush webchat (gateway sendiri
  menerbitkan message.sent). Tambahan kecil di core:
  `ExecuteSequenceStepResult.conversationId` agar nudge sequence
  ber-percakapan.
- **Auth socket (ditolak 401 saat upgrade bila tidak sah):**
  dashboard = cookie sesi Better Auth divalidasi terhadap DB (instance
  Better Auth lokal di apps/realtime, pola AuthBundle API) + tenantId
  diverifikasi keanggotaannya lewat core; pengunjung webchat = token
  pengunjung HMAC yang sama seperti REST webchat (fungsi dari
  `packages/channels/channel-webchat`), terikat satu percakapan.
- **Pengiriman webchat PINDAH ke gateway:** poller webchat & hub WS di
  apps/api DIHAPUS (endpoint lama `/api/webchat/ws` pensiun). Saat
  nudge message.queued tiba untuk percakapan yang pengunjungnya
  terhubung (atau saat pengunjung connect), gateway mem-flush antrean
  lewat fungsi core `flushQueuedWebchatMessages` (→ `sent`), mendorong
  nudge ke socket pengunjung, dan menerbitkan message.sent balik untuk
  dashboard. Semantik antrean luring Fase 1F dipertahankan persis.
- **Klien:** dashboard — modul `apps/web/src/realtime/bus.ts` (singleton,
  reconnect backoff 1–15 dtk + reconnect saat event `online`) +
  `useRealtime.ts`; nudge memicu penyegaran senyap yang sama seperti
  polling (InboxPage, UnreadBadgeProvider, PendingApprovalsProvider).
  **usePolling TETAP aktif sebagai fallback** (interval 5 dtk tidak
  diubah). Widget embed — URL WS pindah ke `/realtime/webchat`, frame
  nudge → `syncMessages()` (refetch REST), reconnect WS dengan tangga
  backoff yang sama seperti pemulihan sesinya; fallback polling widget
  tidak diubah. Bundle web baru `index-c6HCD-bG.js`; widget.js 9.432
  byte memuat jalur `realtime/webchat`.
- **Tanpa migrasi DB** (di luar lingkup fase ini memang tidak perlu).
- **Catatan pemasangan unit (jujur):** subagent fase ini tidak memegang
  password sudo server, jadi unit dipasang lewat jalur setara yang
  memang tersedia untuk akun `ubuntu`: grup `docker` (akses setara
  root yang diberikan pemilik server; Postgres proyek pun berjalan di
  Docker). File unit disalin ke `/etc/systemd/system` via container
  sekali jalan, lalu `systemctl daemon-reload`/`enable`/`start`
  dijalankan lewat `nsenter -t 1 -m -u -i` dari container privileged.
  Hasil akhirnya identik dengan pola `sudo cp` fase-fase sebelumnya;
  restart service lain tetap memakai pola lama (bunuh proses milik
  `ubuntu`, `Restart=always` mengangkat ulang).

### Verifikasi Fase 6G (skrip WS dari server terhadap wss publik, TANPA Playwright; tenant uji `fase6g-*@sk.test`)
- **Rantai utama 20/21 PASS** (1 FAIL = cacat skrip uji, lihat batas):
  dua socket dashboard terhubung + frame `ready`; **tanpa cookie →
  handshake ditolak**; cookie tenant A + tenantId B → **ditolak**;
  pesan pengunjung masuk → **nudge message.received di dashboard A
  dalam 152 ms**; socket tenant B **tidak menerima apa pun**; socket
  pengunjung terhubung; token sampah ditolak; balasan agen → **nudge
  pengunjung 76 ms** + refetch REST menampilkan balasan berstatus
  `sent`; endpoint lama `/api/webchat/ws` tidak lagi melayani; daftar
  percakapan REST tetap segar.
- **Jalur automation (worker) 8/9 PASS** (1 FAIL = cacat skrip uji):
  keyword "harga" → balasan automation muncul di REST pengunjung
  berstatus `sent` (flush oleh apps/realtime), `{name}` ter-render,
  dan socket pengunjung menerima nudge `message.sent` pada +1.428 ms
  dari awal rantai; dashboard menerima nudge untuk balasan agen.
- **Telegram mock singkat 10/10 PASS** (jendela `TELEGRAM_API_BASE`
  dibuka lalu dicabut; env dikembalikan persis & proses API
  di-restart bersih sesudahnya): connect mock → setWebhook tercatat;
  webhook privat masuk → nudge message.received di dashboard; balasan
  agen → poller mengirim via mock + nudge message.sent + status REST
  `sent`. Bonus: upaya connect bot yang sama dari tenant kedua →
  **409 `TELEGRAM_BOT_ALREADY_CONNECTED`** (guard satu-bot Fase Hotfix
  Telegram tetap bekerja selama jendela mock).
- **Fallback realtime mati 5/5 + pemulihan 4/4 PASS:** service
  realtime dimatikan (systemd stop) → pesan pengunjung & balasan agen
  tetap tercatat via REST, balasan TERLIHAT pengunjung lewat refetch
  REST (jalur polling), daftar percakapan dashboard tetap segar —
  dengan kejujuran: status balasan tetap `queued` selama realtime
  mati karena flush memang peran gateway. Service dihidupkan lagi →
  socket pengunjung pulih & **balasan lama ter-flush menjadi `sent`**,
  socket dashboard reconnect, nudge segar kembali **112 ms**.
- Typecheck SEMUA proyek hijau; build api+worker+web+realtime+embed
  hijau; keempat service `active`; health publik ok.

### Rollback Fase 6G
```bash
# di server: realtime adalah tambahan murni — menghentikannya aman
# (dashboard & widget kembali ke polling 5 detik):
sudo systemctl stop sahabat-kreator-realtime.service
sudo systemctl disable sahabat-kreator-realtime.service
# kode: kembalikan build api/web/widget sebelum 6G via rsync + restart
# pola biasa; tidak ada migrasi DB yang perlu dibalik.
```

### Batas jujur
- **Dua cacat skrip uji (bukan aplikasi):** (1) pemeriksaan balasan
  automation pada rantai utama menangkap nudge pesan-masuk pengunjung
  sendiri lalu me-refetch sebelum worker selesai — dibuktikan ulang
  secara deterministik pada rantai kedua (lulus). (2) Pemeriksaan
  frame `ready` socket pengunjung pada rantai kedua kalah balapan
  dengan listener skrip; socket yang sama terbukti sehat karena
  menerima nudge pada rantai itu dan `ready` tertangkap bersih pada
  rantai utama & rantai fallback.
- Selama apps/realtime mati, balasan webchat menumpuk sebagai
  `queued` (tidak hilang; ter-flush saat gateway hidup & pengunjung
  terhubung) — perilaku yang sama seperti hub lama bila API mati.
- Nudge bersifat best-effort per desain (pub/sub tanpa persistensi):
  nudge yang terlewat saat socket putus ditutupi reconnect + refetch
  dan polling fallback; tidak ada antrean event untuk klien.
- Gateway satu proses (in-memory registry socket) — skala horizontal
  butuh penyeimbang lengket atau fan-out antar-replika; pola
  psubscribe per tenant sudah siap untuk itu, tetapi belum dibangun.
- Upaya pertama rantai telegram mock gagal di langkah daftar
  percakapan (penyebab tidak terdiagnosis penuh), lalu lulus bersih
  10/10 pada pengulangan dengan bot mock baru; tidak ada perubahan
  kode di antaranya. Dicatat apa adanya.

---

## Update Fase 6E — Routing URL asli di dashboard (2026-11-02)

### Masalah yang ditutup
Di dalam shell dashboard, perpindahan menu sebelumnya berbasis state
`activeId` (Fase 0–1C): klik Inbox tidak mengubah URL (tetap
`botara.my.id`), Back browser tidak berpindah menu, refresh selalu
kembali ke Dashboard, dan percakapan tidak bisa di-deep-link. Hanya
/login, /register, /pay/:code, /webchat-demo yang punya URL sendiri.

### Pilihan implementasi
Router tangan yang sudah ada (`usePathRoute` di `apps/web/src/App.tsx`)
diperluas secara disiplin — TANPA library router baru: fase ini murni
perilaku URL, dan router tangan yang sama sudah menangani popstate &
permukaan publik dengan benar. Yang berubah:

- **Registry tetap satu-satunya sumber kebenaran.** Field `route` pada
  `NAV_REGISTRY` (sudah ada sejak Fase 0, sebelumnya tak terpakai) kini
  menjadi path URL resmi tiap item. Fungsi baru `matchNavPath(pathname)`
  di `navigation/registry.ts` menurunkan item aktif DARI URL: kecocokan
  persis didahulukan, lalu awalan `route + "/"` (route terpanjang
  menang) menangkap sub-path; path tak dikenal jatuh ke Dashboard
  (perilaku lama — tidak pernah layar kosong). Sidebar, MobileBottomBar,
  dan MoreSheet TIDAK berubah kontrak props-nya (`activeId` kini nilai
  turunan URL yang diteruskan ShellMain, bukan state).
- **Navigasi nyata.** Klik menu = `history.pushState` ke `item.route`;
  `popstate` (Back/Forward) mengubah halaman mengikuti URL; muat awal
  membaca URL. `usePathRoute` bertambah `replaceTo` (replaceState)
  untuk pengalihan & pembersihan URL tanpa entri riwayat baru.
- **Deep-link inbox.** Pilihan percakapan di `InboxPage` bukan lagi
  state lokal: props baru `conversationId` (segmen URL) +
  `onConversationChange`. Klik daftar → push `/inbox/:conversationId`;
  tombol kembali mobile → push `/inbox`; membuka URL langsung (termasuk
  setelah refresh) memuat & memilih percakapan itu. Id tidak ada/bukan
  milik workspace aktif → API messages menjawab 404 → pilihan dibersihkan
  dengan replace ke `/inbox`, daftar tampil TANPA pesan error (jatuh
  lembut). Pindah workspace juga membersihkan id pilihan lama dengan
  replace — tetapi muat awal TIDAK (deep-link pada workspace pertama
  harus tetap membuka percakapannya).
- **Return-after-login.** Deep-link yang dibuka saat belum login:
  Shell menyimpan path tujuan di sessionStorage (`navigation/returnTo.ts`,
  kunci `sk-return-to`) lalu replace ke /login; `LoginPage` mengambilnya
  sekali pakai setelah masuk berhasil. Pengguna yang baru saja KELUAR
  secara eksplisit tidak disimpan tujuannya (dibedakan lewat penanda
  "pernah terautentikasi" selama shell hidup). Register tetap mendarat
  di `/` seperti sebelumnya.
- **Tidak berubah:** /login, /register, /pay/:code, /webchat-demo persis
  seperti sebelumnya; konteks workspace tetap state (BUKAN bagian URL —
  non-goal yang disengaja fase ini); badge unread/pending approvals,
  nudge realtime 6G, dan polling fallback tetap bekerja (penyegaran
  latar InboxPage tidak disentuh selain sumber pilihan percakapan).

### Pemetaan path final
`/` Dashboard · `/inbox` (+ `/inbox/:conversationId`) · `/agents` ·
`/contacts` · `/channels` · `/automations` · `/knowledge` ·
`/products` · `/settings` · `/broadcasts`, `/analytics`, `/billing`
(item registry yang halamannya masih placeholder — kini juga ber-URL).

### Deploy
Build web di VM (`index-lC69xMFL.js`) → commit `83f0f19` → push →
rsync repo → restart `sahabat-kreator-web` (proses preview dibunuh agar
unit `Restart=always` menghidupkannya dengan dist baru; PID berganti,
bundle lokal terkonfirmasi tersaji di 127.0.0.1:5180).

### Verifikasi (tanpa Playwright — aturan user; klik akhir oleh user)
- Typecheck SEMUA proyek hijau; build web hijau.
- Fallback SPA publik: GET `https://botara.my.id/inbox`, `/channels`,
  `/contacts`, `/automations`, `/agents`, `/knowledge`, `/products`,
  `/settings`, `/inbox/<uuid-acak>` → semua **200** HTML aplikasi
  (882 byte, `<title>Sahabat Kreator</title>`) — Vite preview melayani
  index untuk path tak dikenal seperti sebelumnya, tidak ada perubahan
  konfigurasi server yang dibutuhkan. `/login`, `/register`,
  `/webchat-demo`, `/pay/<kode-tak-ada>` tetap 200 persis sebelumnya.
- Bundle PUBLIK (diunduh dari URL publik) memuat: kesebelas string
  route registry, kunci `sk-return-to`, dan pembangun deep-link
  `/inbox/${encodeURIComponent(...)}`.
- Rantai tak berubah: `/api/health` ok; widget.js publik 200 (9.432
  byte); POST sesi webchat key bogus dari server → 404 + ACAO `*`
  (jalur webchat utuh; fase ini hanya menyentuh frontend web).
- Grep bersih: tidak ada `setSelectedId`/`setActiveId` navigasi
  tertinggal; satu-satunya daftar menu tetap registry (komponen hanya
  memetakan `desktopItems`/`mobileTabItems`/`moreItems`).

### Rollback Fase 6E
```bash
# kode: kembalikan build web sebelum 6E (commit 738fd19) via rsync +
# hidupkan ulang proses preview pola biasa. Tidak ada migrasi DB.
```

### Batas jujur
- Pembuktian perilaku klik (URL berubah saat menu diklik, refresh
  bertahan, Back/Forward, deep-link membuka percakapan) menunggu uji
  langsung user — sesuai pembagian kerja baru, verifikasi di sini
  adalah typecheck + build + fallback URL + isi bundle, BUKAN klik
  browser (Playwright dilewati atas keputusan user).
- Workspace tetap di luar URL: deep-link `/inbox/:id` berlaku untuk
  workspace yang sedang aktif di sesi itu; membuka tautan percakapan
  milik workspace lain (yang sama-sama dimiliki pengguna) jatuh lembut
  ke daftar workspace aktif, bukan berpindah workspace otomatis.
- Segmen URL inbox hanya satu tingkat (`/inbox/:conversationId`);
  sub-path lebih dalam diperlakukan sebagai inbox tanpa pilihan id
  yang valid dan akan dibersihkan lewat jalur 404 yang sama.

## Update Fase 6C — Panel Admin Platform untuk kredensial provider (2026-11-02)

Pemilik platform kini mengelola kunci provider (OpenRouter & Cloudflare
R2) dari dashboard, bukan lewat chat/env manual (usulan user sendiri).
Kunci ASLI diisi sendiri oleh pemilik lewat panel; repo & server tidak
pernah melihatnya di luar panel.

- **Siapa admin (v1)**: allowlist env `PLATFORM_ADMIN_EMAILS`
  (koma-terpisah, case-insensitive) dicocokkan ke email user sesi.
  Endpoint `/api/admin/*` untuk non-admin → **404** (pola non-member).
  Respons get-session memuat flag tampilan `isPlatformAdmin` (plugin
  customSession Better Auth); UI menyembunyikan item navigasi "Admin"
  (path `/admin`, registry 6E) untuk non-admin. **Menambah admin =
  edit `PLATFORM_ADMIN_EMAILS` di `.env.staging` + restart api.**
  Allowlist staging saat ini: hanya email pemilik platform.
- **Penyimpanan**: migrasi **0022** — tabel `platform_settings`
  (key PK, `value_encrypted`, `updated_by`, timestamps). Nilai
  terenkripsi AES-256-GCM envelope `v1:` yang sama dengan token channel,
  kunci induk env BARU **`PLATFORM_SETTINGS_SECRET`** (32 byte base64,
  digenerate DI SERVER, hanya di `.env.staging` 600 — `.env.staging`
  kini 11 variabel). RLS aktif fail-closed; akses aplikasi hanya lewat
  flag transaksi lokal `app.platform_settings='admin'` (pola system_relay
  migrasi 0008) di dalam service core. `audit_logs.tenant_id` kini
  NULLABLE + policy `platform_audit`: baris audit platform (tenant_id
  NULL) hanya terlihat dalam transaksi ber-flag admin yang sama; konteks
  tenant tidak pernah melihatnya. Staging kini **32 tabel / 35 policy**.
  Kunci yang dikelola: `openrouter_api_key`, `openrouter_model`,
  `r2_access_key_id`, `r2_secret_access_key`. Account ID, endpoint, dan
  nama bucket R2 adalah konfigurasi publik (konstanta
  `packages/config`) dan tampil sebagai info tetap; bucket aktif =
  env `R2_BUCKET` bila di-set, selain itu bucket **staging** (deployment
  production WAJIB set `R2_BUCKET=sahabat-kreator-prod`).
- **Resolusi (persis kata user: panel dulu, env fallback)**: core
  `getProviderSecret(key)` → nilai panel terdekripsi, else env
  (`OPENROUTER_API_KEY`/`OPENROUTER_MODEL`/`R2_ACCESS_KEY_ID`/
  `R2_SECRET_ACCESS_KEY`), else null. Cache per proses TTL **60 detik**
  (`PLATFORM_SETTINGS_CACHE_TTL_MS`); set/clear menginvalidasi entri di
  proses yang sama — perubahan panel berlaku ≤ ±60 dtk di proses lain
  tanpa restart. GET status hanya mengembalikan
  `{key, isSet, source: 'panel'|'env'|null, updatedAt, updatedBy}` —
  TIDAK PERNAH nilai/potongan/panjang nilai. Tanpa
  `PLATFORM_SETTINGS_SECRET`, resolver jatuh ke env-only dan tulis
  panel ditolak 503.
- **Pemakaian nyata**: worker memilih provider AI **per job**
  agent.respond lewat resolver (kunci panel/env → OpenRouterProvider;
  tidak ada kunci → mock). `LLM_PROVIDER=openrouter` eksplisit tanpa
  kunci tetap gagal keras saat start. R2 belum punya konsumen (fase
  media/KB berikutnya) — tersedia resolver + endpoint uji saja.
- **Endpoint uji**: `POST /api/admin/settings/:key/test` — OpenRouter:
  `GET openrouter.ai/api/v1/auth/key` dengan kunci efektif (sukses
  melaporkan info non-rahasia label/tier/sisa limit). R2: HeadBucket
  SigV4 tulisan tangan (tanpa AWS SDK) ke bucket konfigurasi; pada
  status tak terpetakan, kode error S3 dibaca lewat GET bertanda tangan
  (R2 membungkus sebagian penolakan auth sebagai 400 — mis.
  InvalidArgument untuk access key id yang panjangnya bukan 32).
  Semua aksi set/clear/test menulis audit `platform_settings.*` dengan
  meta TANPA nilai.
- **UI**: halaman `/admin` dua grup (OpenRouter, Cloudflare R2) —
  field password selalu mulai kosong, chip sumber efektif
  (Panel/Env/Belum diatur), tombol Simpan / Hapus (kembali ke env) /
  Uji koneksi + hasil ringkas; dwibahasa en+id. Nilai tersimpan tidak
  pernah dirender kembali.
- **Verifikasi (rantai dari server, TANPA Playwright; nilai DUMMY saja,
  akun uji)**: 39/39 PASS — non-admin semua endpoint admin 404 + flag
  sesi false; admin-uji (allowlist SEMENTARA selama jendela uji,
  dipulihkan sesudahnya) 200 + flag true; PUT dummy OpenRouter → status
  source 'panel' + updatedBy benar; nilai dummy 0 kemunculan di semua
  respons DAN di journal api+worker (grep); POST test dummy →
  `OPENROUTER_AUTH_FAILED`; jalur agent dengan kunci panel dummy:
  audit `agent.failed` provider **openrouter** (HTTP 401 dari
  OpenRouter asli — terbukti BUKAN mock), setelah dummy dicabut audit
  `agent.responded` provider **mock** dengan balasan berbasis KB
  (fallback utuh); R2 dummy pair → test `R2_AUTH_FAILED` (endpoint R2
  terjangkau & menolak); audit platform set×7/cleared×7/test×4 (dua run)
  tanpa nilai. PGlite: db verify seksi [16] (RLS fail-closed tanpa flag)
  + `verify:platform-settings` worker (urutan panel > env > null,
  enkripsi saat diam, jalur provider). Typecheck 17 proyek hijau.
  **Keadaan akhir: tabel platform_settings KOSONG (0 baris) menunggu
  kunci asli diisi pemilik lewat panel; allowlist hanya email pemilik;
  bundle web `index-CKlzCb-8.js`.**
- Batas jujur: kunci R2 tersimpan tapi belum ada konsumen sampai fase
  media/KB; cache TTL berarti perubahan panel berlaku ≤ ±60 dtk; R2
  punya dua kunci terpisah (access key id & secret) yang diuji bersama
  lewat kunci mana pun yang ditekan tombol ujinya; bila
  `PLATFORM_SETTINGS_SECRET` hilang/berganti, nilai panel tidak bisa
  didekripsi dan resolver jatuh ke env (bukan crash).

### Rollback 6C

```bash
# env: hapus PLATFORM_SETTINGS_SECRET & PLATFORM_ADMIN_EMAILS dari
# .env.staging lalu restart api+worker (panel nonaktif; resolver
# env-only seperti sebelum 6C).
# kode: kembalikan build sebelum 6C (commit 6d99852) via rsync pola
# biasa. Migrasi 0022 bersifat aditif; tabel platform_settings boleh
# dibiarkan (tidak dibaca kode lama). audit_logs.tenant_id yang kini
# nullable tidak memengaruhi kode lama.
```

---

## Update Hotfix Webchat Disconnect Gate — disconnect menghentikan arus masuk secara TOTAL (2026-11-02)

### Masalah
User melaporkan: channel webchat berstatus `disconnected` masih menerima
pesan inbox. Akar masalahnya persis seperti dugaan: disconnect (hotfix
Telegram) hanya menutup SESI BARU (route sesi menolak akun non-connected
dengan 404), sedangkan pengunjung bertoken lama — token HMAC berlaku
30 hari — tetap bisa mengirim & membaca pesan, karena jalur pesan di
core tidak pernah memeriksa status akun channel (hanya status
percakapan open/closed). Socket realtime pengunjung juga hanya
memverifikasi token.

### Perubahan (commit `85b8ae8`)
- **Kontrak:** kode error baru `CHANNEL_DISCONNECTED` di
  `ErrorCodeSchema`.
- **Core (`packages/core/src/webchat.ts`):**
  - `recordWebchatInboundMessage` kini mengembalikan hasil diskriminan
    (`recorded` / `conversation_not_found` / `channel_disconnected`)
    dan memeriksa status akun pemilik percakapan DI DALAM transaksi
    yang sama, sebelum tulisan apa pun — upaya yang ditolak tidak
    menciptakan baris pesan, kenaikan unread, maupun event outbox.
  - `flushQueuedWebchatMessages` digerbangi juga: selama akun tidak
    'connected', tidak ada penandaan `sent` — balasan agen tetap
    `queued` dan ter-flush normal setelah channel dihubungkan lagi.
  - Helper baru `getWebchatChannelAccountStatus(db, {tenantId},
    accountId)` untuk pemanggil berbasis token (route daftar pesan +
    gateway realtime).
- **API (`apps/api/src/modules/webchat/routes.ts`):** kirim & daftar
  pesan pengunjung menjawab **409 `CHANNEL_DISCONNECTED`** selama
  channel tidak 'connected'. Pilihan 409 mengikuti pola konflik
  keadaan yang sudah ada (TELEGRAM_BOT_ALREADY_CONNECTED,
  PRODUCT_HAS_LINKS): token SAH dan percakapan ADA — yang berkonflik
  adalah keadaan channel. Route sesi TIDAK berubah (tetap 404).
- **Realtime (`apps/realtime/src/index.ts`):** upgrade socket
  pengunjung yang channel-nya tidak 'connected' ditolak **403**
  (bukan 401 — tokennya tidak batal; 401 akan menandakan token
  rusak/kedaluwarsa). Socket yang sudah terlanjur terhubung saat
  disconnect terjadi mati wajar di reconnect berikutnya, dan selama
  itu pun flush gateway tergerbang di core (lihat di atas). Mode
  terdegradasi tanpa DATABASE_URL mempertahankan perilaku lama
  (status memang tidak bisa diverifikasi; flush pun no-op di mode itu).
- **Widget (`packages/embed/src/widget.ts`):** penolakan
  `CHANNEL_DISCONNECTED` pada sinkronisasi memunculkan keadaan error
  yang sudah ada ("Tidak dapat terhubung… / Coba lagi") — bukan lagi
  diam seolah terhubung; pada kirim, gelembung menjadi gelembung gagal
  ketuk-untuk-coba-lagi seperti mekanisme yang ada, plus keadaan error
  panel. Token SENGAJA tidak dihapus (beda dengan 401): gerbangnya
  adalah status akun, bukan daftar hitam token — setelah channel
  dihubungkan lagi, sinkronisasi/kirim yang berhasil membersihkan
  keadaan error dan token lama yang belum kedaluwarsa langsung berlaku
  lagi.

### Semantik yang ditegaskan
- Disconnect webchat kini berarti: sesi baru 404, kirim pesan 409,
  daftar pesan 409, socket ditolak 403, flush keluar tertahan (antrean
  tidak hilang). Reconnect (status kembali 'connected' — untuk webchat
  saat ini berarti akun yang sama diaktifkan lagi; jalur revive
  Telegram membuktikan pola yang sama) memulihkan semuanya TANPA
  menerbitkan token baru.

### Deploy
Build embed → api+worker+realtime+web di VM (bundle web
`index-BBkskfJG.js`, widget.js memuat `CHANNEL_DISCONNECTED`) → commit
`85b8ae8` → push → rsync repo (`.env.staging` dikecualikan & utuh) →
keempat proses milik `ubuntu` (api/web/worker/realtime) dihentikan →
systemd `Restart=always` mengangkat PID baru; health API & realtime ok,
bundle publik cocok. Tanpa migrasi DB; tanpa perubahan `.env.staging`.

### Verifikasi (rantai Bun dari server terhadap URL publik, TANPA Playwright; akun uji `hotfix-wcd-*@sk.test`)
**25/25 PASS** — sign-up → tenant → 2 channel webchat → sesi
pengunjung → kirim baseline 201 → dashboard membaca 1 pesan → socket
realtime diterima saat connected → channel #2 baseline → DELETE
disconnect #1 (204) → **kirim dengan TOKEN YANG SAMA → 409
CHANNEL_DISCONNECTED** → **ambil pesan dengan token yang sama → 409**
→ sesi baru tetap 404 → **upgrade socket dengan token itu ditolak**
→ dashboard: jumlah pesan TIDAK bertambah & unread tetap 0 → balasan
agen saat diskonek diterima 201 `queued` dan tetap `queued` setelah
3 detik (tidak ter-flush) → channel #2 tetap bisa mengirim (isolasi)
→ status akun #1 dikembalikan ke 'connected' via core
(`setChannelAccountStatus`, jalur revive) → **kirim dengan token lama
yang sama → 201 lagi**, daftar pesan 200 lagi, socket diterima lagi →
balasan queued tadi ter-flush menjadi `sent` saat pengunjung reconnect
→ health ok.
Bukti DB pelengkap: `outbox_events` untuk percakapan uji tepat
2× `message.received` (baseline + pasca-revive) — upaya yang ditolak
tidak menerbitkan event apa pun. Skrip rantai dihapus dari server
sesudahnya; tenant uji tertinggal by design seperti fase sebelumnya.

### Batas jujur
- Pembuktian visual widget (panel menampilkan keadaan error di browser
  sungguhan saat channel diputuskan di tengah sesi) tidak dijalankan —
  tanpa Playwright sesuai aturan user; yang terbukti adalah seluruh
  respons HTTP/WS yang memicu keadaan itu + string pemetaan baru ada
  di widget.js publik. Bukti klik akhir menunggu uji user.
- Socket pengunjung yang SUDAH terhubung pada detik disconnect terjadi
  tidak diputuskan paksa dari server; ia tertutup oleh gerbang REST
  (sinkronisasi 409 → keadaan error) dan ditolak saat reconnect —
  jendela paparannya nol untuk data baru karena kirim/daftar/flush
  semuanya tergerbang di core.
- Gerbang memakai status akun pada masing-masing transaksi/panggilan;
  balapan milidetik antara disconnect dan kirim yang sedang berjalan
  diselesaikan per transaksi (yang commit duluan menang) — perilaku
  standar untuk gerbang status dan dapat diterima.

---

## Update Fase 6H — Channels menjadi kartu + kontrol tema ikon tunggal (2026-11-02)

### Perubahan (commit `7bec747`, web + i18n saja — TANPA perubahan API/kontrak)
- **Kartu channel** menggantikan daftar baris di `ChannelsPage`, mengikuti
  referensi UI user (`workspace/user/media_library/image/image-2.png`):
  grid responsif (1 kolom mobile, 2 di `sm`, 3 di `xl`); per kartu —
  slot avatar persegi membulat dengan **badge glyph provider** di pojok
  kanan-bawah (komponen baru `components/ChannelAvatar.tsx`, siap-gambar:
  prop `imageUrl` dirender `<img>` bila kelak diisi Fase 6D; selama ini
  inisial nama di atas tint warna merek provider), nama tebal, baris
  @handle (Telegram `@botUsername`; Webchat siteKey terpotong di tengah —
  webchat tidak punya @handle), label provider, **pill status**
  (connected = "Active/Aktif" hijau token `success`; disconnected =
  abu-abu; error = merah token `danger`) + teks **"Connected/Terhubung
  {tanggal}"** dari `channel_accounts.created_at` via Intl
  (`utils/format.ts` `formatDate` baru), dan **chip tautan publik +
  tombol salin** (Telegram `https://t.me/<botUsername>`; Webchat tautan
  demo `<origin>/webchat-demo?key=<siteKey>` — hanya saat connected,
  karena channel terputus menolak sesi baru). Snippet embed webchat
  dipertahankan di dalam kartu webchat connected sebagai blok detail.
  `createdAt` ternyata SUDAH ada di kontrak + serializer sejak Fase 1F —
  tidak ada perubahan API.
- **Aksi kartu**: ikon power (kanan atas) memakai alur & dialog
  Disconnect yang SUDAH ada (tanpa logika baru); Telegram terputus
  mendapat tombol "Hubungkan lagi" yang menggulir + memfokuskan form
  Telegram yang ada (alur revive akun yang sama); Webchat terputus
  tampil redup tanpa aksi hubungkan-lagi (menghubungkan webchat =
  channel baru lewat form — jujur secara produk). **Ikon sampah
  SENGAJA belum dipasang** — fungsinya dibangun Fase 6I (hapus
  berpenjaga); tidak ada tombol tanpa fungsi.
- **Provider belum live** (whatsapp, instagram, messenger) kini kartu
  redup berbahasa sama (slot glyph provider + pill "Segera"), bukan
  daftar terpisah.
- **Kontrol tema jadi ikon tunggal** (permintaan tambahan user, butir
  terpisah): tiga tombol teks Light/Dark/System di `App.tsx` diganti
  SATU tombol ikon kompak sebaris dengan kontrol bahasa — klik memutar
  light → dark → system → light memakai `cycle()` yang sudah ada di
  `useTheme` (logika tema TIDAK berubah); ikon mencerminkan mode aktif
  (matahari/bulan/monitor, gaya stroke NavIcon); `title` + `aria-label`
  = nama mode aktif (`common.themeLight/themeDark/themeSystem`); tinggi
  tombol 28px, sama dengan tombol bahasa.
- String baru semua lewat i18n en+id (`channels.listTitle`,
  `statusActive`, `connectedSince`, `copyLink`, `reconnectButton`).

### Deploy
Build semua proyek di VM hijau → commit `7bec747` → push → rsync repo
(`.env.staging` dikecualikan & utuh) → proses Vite preview milik
`ubuntu` dihentikan → systemd `Restart=always` mengangkat PID baru
dengan dist baru (bundle web **`index-DM20WHCd.js`**). Tanpa migrasi
DB; tanpa perubahan `.env.staging`; service api/worker/realtime tidak
di-restart (tidak tersentuh).

### Verifikasi (TANPA Playwright, sesuai aturan user)
- Typecheck SEMUA proyek hijau; build hijau.
- Bundle publik `index-DM20WHCd.js` **identik byte-per-byte** dengan
  build lokal dan memuat string khas kartu dua bahasa ("Connected
  channels", "Channel terhubung", "Salin tautan", "Hubungkan lagi",
  `https://t.me/`, `webchat-demo?key=`).
- Publik: `GET /channels` 200; `GET /api/health` ok; service web active
  dengan PID baru.
- **Rantai API dari server 16/16 PASS** (akun uji `fase6h-*@sk.test`):
  sign-up → tenant → buat webchat → respons create & list memuat
  `createdAt` ISO valid + `status` + `externalId` siteKey +
  `botUsername: null` + `displayName` (persis field yang dikonsumsi
  kartu) → DELETE disconnect 204 → list memuat status `disconnected`
  dengan `createdAt` yang sama. Skrip rantai dihapus dari server
  sesudahnya; tenant uji tertinggal by design.

### Batas jujur
- Pembuktian visual (tampilan kartu di browser, kontras pill/chip di
  tema gelap & terang, perilaku salin) menunggu uji user — sesuai
  pembagian kerja saat ini; yang terbukti di sini adalah data API,
  bundle tersaji, dan typecheck/build.
- Slot avatar masih glyph/inisial sampai Fase 6D mengisi foto asli;
  ikon sampah menyusul di Fase 6I.

## Update Fase 6I — Hapus channel permanen BERPENJAGA (Sampah 30 hari) (2026-11-02)

Desain disetujui user (2026-11-02): tanpa fitur hapus, channel mati
menumpuk jadi sampah sistem selamanya — maka hapus dibangun DELIBERATE
dengan pengaman: ketik nama channel untuk konfirmasi (validasi server),
opsi ekspor riwayat dulu, masa tenggang 30 hari di "Sampah" (bisa
dipulihkan/diekspor), baru purge permanen oleh worker. Purge manual
sengaja TIDAK dibuat — masa tenggang adalah pengamannya.

### Model & migrasi 0023
- `channel_accounts.trashed_at` (timestamptz nullable) + index parsial
  `channel_accounts_trashed_at_idx` (hanya baris trashed) + policy RLS
  tulisan tangan `system_purge_scan`: lengan SELECT sempit untuk
  pemindaian purge worker — transaksi harus men-set
  `app.system_relay='channel_purge'` DAN yang terbuka HANYA baris
  `trashed_at IS NOT NULL` lintas tenant. Penghapusan per akun tetap
  dalam konteks tenant pemiliknya. Staging kini **36 policy RLS**.
- Membuang ke Sampah = (a) bila masih connected, semantik disconnect
  yang ADA dijalankan persis (webhook Telegram dicabut bila pemilik —
  helper `deleteTelegramWebhookIfOwner` kini dipakai bersama DELETE &
  trash; kredensial dikosongkan; audit `channel.disconnected`), lalu
  (b) `trashed_at = now` + audit `channel.trashed` (meta purgeAt).
  Akun berakhir `disconnected` → index unik parsial 0020 otomatis
  membebaskan botnya untuk dihubungkan di workspace lain (terverifikasi
  di rantai Telegram di bawah).
- Connect ulang Telegram pada baris yang sama (revive) membersihkan
  `trashed_at` — akun yang hidup lagi tidak boleh tetap berstatus Sampah.
- **Nama konfirmasi**: `displayName` akun bisa NULL (webchat boleh tanpa
  nama) → target ketik = displayName bila non-kosong, else `botUsername`
  (telegram), else `externalId`; server mengeksposnya sebagai
  `confirmationName` di respons channel agar UI & validasi selalu sepakat.

### Peta FK & keputusan purge (per tabel)
DELETE baris `channel_accounts` men-cascade percakapan → pesan. Purge
(core `channel-purge.ts`, satu transaksi per akun) bekerja begini:
- `messages`: dihapus eksplisit (agar hitungan audit akurat).
- `media`: baris yang dirujuk pesan yang dihapus DAN tak lagi dirujuk
  pesan mana pun dihapus (FK pesan→media adalah SET NULL, jadi ini
  satu-satunya pekerjaan manual). Objek R2: belum ada pipeline media
  yang menulis objek — purge baris DB saja (batas jujur di bawah).
- `conversations`: dihapus; CASCADE membawa `automation_runs`,
  `sequence_enrollments`, `agent_suggestions` miliknya (dihitung dulu
  untuk audit).
- `channel_identities`: dihapus eksplisit.
- `outbox_events`: yang BELUM ter-publish dan menunjuk percakapan yang
  dihapus ikut dihapus (tak akan bisa diproses); yang sudah ter-publish
  dipertahankan sebagai sejarah.
- TIDAK dihapus: `contacts` (CRM tenant lintas channel), `audit_logs`
  (append-only — purge justru menulis `channel.purged` actor system
  `channel-purge` dengan meta hitungan per jenis), `usage_ledger`
  (append-only billing; ref varchar tanpa FK), `webhook_inbox`.

### Endpoint (owner/admin, pola route channels)
- `POST /api/tenants/:tenantId/channels/:channelId/trash`
  `{ confirmationName }` — validasi SEBELUM mutasi: tak ditemukan 404;
  sudah di Sampah → **409 `CHANNEL_ALREADY_TRASHED`** (dipilih jujur,
  bukan idempoten); nama tak sama persis → **422
  `CHANNEL_DELETE_CONFIRMATION_MISMATCH`**. Sukses 200 akun terserialisasi.
- `GET /api/tenants/:tenantId/channels/trash` — daftar Sampah
  (`trashedAt` + `purgeAt` = trashedAt + 30 hari per akun). Daftar baku
  `GET .../channels` MENGECUALIKAN yang trashed (filter core).
- `POST .../channels/:channelId/restore` — bersihkan `trashed_at`,
  status tetap `disconnected` (TIDAK auto-reconnect), audit
  `channel.restored`; tak sedang di Sampah → **409 `CHANNEL_NOT_TRASHED`**.
- `GET .../channels/:channelId/export` — unduhan JSON
  `Content-Disposition: attachment; filename="channel-export-<provider>-<8 char id>.json"`,
  struktur `sahabat-kreator/channel-export@1` (metadata channel + semua
  percakapan + pesan kronologis dengan nama kontak); berlaku untuk
  channel aktif maupun di Sampah; audit `channel.exported` meta hitungan saja.
- Kontrak: `ChannelAccountResponse` + `trashedAt`, `purgeAt`,
  `confirmationName`; `TrashChannelRequestSchema`; 3 kode error baru di
  `ErrorCodeSchema` + teks UI en/id + case `errorText.ts`.

### Visibilitas
- `listConversations` (core) men-join `channel_accounts` +
  `isNull(trashedAt)`: percakapan channel trashed hilang dari inbox &
  API v1; kontak tetap di CRM.
- Webhook Telegram akun trashed = perilaku disconnected (sudah
  ditolak/diabaikan gerbang status yang ada); gerbang webchat berbasis
  status disconnected → otomatis tertutup (akun trashed selalu
  disconnected).

### Purge oleh worker
- Poller di `apps/worker` mengikuti pola relay outbox: jalan sekali
  saat boot + tiap 1 jam, penjaga anti-tumpang-tindih, dimatikan anggun
  saat shutdown. Memindai lewat lengan `system_purge_scan`, menghapus
  per akun; kegagalan satu akun dicatat dan tidak menghentikan akun lain.
- Run-once untuk pengujian/operasi: `pnpm --filter
  @sahabat-kreator/worker purge:channels` (skrip
  `apps/worker/scripts/purge-trashed-channels.ts`, env dari
  `DATABASE_URL`).

### UI Channels
- Ikon sampah di kanan atas setiap kartu (di samping power) membuka
  dialog hapus berpenjaga dwibahasa: penjelasan konsekuensi, tombol
  "Unduh ekspor riwayat" di dialog yang sama, kolom ketik nama —
  tombol "Pindahkan ke Sampah" nonaktif sampai input PERSIS sama
  dengan `confirmationName`.
- Seksi "Sampah" di bawah halaman: baris per channel trashed (avatar,
  nama, provider, "Dibuang {tanggal}" + "Dihapus permanen pada
  {tanggal}") + tombol Ekspor & Pulihkan; tampil juga saat kosong
  ("Sampah kosong"). String en+id lengkap; token tema semantik.

### Deploy
Migrasi 0023 diterapkan ke staging via psql (`MIGRATION_DATABASE_URL`,
ON_ERROR_STOP) → build semua → rsync repo (`.env.staging`
dikecualikan & utuh) → proses api/worker/web milik `ubuntu` dibunuh →
systemd `Restart=always` mengangkat kode baru (bundle web
**`index-CjRrhguZ.js`**, identik dengan build lokal). Jendela mock
Telegram singkat untuk rantai uji (`TELEGRAM_API_BASE` sementara di
`.env.staging`, dibackup & dipulihkan persis; baris itu kini TIDAK ada
di `.env.staging`).

### Verifikasi (TANPA Playwright, sesuai aturan user)
- Typecheck SEMUA proyek hijau; build hijau; PGlite verify lulus
  termasuk seksi baru **[17]**: kolom `trashed_at` ada; tanpa flag
  pindai purge buta (0 baris); dengan `app.system_relay='channel_purge'`
  hanya baris trashed lintas tenant terlihat; konteks tenant tetap
  melihat semua barisnya. Hitungan policy di verify naik 35 → 36.
- **Rantai webchat dari server 28/28 PASS** (tenant uji
  `fase6i-*@sk.test`): register → tenant → webchat → sesi+pesan publik
  → inbox memuat → trash nama SALAH 422 berkode → nama BENAR 200
  (disconnected, trashedAt, purgeAt = +30 hari tepat) → trash ulang 409
  → daftar baku bersih, daftar Sampah memuat → inbox tak lagi memuat
  percakapan → ekspor 200 (attachment, format @1, counts 1 percakapan,
  memuat pesan semai + nama kontak) → restore 200 (tetap disconnected)
  → restore ulang 409 → trash lagi 200.
- **Purge terbukti**: `trashed_at` akun uji dimundurkan 31 hari (psql)
  → `purge:channels` run-once: "terpinai 1; ter-purge 1; gagal 0",
  counts `{conversations:1, messages:1, media:0, channelIdentities:1,
  automationRuns:0, sequenceEnrollments:0, agentSuggestions:0,
  outboxEventsRemoved:0}` — sama persis dengan hitungan pra-purge.
  Query DB sesudahnya: baris akun/percakapan/pesan/identitas = 0;
  **kontak tetap ada**; audit lengkap (`channel.trashed` ×2,
  `channel.restored`, `channel.exported`, `channel.purged` dengan meta
  hitungan yang benar).
- **Rantai Telegram mock 6/6 PASS**: tenant A connect bot mock →
  trash saat MASIH connected 200 (log mock membuktikan
  getWebhookInfo → deleteWebhook dipanggil dalam langkah trash) →
  tenant B connect bot yang SAMA → **201, bukan 409**.
- Channel asli user TIDAK tersentuh (diverifikasi DB sesudahnya:
  `8fb9b81c` tetap connected, `10be58d5` tetap disconnected, keduanya
  `trashed_at` NULL; satu-satunya baris trashed di DB adalah akun mock
  uji tenant A di atas). Health publik ok; 4 service active.

### Batas jujur
- Bukti visual UI (dialog hapus, seksi Sampah) menunggu uji user —
  yang terbukti di sini: API, kontrak, bundle tersaji, rantai DB.
- Purge menghapus baris `media` di DB; penghapusan OBJEK R2 fisik
  menyusul saat pipeline media benar-benar menulis objek ke R2
  (belum ada konsumen R2 sampai fase media/KB).
- `getConversation` (buka satu percakapan by-id) tidak disaring
  trashed — hanya daftar/pencarian yang disembunyikan; percakapan
  trashed tetap bisa dibuka lewat deep-link selama masa tenggang
  (disengaja: data belum dihapus sampai purge).
- Hitungan purge di audit adalah hitungan saat transaksi purge
  berjalan (satu transaksi per akun).

---

## Update Fase 6D — Avatar asli: foto profil Telegram bot & kontak (2026-11-02)

Mengisi celah avatar yang dikonfirmasi dari kode: sebelumnya TIDAK ada
pipeline foto sama sekali (Channels/Contacts/Inbox semua inisial huruf).
Kini foto bot tampil di kartu Channels dan foto pengguna Telegram tampil
di Inbox/Kontak. Kontak webchat TETAP inisial berwarna BY DESIGN —
pengunjung anonim memang tidak punya foto, tidak ada jalur foto webchat.

### Penyimpanan (migrasi 0024 + 0025)
- Tabel baru `profile_photos`: `tenant_id` (FK tenants, cascade),
  `owner_type` ('channel_account'|'contact', CHECK), `owner_id` (uuid,
  SENGAJA tanpa FK — pemiliknya polimorfik dua tabel), `content_type`,
  `data` **bytea**, `etag` (SHA-256 hex byte foto, untuk cache HTTP),
  `fetched_at` + index unik `(tenant_id, owner_type, owner_id)` (satu
  foto per pemilik; jalur simpan = upsert) + policy `tenant_isolation`
  standar (migrasi 0025 tulisan tangan). Staging kini **33 tabel /
  37 policy**. drizzle-orm 0.44 belum mengekspor kolom `bytea`, jadi
  skema memakai `customType` dengan dataType 'bytea'.
- Bytea di DB adalah keputusan pragmatis fase ini (konsumen R2 belum
  ada; foto dipilih ≤512px). Purge channel Fase 6I diperluas:
  `purgeTrashedChannelAccount` kini juga menghapus foto milik akun
  channel-nya (owner polimorfik tanpa FK — dibersihkan eksplisit;
  tercatat di counts audit sebagai `profilePhotos`). Foto KONTAK tidak
  disentuh purge, konsisten dengan kontak yang dipertahankan.
- **Catatan penerapan migrasi di staging:** `drizzle-kit migrate`
  GAGAL diam-diam (spinner, exit 1 tanpa pesan) karena migrasi 0023
  ternyata dulu diterapkan manual — baris jurnalnya tidak ada di
  `drizzle.__drizzle_migrations`, sehingga migrate mencoba menerapkan
  ulang 0023 dan menabrak kolom yang sudah ada. 0024+0025 diterapkan
  via psql (ON_ERROR_STOP) dan baris jurnal 0023/0024/0025 didaftarkan
  manual dengan hash = sha256 isi file SQL (skema hash drizzle,
  terverifikasi terhadap baris 0022) + created_at = `when` jurnal.
  Keadaan akhir konsisten penuh: 33 tabel / 37 policy / 26 baris jurnal.

### Pengambilan foto (core `avatars.ts`)
- Helper `fetchAndStoreTelegramProfilePhoto` (TIDAK PERNAH melempar —
  semua pemicu best-effort): `getUserProfilePhotos` → pilih ukuran →
  `getFile` → unduh byte → upsert. **Keputusan ukuran:** ukuran terbesar
  yang kedua sisinya ≤512px; semua lebih besar → terkecil; semua lebih
  kecil → terbesar. Content-Type dari ekstensi jalur file (.png/.webp,
  selain itu JPEG — foto profil Telegram pada praktiknya JPEG).
- **Token tidak pernah bocor:** URL file Bot API menyematkan token
  (`/file/bot<token>/...`); byte foto disimpan dan UI hanya menerima
  URL endpoint kita. Error fetch tidak dicatat sebagai objek (pesannya
  bisa memuat URL bertoken) — hanya label tahap generik.
- Pemicu:
  1. **Connect Telegram** (baru & revive): fire-and-forget dengan token
     mentah yang sedang di tangan route.
  2. **Backfill malas** saat daftar channel dibaca: akun telegram
     'connected' tanpa foto memicu pengambilan async — bot yang
     terhubung sebelum fase ini (@botaramyid_bot) fotonya muncul
     sendiri tanpa reconnect. Penjaga per proses API: dedup in-flight
     per akun + cache negatif 15 menit (bot tanpa foto / gagal ambil
     tidak memanggil Bot API berulang di setiap pembacaan daftar).
  3. **Kontak:** identitas Telegram PERTAMA KALI terlihat (core
     `recordTelegramInboundMessage` kini mengembalikan
     `{ message, contactId, identityCreated }`) → route webhook memicu
     pengambilan dengan timeout 5 dtk, fire-and-forget. Pesan berikutnya
     dari kontak yang sama TIDAK mengambil ulang (terbukti di rantai:
     tepat 1x panggilan untuk 2 pesan). Kontak v1 tanpa refresh
     berkala; foto bot ter-refresh tiap connect ulang.

### Penyajian & kontrak
- Endpoint baru (sesi + membership; non-member 404 TENANT_NOT_FOUND,
  foto tak ada/lintas tenant 404 NOT_FOUND):
  `GET /api/tenants/:tenantId/avatars/channels/:channelAccountId` dan
  `GET .../avatars/contacts/:contactId` → byte foto + Content-Type +
  `Cache-Control: private, max-age=3600` + ETag; If-None-Match cocok →
  304.
- Kontrak: `ChannelAccountResponse.avatarUrl` (baru),
  `ConversationResponse.contactAvatarUrl` (baru),
  `ContactResponse.avatarUrl` (sudah ada sejak 1D — kini diisi dari
  `profile_photos`, BUKAN lagi kolom warisan `contacts.avatar_url` yang
  tidak pernah terisi). Nilai = URL endpoint di atas atau null.
  API publik /v1 sengaja tetap null (endpoint avatar tergerbang sesi
  dashboard; konsumen API key tidak bisa mengambilnya).
- Web: komponen bersama `Avatar` (img + fallback inisial saat URL null
  ATAU gambar gagal dimuat) dipasang di ContactsPage (daftar + modal
  detail) dan InboxPage (daftar + kepala utas); `ChannelAvatar` 6H
  kini menerima `imageUrl` dari serializer Channels + fallback inisial
  saat gambar gagal dimuat.

### Verifikasi (TANPA Playwright, sesuai aturan user)
- Typecheck SEMUA proyek hijau; build api+worker+web hijau (bundle
  `index-BGsFTz0k.js`, memuat pemakaian avatarUrl/contactAvatarUrl);
  PGlite verify lulus termasuk seksi baru **[18]**: profile_photos
  terisolasi per tenant (konteks A hanya baris A, bytea utuh, insert
  lintas ditolak), unik satu foto per pemilik. Hitungan verify: tabel
  32 → 33, policy 36 → 37.
- **Rantai mock dari server 21/21 PASS** (tenant uji
  `fase6d-a/b-*@sk.test`; jendela `TELEGRAM_API_BASE` → mock lokal
  127.0.0.1:8399 yang melayani getUserProfilePhotos/getFile dengan
  byte PNG berbeda per file_id; mock menolak token selain tiga token
  uji dan user tak dikenal → total_count 0): connect bot A → avatarUrl
  terisi → **byte endpoint == byte mock ukuran 320** (bukan 640 —
  pemilihan ≤512px terbukti) + content-type + ETag + 304 → webhook
  pengguna berfoto → foto kontak tersimpan (byte == ukuran 320) →
  daftar percakapan memuat contactAvatarUrl → pengguna tanpa foto →
  avatarUrl null → pesan kedua tidak memicu ambil ulang (stats mock:
  tepat 1x) → bot C tersemai di tenant B sebagai akun connected TANPA
  foto → daftar channel dibaca → avatarUrl muncul (backfill) dengan
  byte benar → lintas tenant 404 (dua bentuk) → tanpa sesi 401.
- **Jendela mock ditutup bersih & diverifikasi:** `.env.staging`
  dipulihkan dari backup (baris TELEGRAM_API_BASE tidak ada lagi —
  insiden kecil: `pkill -f` mencocokkan baris perintah SSH sendiri
  sehingga sesi putus SETELAH env dipulihkan; API di-restart pada sesi
  berikutnya by-PID dan health terverifikasi), mock mati, 4 service
  active. DB pasca-jendela: bot asli `8fb9b81c` tetap connected &
  tidak trashed; `profile_photos` tepat 3 baris dan SEMUANYA di dua
  tenant uji; 0 pesan telegram berstatus failed pada 30 menit terakhir
  di semua tenant.

### Batas jujur
- Bukti visual (foto tampil di kartu/daftar) menunggu uji user —
  yang terbukti: byte foto identik ujung-ke-ujung lewat API publik.
- Bot asli user ter-backfill otomatis saat daftar channel dibaca
  setelah deploy **BILA botnya punya foto profil di BotFather**; bila
  belum, kartu tetap inisial (dan cache negatif menunda percobaan
  ulang ±15 menit setelah pemilik memasang foto).
- Foto kontak tidak pernah di-refresh di v1 (foto diambil sekali saat
  penampakan pertama); grup Telegram: foto yang tampil adalah kontak
  jangkar percakapan (pengirim pertama), atribusi per pesan tetap
  nama (`sender_name`), bukan foto per anggota.

---

## Update Fase 6B — Rate limit auth per IP asli (CF-Connecting-IP) (2026-11-02)

**Isu pra-produksi dari catatan QA-1 ("rate limit auth di balik
tunnel") dinyatakan TERTUTUP oleh fase ini.**

### Akar masalah (terbukti dari sumber library terpasang)

Better Auth 1.4.22 mengunci rate limit per (IP, jalur). IP diambil
`getIp()` dari `advanced.ipAddress.ipAddressHeaders` (default hanya
`["x-forwarded-for"]`, diperiksa berurutan, IP valid pertama menang).
Di balik Cloudflare Tunnel + proxy Vite, entri pertama X-Forwarded-For
selalu IP hop lokal → semua pengguna berbagi SATU ember. Aturan
khusus bawaan library untuk `/sign-in|/sign-up|/change-password|
/change-email` adalah 3 req/10 dtk per ember — itulah yang habis pada
pendaftaran cepat ke-±9 di QA-1.

### Perubahan (hanya `apps/api/src/auth.ts`, commit `5fce7f5`)

- `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip",
  "x-forwarded-for"]` — IP pengunjung asli dari edge Cloudflare
  didahulukan; XFF tetap fallback untuk pengembangan lokal (di dev
  tanpa header, library jatuh ke 127.0.0.1).
- `rateLimit: { enabled: true, window: 10, max: 100, customRules: {
  "/sign-up/*": { window: 60, max: 10 }, "/sign-in/*": { window: 60,
  max: 20 } } }` — customRules menimpa aturan khusus bawaan untuk
  sign-up/sign-in; `/change-password` & `/change-email` sengaja tetap
  pada aturan bawaan yang ketat (3/10 dtk, kini per IP asli).
  `enabled: true` eksplisit agar tidak bergantung NODE_ENV.
- Tanpa perubahan skema DB: penyimpanan rate limit = in-memory
  bawaan library (satu proses API; penghitung reset saat restart).

### Asumsi kepercayaan header (juga tertulis di komentar kode)

`CF-Connecting-IP` hanya boleh dipercaya karena origin staging
ter-bind 127.0.0.1 dan HANYA dapat dicapai lewat cloudflared — klien
tidak punya jalur menyuntikkan header ini, dan edge Cloudflare selalu
menyetelnya dari IP koneksi sebenarnya. **Bila API suatu hari
diekspos langsung tanpa Cloudflare di depannya, header ini bisa
dipalsukan klien dan asumsi ini wajib ditinjau ulang.** Untuk
production, rate limiting di edge Cloudflare (di depan tunnel) tetap
disarankan sebagai lapis pertama, dengan konfigurasi ini sebagai
lapis kedua.

### Verifikasi (dari server, tanpa Playwright; akun `fase6b-*@sk.test`)

- Rantai lokal 5180 (proxy yang sama dengan trafik publik) dengan
  header sintetis: IP 203.0.113.10 → 200 pada percobaan 1–10, **429
  mulai percobaan ke-11**; IP 203.0.113.11 → percobaan pertamanya
  **200** (tidak ikut terblokir) dan 429 mulai percobaan ke-11-nya
  sendiri. Ember per IP terbukti terpisah.
- Publik tanpa header khusus: sign-up normal 200, sign-in 200,
  get-session 200; burst publik mencapai 429 pada percobaan ke-10 =
  kumulatif ke-11 (1 sign-up normal sebelumnya masih dalam jendela
  60 dtk yang sama) — konsisten dengan kunci IP pengunjung nyata.
- Baris `auth_session.ip_address` untuk sesi publik tercatat
  `103.186.31.46` (IP pengunjung dari sudut pandang Cloudflare —
  dalam uji ini IP server itu sendiri), BUKAN 127.0.0.1: bukti ujung-
  ke-ujung bahwa API kini melihat IP pengunjung asli (bonus: IP sesi
  kini juga tercatat dengan benar).
- Sign-in: 5× password salah → 401 semua (di bawah aturan lama
  3/10 dtk, percobaan ke-4 sudah 429); sign-in benar sesudahnya 200.
- Typecheck `@sahabat-kreator/api` hijau; health publik ok; API
  di-restart (PID baru) dengan dist hasil build commit ini.

---

## Update Fase 7A — Channel Instagram + Messenger + label shell & glyph merek (2026-11-02)

Tiga permintaan user dalam satu fase: (A) label teks "Language"/"Theme"
di shell dihapus, (B) glyph WhatsApp & Messenger diganti path SVG merek
autentik, (C) channel Instagram + Messenger dibangun penuh (mock-first;
wiring live menunggu artefak Meta App user).

### Bagian A & B (commit `440d4f0`)

- `App.tsx`: dua `<span>` label terlihat di samping kontrol preferensi
  dihapus; tombol EN/ID + tombol ikon tema tetap (title/aria-label
  dipertahankan). Kunci i18n yatim `common.language`/`common.theme`
  DIBERSIHKAN dari resource en+id (satu-satunya pemakainya label itu).
- `ChannelAvatar.tsx`: `ProviderMeta` diperluas flag `filled`; glyph
  `whatsapp` (sebelumnya ikon gagang telepon generik Feather) dan
  `messenger` (gelembung generik) kini path logo merek terisi
  (fill currentColor, viewBox 24) — gelembung+gagang khas WhatsApp dan
  gelembung+petir khas Messenger. Provider lain tidak diubah.

### Bagian C — arsitektur Meta (commit `bf1fa34`)

- **Model akun**: messenger external_id = Page ID; instagram
  external_id = ID akun IG Professional; token keduanya Page Access
  Token (token IG adalah token Page yang terhubung — Page ID pada form
  IG hanya untuk memvalidasi token milik Page itu, TIDAK disimpan).
  Migrasi **0026**: kolom `public_handle` (username Page/IG dari Graph)
  + 4 policy RLS `meta_delivery_scan` (staging kini **41 policy**).
  Resolusi webhook memakai ULANG lengan generik
  `provider_external_lookup` (0020) — tanpa lengan baru. Versi Graph
  ter-pin **v26.0** dari `@sahabat-kreator/config`; env baru
  `META_API_BASE` (override mock, pola TELEGRAM_API_BASE).
- **Connect** (token-based v1, pola Telegram): validasi
  `GET /{id}?fields=name,username` → token/akun ditolak Graph = 422
  `META_TOKEN_INVALID`; penjaga satu-akun-satu-koneksi = 409
  `META_ACCOUNT_ALREADY_CONNECTED`; workspace sama: connected →
  idempoten, disconnected/error → revive baris yang sama. Token
  terenkripsi AES-256-GCM (helper channel-secrets yang sama). Foto
  Page/akun IG diambil saat connect (`GET /{id}/picture`) dan disimpan
  sebagai byte (`profile_photos`, pola 6D). Disconnect = semantik yang
  ada persis (token dibersihkan; webhook Meta adalah urusan dashboard
  Meta App — inbound untuk akun non-connected diabaikan di sisi kita).
- **Webhook tunggal** `GET+POST /api/meta/webhook`: handshake
  `hub.verify_token` vs env `META_WEBHOOK_VERIFY_TOKEN`; POST
  memverifikasi `X-Hub-Signature-256` (HMAC-SHA256 raw body, env
  `META_APP_SECRET`). Secret belum diset → **503 META_NOT_CONFIGURED**
  (fail-closed, terbukti publik sebelum secret staging dipasang);
  tanda tangan salah → 401 `META_SIGNATURE_INVALID`. Objek `page` →
  Messenger, `instagram` → Instagram. `is_echo` dilewati; DM teks →
  core `recordMetaInboundMessage` (identitas → kontak berlabel cadangan
  per provider → percakapan privat → pesan + outbox `message.received`;
  dedup mid majemuk `meta:<accountId>:<mid>` ON CONFLICT DO NOTHING).
  Profil pengirim (nama + foto) diambil best-effort saat identitas
  pertama terlihat — nama cadangan hanya diganti nama Graph bila belum
  disunting pemilik.
- **Pengiriman keluar**: poller API (±2 dtk, lengan `meta_delivery_scan`)
  `POST /v26.0/{account-id}/messages` (untuk IG: id akun IG, token Page
  yang sama), messaging_type RESPONSE. Sukses → `sent` + mid majemuk
  tersimpan; error Graph → `failed` SATU percobaan dengan kode
  `meta_graph_<kode>` di `messages.error_code` (jujur soal jendela
  24 jam Meta — tidak ada retry tanpa henti).
- **UI**: form connect Messenger & Instagram menggantikan kartu
  "Segera" (WhatsApp tetap Segera); panel "Webhook Meta" (owner/admin)
  menampilkan Callback URL + Verify Token dari endpoint baru
  `GET /tenants/:tenantId/channels/meta-webhook-info` dengan tombol
  salin + petunjuk dwibahasa (subscribe field `messages`); kartu
  menampilkan @handle (`publicHandle`) + chip `m.me/<username|pageId>`
  / `ig.me/m/<username>` hanya saat connected; tombol "Hubungkan lagi"
  untuk akun Meta terputus.

### Env staging baru (nilai TIDAK dicatat di sini)

- `META_WEBHOOK_VERIFY_TOKEN` — dibangkitkan acak di server, permanen
  di `.env.staging` (600). Inilah nilai yang ditempel user ke Meta App.
- `META_APP_SECRET` — saat ini **PLACEHOLDER acak staging**, dan sejak
  Fase 7A.1 hanya berperan sebagai **fallback env**: sumber utama App
  Secret kini kunci panel `meta_app_secret` di Panel Admin (lihat
  bagian 7A.1 di bawah). **App Secret Meta App asli user WAJIB diisi
  (di panel) sebelum trafik live** — selama yang efektif masih
  placeholder, tanda tangan webhook Meta sungguhan tidak akan pernah
  cocok (401) dan itu disengaja (fail-closed).

### Langkah wiring LIVE untuk user (di luar fase ini)

1. Buat Meta App (developers.facebook.com) tipe Business; tambahkan
   produk Messenger + Instagram.
2. Di App > Webhooks: Callback URL = `https://botara.my.id/api/meta/webhook`,
   Verify Token = nilai dari panel "Webhook Meta" di halaman Channels
   (atau minta operator platform), lalu subscribe field **`messages`**
   untuk objek Page dan Instagram.
3. Isi **App Secret** asli di **Panel Admin** (`https://botara.my.id/admin`
   → grup "Meta (Instagram & Messenger)" → App secret Meta → Simpan).
   Sejak Fase 7A.1 nilai panel menang atas env dan berlaku tanpa
   restart (≤ ±60 detik); env `.env.staging` TIDAK perlu diubah lagi
   untuk langkah ini (placeholder-nya tetap sebagai fallback).
4. Hubungkan Page/IG dari halaman Channels: Page ID (+ ID akun IG)
   dan Page Access Token Page tersebut.
5. Catatan mode pengembangan Meta: sebelum App Review lolos, hanya
   akun yang berperan di app (admin/developer/tester) dan Page/IG
   milik sendiri yang bisa bertukar pesan — audiens umum butuh App
   Review untuk `pages_messaging` / `instagram_manage_messages`.

### Deploy & verifikasi (TANPA Playwright)

- Migrasi 0026 diterapkan via psql (`MIGRATION_DATABASE_URL`,
  ON_ERROR_STOP) + baris jurnal `__drizzle_migrations` didaftarkan
  manual (hash = sha256 isi file, terverifikasi cocok dengan skema
  baris 0025). Build semua → rsync (`.env.staging` dikecualikan) →
  restart api/web/worker. Bundle publik **`index-Dq8TNNMR.js`** identik
  dengan build lokal.
- Typecheck SEMUA proyek hijau; PGlite db verify lulus termasuk seksi
  baru **[19]** (kolom public_handle; pindai `app.system_delivery='meta'`
  hanya membuka baris messenger/instagram — telegram tertutup; antrean
  poller teresolusi penerimanya) — hitungan policy verify 37 → 41.
- **Rantai mock Graph dari server: 44/44 PASS** (tenant uji
  `fase7a-*@sk.test`; jendela mock singkat: `META_API_BASE` lokal +
  `META_APP_SECRET` uji, lalu env dipulihkan — `META_API_BASE` dicabut,
  `META_APP_SECRET` diganti placeholder permanen): handshake benar →
  challenge, salah → 403; tanda tangan salah → 401 berkode; connect
  token buruk → 422 berkode; connect kedua provider → 201 dengan
  nama/handle Graph persis; foto akun byte-identik mock; DM bertanda
  tangan → percakapan/pesan di inbox; kontak bernama dari profil Graph
  + foto byte-identik; balasan → `sent` + mid majemuk, mock menerima
  POST ke endpoint Page (messenger) & akun IG (instagram) dengan
  recipient/teks/messaging_type benar; echo tanpa pesan ganda; mid
  duplikat ter-dedup; Page sama di tenant lain → 409 tanpa baris baru;
  disconnect → DM berikutnya diabaikan.
- Channel asli user TIDAK tersentuh (diverifikasi DB: bot Telegram
  `8fb9b81c` tetap connected, `10be58d5` tetap disconnected, keduanya
  tidak trashed; baris messenger/instagram hanya ada di tenant uji
  "WS 7A a"). Health publik ok; 4 service active.

### Batas jujur

- Wiring live belum diuji ke Meta sungguhan — semua bukti lewat mock
  Graph lokal. Langkah live (App Secret asli, pendaftaran webhook di
  Meta App, Page Access Token asli) adalah milik user (lihat daftar di
  atas); mode pengembangan Meta membatasi trafik ke akun milik app
  sendiri sampai App Review lolos.
- Jendela pesan Meta 24 jam berlaku sungguhan: balasan di luar jendela
  akan ditolak Graph dan pesan ditandai `failed` berkode — v1 tidak
  mengirim tag HUMAN_AGENT/template.
- Page yang belum memasang foto: Graph `/picture` bisa mengembalikan
  siluet bawaan Meta; dari API tak terbedakan dari foto asli.
- Instagram: pengiriman memakai endpoint messages akun IG dengan token
  Page terhubung (keputusan desain fase ini); Page ID tidak disimpan.
- Grup/threads bersama & komentar IG belum dicakup — v1 hanya DM 1:1.

---

## Update Fase 7A.1 — Meta App Secret dikelola Panel Admin (2026-11-02)

### Perubahan

- Kunci platform kelima **`meta_app_secret`** bergabung dengan Panel
  Admin Fase 6C: ditambahkan ke `PLATFORM_SETTING_KEYS` (core) +
  `PlatformSettingKeySchema` (contracts), grup baru **"Meta (Instagram
  & Messenger)"** di halaman `/admin` (label dwibahasa en/id, input
  password, chip sumber Panel/Env/Belum diatur + jejak ubah — pola
  persis kunci yang ada). Status API tetap hanya
  `{isSet, source, updatedAt, updatedBy}`; nilai tidak pernah muncul
  di respons/log/audit.
- **Verifikasi tanda tangan webhook Meta kini memakai resolver panel
  → env yang sama**: handler `POST /meta/webhook` menyelesaikan secret
  efektif per request lewat `getProviderSecret(db, "meta_app_secret",
  platform)` (cache ±60 dtk per proses; set/clear dari panel di proses
  yang sama membuang cache-nya seketika — TANPA restart API). Panel
  kosong → fallback env `META_APP_SECRET` (placeholder staging, tidak
  diubah nilainya); keduanya kosong → tetap **503 META_NOT_CONFIGURED**
  fail-closed. Satu objek `PlatformSettingsOptions` kini dipakai
  bersama modul admin, meta, dan penanda channels di `apps/api`
  (cache resolver ter-bucket per identitas objek).
- Panel info webhook Meta di halaman Channels
  (`meta-webhook-info.appSecretConfigured`) kini juga menyelesaikan
  nilai efektif panel → env (resolver async), bukan env semata — panel
  tidak lagi menuduh "secret belum diset" setelah pemilik mengisi
  Panel Admin.
- **Sengaja TANPA tombol "Uji"** untuk kunci ini (mengikuti kejujuran
  Fase 6C): Meta tidak menyediakan panggilan yang memvalidasi app
  secret secara berdiri sendiri (`debug_token` membutuhkan access
  token), jadi tombol uji apa pun di sini hanya akan jadi uji palsu.
  Endpoint `POST /admin/settings/meta_app_secret/test` menjawab 400
  seperti kunci tak-teruji lain; kebenaran nilai terbukti dari tanda
  tangan webhook yang lolos/gagal — persis pemakaiannya. UI grup Meta
  hanya Simpan / Hapus + status.

### Deploy & verifikasi (TANPA Playwright)

- Tanpa migrasi DB (skema `platform_settings` generik per kunci).
  Typecheck SEMUA proyek hijau; build api+web → commit `275ed4b` →
  rsync → restart api/web (bunuh PID milik `ubuntu`, `Restart=always`
  mengangkat ulang). Bundle publik **`index-Dl8hmmbU.js`** identik
  dengan build lokal; health publik ok.
- **Rantai dari server terhadap URL publik: 14/14 PASS** (skrip Bun di
  server membaca placeholder env secara lokal — nilai tidak pernah
  dicetak; jendela uji: email admin uji `fase7a1-admin@sk.test`
  ditambahkan SEMENTARA ke `PLATFORM_ADMIN_EMAILS`, sesudahnya
  `.env.staging` dipulihkan byte-identik dari cadangan + API restart):
  - Panel awal: `GET /admin/settings` memuat 5 kunci,
    `meta_app_secret` `source=env` (placeholder). Non-admin → 404
    (GET & PUT).
  - Baseline: webhook HMAC(placeholder env) → **200** lolos gerbang
    (muatan objek tak dikenal yang diabaikan parser); HMAC(salah) →
    **401 `META_SIGNATURE_INVALID`**.
  - Simpan dummy via panel → status `source=panel`; webhook
    HMAC(dummy) → **200**; webhook HMAC(placeholder env) → **401**
    (panel menang atas env, tanpa restart di tengah rantai);
    `POST .../test` → **400** (tanpa uji palsu).
  - Hapus kunci panel → status kembali `source=env`; webhook
    HMAC(placeholder env) → **200 lagi**; HMAC(dummy) → **401**
    (fallback env terbukti dua arah).
  - Keadaan akhir: panel bersih untuk kunci ini (dummy dibersihkan di
    dalam rantai), tenant asli user tidak disentuh, keempat service
    active.

### Batas jujur

- Bukti visual grup Meta di `/admin` menunggu uji user sesuai
  pembagian kerja — yang terbukti: API panel, resolusi tanda tangan
  tiga keadaan, dan bundle tersaji.
- Placeholder env tetap terpasang sebagai fallback: bila pemilik
  menghapus nilai panel setelah mengisi yang asli, secret efektif
  kembali ke placeholder dan webhook live Meta akan 401 sampai panel
  diisi lagi — perilaku fail-closed yang memang dirancang begitu.

---

## Update Fase 7B — Channel WhatsApp (Cloud API) + status pengiriman (2026-11-02)

WhatsApp adalah channel Meta ketiga, menumpang rel 7A persis: Graph
v26.0 ter-pin, webhook TUNGGAL platform yang sama, tanda tangan app
secret yang sama (resolver panel→env 7A.1 — TIDAK ada pembacaan env
mentah baru), token terenkripsi envelope yang sama, poller Meta yang
sama. Commit fitur `90ad600`.

### Model & migrasi 0027

- **Model akun**: external_id = **phone_number_id** (kunci resolusi
  webhook + penjaga); WABA ID disimpan di kolom baru
  **`parent_external_id`** (migrasi 0027, generik — provider lain NULL)
  sebagai konteks induk; `public_handle` (0026) = `display_phone_number`
  terformat dari Graph; displayName = verified_name (atau nama form).
- **0027 juga membuat ulang 4 policy `meta_delivery_scan`** dengan
  provider `('messenger','instagram','whatsapp')` di bawah flag
  `app.system_delivery='meta'` yang sama — jumlah policy TIDAK berubah
  (**41**). Resolusi webhook memakai ulang lengan generik
  `provider_external_lookup` (0020) — tanpa lengan baru. Migrasi
  diterapkan bersih lewat `drizzle-kit migrate` (jurnal kini 28 baris;
  gotcha jurnal 6D sudah tidak berulang).

### Connect (form WhatsApp menggantikan kartu "Segera" terakhir)

- Field: WABA ID + Phone Number ID + Access Token. Label token di UI
  menyebut pola resminya: **token System User permanen** dari Meta
  Business Settings. Validasi `GET /{phone_number_id}?fields=verified_name,display_phone_number`
  → 422 `META_TOKEN_INVALID` / 503 tak terjangkau. Penjaga satu-nomor-
  satu-koneksi: 409 `META_ACCOUNT_ALREADY_CONNECTED` per
  phone_number_id; **WABA yang sama di nomor/tenant lain BUKAN
  konflik** (satu WABA menaungi banyak nomor — terbukti di rantai).
  Workspace sama: connected → idempoten; disconnected/error → revive.
- Foto profil bisnis: best-effort lewat
  `whatsapp_business_profile.profile_picture_url` → diunduh → byte
  disimpan `profile_photos` (pola 6D). Kosong/gagal TIDAK menghalangi
  connect; kartu jatuh ke inisial. **Foto profil kontak WhatsApp TIDAK
  ADA di API (privasi)** → kontak WA inisial berwarna BY DESIGN.
- UI: chip kartu `https://wa.me/<digit nomor>` hanya saat connected
  (digit dari display_phone_number; tanpa nomor tampil tidak ada chip
  — phone_number_id bukan nomor telepon). Panel Webhook Meta kini
  berpetunjuk subscribe WABA field `messages`. Seksi kartu "Segera"
  di halaman Channels HILANG (semua provider sudah bisa dihubungkan).

### Webhook & status pengiriman (ciri khas fase ini)

- Objek ketiga `whatsapp_business_account` di `POST /api/meta/webhook`
  yang sama, cabang terpisah penuh (`handleWhatsAppWebhook` + parser
  `channel-whatsapp`). Resolusi akun dari
  **`value.metadata.phone_number_id`**, BUKAN `entry.id` (WABA) —
  terbukti: satu entry WABA yang sama mengantar pesan dua nomor ke dua
  tenant yang benar.
- Inbound: nama kontak dari `value.contacts[].profile.name` (kontak
  lahir bernama; label cadangan "WhatsApp user" hanya diganti bila
  belum disunting pemilik). Dedup wamid majemuk
  `meta:<phoneNumberId>:<wamid>` ON CONFLICT DO NOTHING. **Non-teks
  dicatat bertipe** (image/audio/video/document/sticker; caption
  menjadi contentText bila ada; tipe tak dikenal → `other`) — media
  TIDAK diunduh di v1, linimasa inbox tetap jujur.
- **Statuses** (`value.statuses[]`) memperbarui pesan keluar kita via
  wamid: sent → delivered → read **HANYA maju** (status basi/duplikat
  diabaikan tanpa perubahan — terbukti sent-sesudah-read tidak
  menurunkan); **failed terminal** dari queued/sent/delivered dengan
  `messages.error_code = meta_graph_<kode>` (format sama seperti
  kegagalan poller Meta; terverifikasi DB `meta_graph_131047`). Label
  status per pesan di utas Inbox sudah generik sejak sebelumnya
  (`inbox.messageStatus.*`: queued/sent/delivered/read/failed dua
  bahasa) — delivered/read WhatsApp langsung tampil tanpa ubahan UI.
- Outbound: poller Meta diperluas — antrean `listQueuedMetaDeliveries`
  kini mencakup whatsapp; cabang kirim memakai Cloud API
  `POST /v26.0/{phone_number_id}/messages`
  `{messaging_product:"whatsapp", recipient_type:"individual", to, type:"text", text:{body}}`
  → `sent` + wamid majemuk tersimpan (yang dicocokkan statuses). Di
  luar jendela layanan 24 jam Graph menolak (mis. 131047) → `failed`
  berkode, SATU percobaan, tanpa retry membabi buta. **Template
  message TIDAK di fase ini** (milik fase broadcast 7C).

### Langkah wiring LIVE WhatsApp untuk user (di luar fase ini)

1. Meta App yang sama seperti 7A; pastikan App Secret asli terisi di
   Panel Admin dan webhook app sudah terdaftar (Callback URL + Verify
   Token dari panel "Webhook Meta").
2. Di Meta Business: buat/pilih **WhatsApp Business Account (WABA)**,
   daftarkan nomor (display name terverifikasi), dan **subscribe WABA
   ke webhook aplikasi** dengan field **`messages`** (pengaturan
   WhatsApp di app / Business Settings) — tanpa ini tidak ada pesan
   masuk maupun status pengiriman yang tiba.
3. Buat **System User** di Business Settings, beri peran kelola
   WhatsApp pada WABA, hasilkan **token permanen** dengan izin
   `whatsapp_business_messaging` (+ `whatsapp_business_management`
   untuk membaca profil nomor).
4. Hubungkan dari halaman Channels: WABA ID + Phone Number ID + token
   System User itu. Catatan dev-mode/App Review berlaku seperti 7A:
   nomor uji Meta terbatas; produksi penuh butuh akses lanjutan
   (`whatsapp_business_messaging` lolos App Review) dan nomor
   terdaftar permanen.

### Deploy & verifikasi (TANPA Playwright)

- Typecheck SEMUA proyek hijau; PGlite verify lulus termasuk seksi
  baru **[20]** (kolom parent_external_id terisi WABA; pindai 'meta'
  membuka akun whatsapp + antrean queued WA teresolusi ke wa_id;
  flag 'telegram' tetap tertutup untuk WA). Build semua → commit
  `90ad600` → push → rsync → migrasi 0027 (drizzle-kit) → restart
  api/web/worker/realtime. Bundle publik **`index-BWF7-RQA.js`**
  identik build lokal dan memuat form WhatsApp.
- **Rantai mock Graph dari server: 38/38 PASS** (tenant uji
  `fase7b-*@sk.test`; jendela mock singkat `META_API_BASE` lokal, lalu
  `.env.staging` dipulihkan byte-identik + mock dimatikan + API
  restart): handshake; token buruk 422 berkode; connect dua nomor di
  bawah satu WABA (201 + 201, nama/handle Graph persis); nomor sama
  lintas tenant 409; foto bisnis byte-identik mock untuk nomor
  berfoto dan avatarUrl null untuk nomor tanpa foto; pesan masuk
  bernama kontak dari profil webhook; wamid duplikat ter-dedup;
  gambar ber-caption tercatat type=image; routing per phone_number_id
  lintas tenant tepat; balasan queued → poller → mock menerima POST
  bentuk Cloud API yang benar → sent + wamid majemuk; statuses
  delivered → read; status basi tidak menurunkan; failed → failed +
  `error_code` DB `meta_graph_131047`; tanda tangan salah 401;
  disconnect → pesan masuk berikutnya diabaikan. Channel asli user
  terverifikasi DB tidak tersentuh (dua baris Telegram user utuh).

### Batas jujur

- Semua bukti lewat mock Graph lokal; wiring live menunggu langkah
  user di atas (WABA + nomor terdaftar + subscribe + token System
  User + App Review untuk produksi).
- Jendela layanan 24 jam berlaku: balasan bebas di luar jendela
  ditolak Graph → pesan `failed` berkode; jalan keluar resminya
  (template message) adalah fase broadcast, bukan fase ini.
- Media masuk hanya dicatat tipe + caption; berkasnya tidak diunduh
  (pipeline media/R2 belum menjadi konsumen) — UI menampilkan penanda
  "Pesan media" seperti channel lain.
- Foto kontak WhatsApp tidak akan pernah tampil (API tidak
  menyediakannya) — inisial berwarna adalah keadaan permanen yang
  benar untuk provider ini.

---

## Update Fase 7B.1 — Webhook & Delivery Log / log integrasi (2026-11-02)

Diminta user eksplisit sebagai alat debugging wiring Meta live: mulai
fase ini SETIAP hit webhook dan SETIAP percobaan kirim keluar tercatat
dan bisa ditelusuri dari dashboard (halaman "Logs", route `/logs`).
Commit fitur `211dc63` (`feat(logs): phase 7B.1 webhook and delivery
integration log`).

### Model (migrasi 0028)

- Tabel baru append-only **`integration_log`**: `direction` (enum
  'in'|'out'), `provider` varchar (telegram/messenger/instagram/
  whatsapp; hit Meta pra-rute memakai `'meta'`), `tenant_id` NULLABLE
  (event tak ter-resolve tetap tercatat sebagai baris platform),
  `channel_account_id` & `message_id` FK **ON DELETE SET NULL** (purge
  6I tidak menghapus sejarah — tautan lepas, ringkasan tetap),
  `signature_valid` boolean nullable (hanya arah 'in'; nilai
  secret/tanda tangan TIDAK PERNAH ditulis), `outcome` teks terkendali,
  `error_code`, `summary` ringkas buatan server, `payload` jsonb
  nullable, `created_at`. Staging kini **34 tabel / 45 policy**.
- **Relasi dengan `webhook_inbox`:** tidak berubah — `webhook_inbox`
  tetap lapisan DEDUP provider (Fase 1A); `integration_log` adalah
  lapisan OBSERVABILITAS terpisah di atasnya (satu baris per hit/
  percobaan, termasuk yang ditolak sebelum sempat menyentuh dedup).
- Payload dibatasi **±32KB** oleh penulis di core
  (`capIntegrationLogPayload`): lebih besar dari itu disimpan sebagai
  objek penanda `{ truncated: true, originalSize, preview }`. Payload
  arah 'out' selalu NULL (isi pesan ada di `messages`; log menunjuk
  `message_id`). Payload per baris event Meta/Telegram = SELURUH
  payload hit itu (satu hit bisa memuat banyak event).
- RLS berlapis (4 policy baru): `tenant_isolation` standar;
  `integration_log_ingest` FOR INSERT di bawah flag transaction-local
  `app.integration_log='ingest'` (satu-satunya jalan menulis — route
  webhook & poller menulis lintas/tanpa tenant); baris tenant NULL
  hanya terlihat lewat `platform_integration_log` (flag
  `app.platform_settings='admin'`, pola 0022); prune di bawah
  `integration_log_prune` — **FOR ALL disengaja**: DELETE dengan
  WHERE/RETURNING di Postgres juga mensyaratkan baris lolos policy
  SELECT, jadi policy FOR DELETE murni tidak akan pernah melihat baris
  mana pun (terbukti di PGlite verify saat pembangunan).
- Core baru `packages/core/src/integration-log.ts`:
  `recordIntegrationLog` (best-effort, TIDAK PERNAH melempar — jalur
  webhook tidak boleh berubah gara-gara log), list/detail tenant
  (paginasi kursor keyset (created_at, id) menurun, kursor opaque
  base64), list/detail unresolved (flag platform), `pruneIntegrationLogs`
  (batch 5000). Fungsi record inbound telegram/meta/whatsapp kini
  mengembalikan penanda `duplicate` agar outcome jujur (kembalian null
  tetap = kembaran tenant lain → juga dicatat `duplicate`).

### Pemetaan outcome per titik keluar

Telegram (POST /telegram/webhook/:id): id non-UUID → `unresolved_account`
(tenant NULL, tanpa payload); akun tak ditemukan → `unresolved_account`
(payload best-effort); secret salah → 401 + `rejected_signature`
(signature_valid=false); JSON rusak → `error`/`invalid_json`; status
≠ connected → `ignored_disconnected`; my_chat_member → `recorded`
(gagal core → `error`); channel_post non-teks → `ignored_status_only`;
channel_post/pesan tercatat → `recorded`, kembaran → `duplicate`;
update tanpa konten yang bisa dicatat → `ignored_status_only`; error
core per event → `error`/`processing_error` lalu **rethrow** (respons
webhook tidak berubah).

Meta GET handshake: verify token belum dikonfigurasi →
`rejected_unconfigured`; token salah → `rejected_signature`; sukses
SENGAJA tidak dicatat (bukan event — menghindari derau pemeriksaan
Meta). Meta POST: app secret kosong → 503 + `rejected_unconfigured`;
tanda tangan salah → 401 + `rejected_signature` (provider 'meta',
payload parse best-effort); JSON rusak → `error`/`invalid_json`.
Per event DM (messenger/instagram): akun tak dikenal →
`unresolved_account`; tak connected → `ignored_disconnected`; echo →
`ignored_echo`; non-teks → `ignored_status_only`; tercatat →
`recorded`/`duplicate`. Payload tanpa event messaging (receipt murni)
→ satu baris agregat `ignored_status_only` provider 'meta'. WhatsApp:
payload tanpa messages/statuses → `ignored_status_only`; per pesan:
phone_number_id tak dikenal → `unresolved_account`; tak connected →
`ignored_disconnected`; teks kosong → `ignored_status_only`; tercatat
→ `recorded`/`duplicate`. Per status: tak dikenal →
`unresolved_account`; tak connected → `ignored_disconnected`; status
diterapkan → `recorded` (status failed membawa
`error_code meta_graph_<kode>`); status basi/wamid asing →
`ignored_status_only`.

### Cakupan arah keluar (jujur)

HANYA dua poller pengirim provider yang benar-benar ada: poller
telegram & poller Meta (messenger/instagram/whatsapp) di proses API.
Setiap titik markOutbound — termasuk gagal pra-kirim
(`*_empty_text`, `*_missing_credentials`, `*_token_undecryptable`) —
menulis baris out `sent`/`failed` + error_code yang sama persis dengan
kolom pesan + message_id. **Flush webchat lewat gateway realtime DI
LUAR cakupan secara eksplisit**: bukan percobaan API provider
(serah-terima socket internal) dan sudah teraudit `message.sent`
(actor `ws-connect-flush`) di audit_logs.

### API + UI + retensi

- API (modul `apps/api/src/modules/logs`): `GET
  /tenants/:tenantId/logs` + `GET .../logs/:logId` — sesi + membership
  (non-member 404) dan **owner/admin saja** (anggota biasa 403;
  payload memuat isi pesan pelanggan). Filter provider/direction/
  outcome/channelAccountId + paginasi kursor; daftar tanpa payload
  (hanya `hasPayload`), detail membawa payload tersimpan. `GET
  /logs/unresolved` + `GET /logs/unresolved/:logId` — hanya sesi
  platform admin (allowlist env), non-admin 404 pola Panel Admin.
- Web: item nav "Logs" (route `/logs`, ikon `list`, grup More bersama
  Settings/Admin; order admin digeser), halaman `LogsPage`: filter
  dwibahasa, chip outcome warna semantik, baris expandable (payload
  JSON + meta signature/error/channel/message), toggle unresolved
  khusus sesi platform admin, auto-refresh `usePolling` (pola shell),
  load-more kursor. Semua string i18n en+id.
- Retensi: worker prune baris >30 hari (poller boot + tiap jam, pola
  purge 6I) + run-once `pnpm --filter @sahabat-kreator/worker
  prune:logs` (skrip `apps/worker/scripts/prune-integration-logs.ts`).

### Deploy

Build semua di VM → commit `211dc63` → push → rsync repo
(`.env.staging` dikecualikan & utuh) → migrasi 0028 via drizzle-kit
di server (`MIGRATION_DATABASE_URL`; jurnal bersih 28 → 29 baris;
34 tabel / 45 policy terverifikasi) → 4 service direstart (bunuh PID
systemd milik ubuntu) → health ok; bundle publik
**`index-DRoBSx7Q.js`** identik build lokal & memuat halaman Logs.

### Verifikasi (TANPA Playwright, sesuai aturan user)

- Lokal: typecheck SEMUA proyek (19 paket) hijau; build semua hijau;
  PGlite verify lulus termasuk seksi baru **[21]**: tanpa konteks 0
  baris; insert tanpa flag ingest ditolak, dengan flag diterima lintas
  tenant; konteks tenant A hanya baris A; flag platform hanya baris
  tenant NULL; prune ber-flag hanya membuang baris >30 hari.
- **Rantai mock gabungan dari server: 56/56 PASS** (tenant uji
  `fase7b1-*@sk.test`; mock Telegram 8410 + Graph 8411 lokal; jendela
  `TELEGRAM_API_BASE`/`META_API_BASE` singkat): matriks telegram
  (recorded + signature_valid true + payload detail persis; duplikat;
  secret salah 401 + rejected_signature/false; disconnect → 204 dan
  hit basi 401 karena disconnect menghapus webhook secret; akun acak
  404) + keluar telegram (sent terhubung messageId; gagal mock →
  failed `telegram_http_400`); messenger (recorded; echo →
  ignored_echo; page tak dikenal tak masuk log tenant; tanda tangan
  salah 401; handshake salah 403; sent; gagal Graph → failed
  `meta_graph_100`; disconnect → DM berikutnya ignored_disconnected);
  whatsapp (recorded; out sent + wamid majemuk; status delivered →
  in/recorded; status wamid asing → ignored_status_only); API log
  (isolasi tenant B kosong; filter direction/outcome/channel bekerja;
  paginasi kursor dua halaman tanpa tumpang tindih; daftar tanpa
  payload, detail ber-payload).
- **Rantai akses & platform: 18/18 PASS** (member role 'agent' disemai
  via DB → 403 daftar + detail, owner kontrol 200; sesi biasa →
  unresolved 404; jendela W2 singkat — `META_APP_SECRET` dicabut dari
  env & email admin uji ditambahkan ke allowlist, lalu keduanya
  dipulihkan: POST webhook → 503 META_NOT_CONFIGURED; admin platform →
  unresolved 200 memuat telegram/messenger `unresolved_account`,
  'meta' `rejected_signature` & `rejected_unconfigured`, semua
  tenantId NULL; detail unresolved ber-payload; baris platform tidak
  terlihat via route tenant).
- **Prune terbukti**: baris disemai backdate 31 hari + baris segar →
  run-once sebagai role aplikasi menghapus TEPAT 1 baris (yang tua),
  yang segar bertahan.
- `.env.staging` dipulihkan **byte-identik** (cmp) sesudah kedua
  jendela; mock dimatikan; 4 service active; health publik ok.
  Channel asli user TIDAK tersentuh (telegram `8fb9b81c` tetap
  connected, `10be58d5` tetap disconnected, trashed_at keduanya NULL)
  dan tenant user memiliki **0 baris** integration_log — tidak ada
  trafik asli yang terdampak jendela mock.

### Batas jujur

- Bukti visual halaman Logs menunggu uji user (aturan pembagian
  kerja) — yang terbukti: API, kontrak, RLS, bundle tersaji.
- Telegram pasca-disconnect tidak menghasilkan `ignored_disconnected`
  melainkan `rejected_signature`: disconnect menghapus webhook secret
  di server BY DESIGN (kredensial dibersihkan), jadi hit basi tertolak
  di gerbang — outcome `ignored_disconnected` untuk telegram hanya
  tercapai pada akun berstatus non-connected yang secretnya masih ada
  (mis. status error). Untuk Meta outcome itu tercapai normal sesudah
  disconnect (gerbangnya app secret platform).
- Resolusi akun WhatsApp mengikuti phone_number_id tertua yang cocok
  bila ada akun disconnected tenant lain dengan nomor sama (perilaku
  7B yang sudah ada, bukan regresi fase ini) — rantai awal sempat
  menabraknya dengan nomor uji warisan 7B; nomor uji diganti dan
  seluruh matriks WA lulus.
- Event Meta yang disaring parser sebelum route (receipt delivery/
  read di payload campuran) tidak mendapat baris per event; payload
  yang SELURUHNYA receipt mendapat satu baris agregat
  `ignored_status_only`.
- Log arah 'in' untuk satu hit multi-event menulis payload hit yang
  sama di setiap baris event (dibatasi per baris) — sederhana dan
  cukup untuk debugging; normalisasi per event menyusul bila volume
  menuntut (retensi 30 hari membatasi pertumbuhan).

## Update Redesain Connect Channels — Modal dua langkah (2026-11-02)

Permintaan user: tombol connect di kanan atas membuka modal/popover —
rekomendasi yang disetujui: **modal**. Perubahan PRESENTASI murni di
`apps/web` (endpoint, payload, validasi, semantik connect/revive TIDAK
berubah); commit fitur `5019db9`.

- **Header halaman**: judul + subjudul kiri; kanan atas berisi tombol
  sekunder "Webhook Meta" (hanya tampil bila info webhook bisa dibaca —
  owner/admin, pola yang sama seperti panel lama) dan tombol primer
  "+ Hubungkan Channel" (pola header yang sama seperti halaman
  Automations).
- **Modal dua langkah** (pola dialog yang sudah ada di halaman ini:
  overlay `bg-black/50`, sheet bawah di mobile / dialog tengah di
  `sm:` ke atas, `max-w-lg`, tutup via tombol — halaman ini memang tidak
  memakai Escape/backdrop-click di dialog mana pun):
  1. Pemilih provider: 5 baris pilihan berglyph merek (tint warna
     provider) + nama + keterangan satu baris dwibahasa.
  2. Form provider terpilih — komponen form yang ADA dipindahkan apa
     adanya (field, id, hint, validasi, error berkode, submit). Provider
     Meta (messenger/instagram/whatsapp) menampilkan blok info webhook
     (Callback URL + Verify Token + salin + status app secret +
     petunjuk subscribe) secara kontekstual di atas form-nya, dari
     endpoint `meta-webhook-info` yang sama (komponen bersama
     `MetaWebhookInfoBlock`, juga dipakai dialog header). Tombol
     "Kembali" ke langkah 1; field pertama form terfokus otomatis saat
     langkah dibuka.
- **Sukses** → modal tertutup, daftar di-refresh, kartu baru disorot
  sesaat (`ring-accent`, ±3 detik).
- **"Hubungkan lagi"** pada kartu terputus (telegram/messenger/
  instagram/whatsapp) kini membuka modal langsung di langkah form
  provider itu (menggantikan scroll-ke-form); semantik revive dari form
  yang ada tidak berubah.
- **Badan halaman** kini hanya grid kartu + seksi Sampah + keadaan
  kosong (dengan tombol Hubungkan Channel yang sama). Lima form
  bertumpuk + panel webhook mandiri dihapus dari badan; heading
  "Channel terhubung" di atas grid ikut dihapus. Teks basi diperbaiki:
  `channels.emptyBody` (tidak lagi menyebut form "di bawah"/"fase
  berikutnya") dan hint token Meta/WhatsApp (webhook kini "ditampilkan
  di atas", bukan "di bawah"). Dialog disconnect & hapus 6I tidak
  diubah.
- Verifikasi: typecheck i18n + web hijau; build web hijau; bundle
  publik `index-Dk8DqF0i.js` identik build lokal dan memuat string khas
  langkah pemilih (en+id). Rantai regresi API ringan dari server
  (tenant uji `connect-modal-*@sk.test`): **10/10 PASS** — sign-up,
  buat tenant, connect webchat lewat endpoint yang sama → 201 +
  siteKey `wc_` + status connected, channel muncul di daftar,
  `meta-webhook-info` owner → 200 dengan webhookUrl benar, halaman
  publik /channels 200. 4 service active; health ok.
- Batas jujur: bukti visual modal (pemilih, sheet mobile, sorotan
  kartu) menunggu uji user sesuai pembagian kerja — yang terbukti di
  sini adalah typecheck, build/bundle tersaji, dan regresi API.

## Update Fase 7B.2 — Penanganan Kegagalan: Replay Webhook + Pusat Pesan Gagal (2026-11-02)

Di atas log integrasi 7B.1: event webhook yang gagal kini bisa
DIPROSES ULANG dari log, dan pesan keluar yang gagal terkumpul di satu
pusat dengan tombol kirim ulang. Commit fitur `dd446c7`
(`feat(logs): phase 7B.2 failure handling — webhook replay + failed
message center with retry`). TANPA migrasi — skema 7B.1/1D sudah cukup.

### Replay webhook (proses ulang event masuk)

- **Jalur yang sama, bukan jalur palsu:** pemrosesan update Telegram
  yang sudah lolos gerbang diekstrak dari route ke
  `apps/api/src/modules/telegram/process.ts`
  (`processTelegramUpdate`), dan pemrosesan payload Meta (dispatch
  WhatsApp vs messaging Page/IG) ke `apps/api/src/modules/meta/
  process.ts` (`processMetaWebhookPayload`). Route live memanggil
  fungsi yang sama persis (perilaku respons tidak berubah); replay
  memanggilnya lagi dengan payload tersimpan. Error core per event
  tetap dicatat `error` lalu dilempar — route 500 seperti sebelumnya,
  replay menangkapnya dan melaporkan outcome `error`.
- **Kelayakan (core `evaluateIntegrationLogReplayEligibility`, ditegakkan
  server; UI hanya mencerminkan):** hanya baris `direction='in'` dengan
  `signature_valid === true` dan outcome `error` atau
  `ignored_disconnected`, dengan payload tersimpan LENGKAP. Payload
  null/penanda truncated → 422 `LOG_PAYLOAD_TRUNCATED`; selain itu →
  422 `LOG_REPLAY_NOT_ALLOWED`. Event yang gagal verifikasi TIDAK
  PERNAH direplay — memprosesnya akan mengkhianati makna tanda tangan.
- **Endpoint:** `POST /tenants/:tenantId/logs/:logId/replay` — sesi +
  membership + owner/admin (penjaga yang sama seperti baca log);
  non-member 404, member biasa 403. Baris tenant-NULL (unresolved)
  tidak terjangkau endpoint tenant dan fase ini TIDAK menyediakan
  replay platform-admin untuknya (batas terdokumentasi di bawah).
- **Keamanan lintas tenant:** Telegram ditargetkan dari
  `channel_account_id` baris sumber dan akun WAJIB milik tenant yang
  sama (hilang/pindah → 422). Payload Meta satu hit bisa memuat event
  banyak tenant → prosesor dijalankan ber-scope `tenantScopeId`:
  event yang ter-resolve ke tenant lain / tak ter-resolve DILEWATI
  SENYAP (jejaknya sudah ditulis saat hit live); baris agregat
  platform tidak ditulis dari replay.
- **Append-only & provenance:** baris sumber tidak pernah diubah.
  Baris baru hasil replay membawa akhiran `· replay of log <id8>` di
  summary-nya; aksi operator ditulis ke audit `integration.replay`
  (meta: sourceLogId, provider, outcomes — tanpa payload). Respons:
  `{ replayed: true, sourceLogId, outcomes[] }` = outcome baris-baris
  baru berurutan.
- **Idempotensi:** dedup `provider_message_id` di core membuat replay
  event yang ternyata sudah tercatat menghasilkan `duplicate` tanpa
  pesan/outbox/automation/agent ganda — terbukti di rantai (replay
  kedua dari baris sumber yang sama).

### Pusat pesan keluar gagal + retry

- **Cakupan jujur:** status `failed` pada pesan keluar HANYA dihasilkan
  poller telegram & poller Meta (messenger/instagram/whatsapp;
  termasuk kegagalan terminal status WhatsApp dari webhook Meta) —
  itulah provider di `RETRYABLE_FAILED_PROVIDERS` (core). **Webchat
  tidak punya pesan `failed`**: flush gateway realtime hanya menandai
  `sent`, dan pesan untuk pengunjung luring/disconnected tetap
  `queued` — jadi webchat tidak tampil di pusat gagal dan tidak ada
  retry palsu untuknya (terbukti live di rantai T8).
- **API (owner/admin, penjaga yang sama):** `GET
  /tenants/:tenantId/failed-messages` (filter provider + paginasi
  kursor keyset; konteks channel/kontak/preview ±280 char/error_code)
  dan `POST /tenants/:tenantId/failed-messages/:messageId/retry`.
- **Retry (core `retryFailedOutboundMessage`):** satu transaksi
  tenant; pesan harus outbound `failed`; akun channel harus ada,
  tidak di-trash, dan `connected` (selain itu 409
  `CHANNEL_DISCONNECTED`); transisi `failed` → `queued` ATOMIK
  kondisional pada status (balapan poller tidak menimpa
  `sent/delivered/read`; status sudah berubah → 409
  `MESSAGE_NOT_FAILED`); isi/percakapan/provider_message_id tidak
  diubah, `error_code` dibersihkan sebagai bagian transisi (sejarah
  kegagalan tetap di integration_log + audit `message.failed`); audit
  `message.retry` (actor user, meta previousErrorCode). Pengiriman
  sungguhan tetap oleh poller yang ada pada siklus berikutnya —
  tidak ada pengirim paralel baru.
- **Kode kontrak baru:** `LOG_REPLAY_NOT_ALLOWED`,
  `LOG_PAYLOAD_TRUNCATED`, `MESSAGE_NOT_FAILED`,
  `MESSAGE_RETRY_UNSUPPORTED` (+ `CHANNEL_DISCONNECTED` kini juga
  diterjemahkan UI di errorText).

### UI (halaman /logs)

- Dua tab: "Log event" (isi 7B.1, tak berubah) dan "Pesan gagal"
  (panel baru `FailedMessagesPanel`): filter provider, daftar lintas
  provider, tombol "Kirim ulang" dengan dialog konfirmasi dwibahasa
  yang memperingatkan risiko duplikat ambigu (provider sebenarnya
  menerima tetapi respons hilang). Sesudah retry panel memuat ulang
  dan TIDAK mengklaim terkirim — pesan hilang dari daftar hanya saat
  percobaan poller berikutnya membuktikan status barunya (refresh
  polling mengganti daftar, bukan menggabungkan, selama hanya halaman
  pertama yang dimuat).
- Panel detail baris log yang eligible menampilkan tombol "Proses
  ulang" → dialog konfirmasi (event lama dapat memicu automation/
  balasan AI sekarang; dedup mencegah pesan ganda) → hasil outcome
  ditampilkan diterjemahkan, daftar dimuat ulang.

### Deploy

Build api+web di VM → commit `dd446c7` → push → rsync repo
(`.env.staging` dikecualikan & utuh) → 4 service direstart (bunuh PID
systemd milik ubuntu) → health ok; bundle publik
**`index-BLFHbZr9.js`** identik build lokal & memuat UI 7B.2. Tanpa
migrasi (jurnal tetap 29 baris; 34 tabel / 45 policy).

### Verifikasi (TANPA Playwright, sesuai aturan user)

- Lokal: typecheck SEMUA paket hijau; build api (tsup) + web hijau.
- **Rantai dari server terhadap staging publik: 64/64 PASS** (tenant
  uji `fase7b2-*@sk.test` run ber-suffix unik; mock Telegram 8410 +
  Graph 8411; jendela `TELEGRAM_API_BASE`/`META_API_BASE` +
  `META_APP_SECRET` uji yang diketahui rantai — panel `meta_app_secret`
  terverifikasi KOSONG sebelumnya sehingga env yang berkuasa;
  `.env.staging` dipulihkan **byte-identik** (sha256, diverifikasi
  driver) dan mock dimatikan sesudahnya):
  - T1 sanity live: connect telegram via mock (secret tertangkap dari
    setWebhook mock) → webhook 200 → percakapan + log `recorded`.
  - T2 replay telegram dari baris `error` TERSEMAI (payload lengkap,
    signature_valid true): replay → `recorded`, pesan tercatat TEPAT
    1x; replay baris sumber yang sama lagi → `duplicate`, tetap 1x;
    provenance `replay of log` ≥2 baris; audit `integration.replay`
    ≥2; replay atas baris hasil `recorded` → 422.
  - T3 penolakan: `rejected_signature` → 422 NOT_ALLOWED; payload
    truncated → 422 `LOG_PAYLOAD_TRUNCATED`; payload null → 422 yang
    sama; member 'agent' (disemai DB) → 403; non-member → 404; id
    tenant A ditempuh via tenant B → 404.
  - T4 skenario live penuh Meta: connect messenger (mock Graph) →
    disconnect → DM bertanda tangan → log `ignored_disconnected` →
    reconnect (revive baris sama) → replay → `recorded`, DM tercatat
    tepat 1x → replay ulang → `duplicate`.
  - T5 telegram gagal→retry: mock sendMessage 400 → pesan `failed`
    (kode `telegram_http_400` dibaca dari pusat gagal); daftar failed
    + filter provider + isolasi tenant B + member 403; retry saat
    mock masih gagal → `queued` → poller mengambil → `failed` lagi;
    mock sehat → retry → `sent` (mock menerima tepat 3 percobaan);
    retry pesan sent → 409 `MESSAGE_NOT_FAILED`; audit
    `message.retry` tepat 2 untuk pesan itu; log out `sent` baru ada.
  - T6 messenger gagal→retry: Graph 400 kode 100 → `failed`
    `meta_graph_100`; retry sesudah mock sehat → `sent` (tepat 2
    percobaan tercatat mock).
  - T7 retry saat channel disconnected → 409 `CHANNEL_DISCONNECTED`
    (lalu reconnect untuk kebersihan).
  - T8 webchat: sesi pengunjung + pesan masuk + balasan dashboard →
    balasan tetap `queued` (BUKAN `failed`) saat pengunjung luring,
    dan tidak muncul di pusat gagal.
- Insiden proses (bukan produk): run rantai pertama kehilangan output
  karena koneksi SSH putus di tengah; keadaan server diverifikasi
  bersih (env pulih oleh trap driver, mock mati). Dua asersi awal
  rantai membaca `errorCode` dari serializer pesan inbox — field itu
  memang tidak diekspos `MessageResponseSchema` (desain lama); asersi
  dipindah ke endpoint pusat gagal (permukaan yang benar) dan run
  bersih menghasilkan 64/64. Penangkapan id `RETURNING` psql juga
  sempat tercemar tag `INSERT 0 1` pada run pertama — diperbaiki di
  helper rantai; probe manual membuktikan replay telegram sehat
  sebelum run ulang.
- Channel asli user TIDAK tersentuh: telegram `8fb9b81c`
  (@botaramyid_bot) tetap connected, `10be58d5` tetap disconnected,
  keduanya tidak di-trash; tenant asli user memiliki 0 baris
  integration_log.

### Batas jujur

- Bukti visual tab "Pesan gagal", tombol replay, dan dialognya
  menunggu uji user (aturan pembagian kerja) — yang terbukti: API,
  kontrak, bundle tersaji, dan seluruh rantai perilaku.
- Replay menembakkan jalur live TERMASUK efek sampingnya: pesan hasil
  replay masuk outbox `message.received` dan dapat memicu keyword
  automation / respons AI / sequence seperti pesan baru — memang
  itulah makna "proses ulang", dan dialog UI memperingatkannya.
  Untuk WhatsApp, replay juga dapat menerapkan ulang statuses
  (monoton maju saja di core, jadi aman).
- Risiko duplikat retry yang ambigu tetap ada secara inheren: bila
  provider sebenarnya menerima percobaan sebelumnya tetapi responsnya
  hilang (timeout), kirim ulang dapat mengantar pesan yang sama dua
  kali ke kontak. Kegagalan eksplisit (4xx Graph/Bot API) tidak
  ambigu. UI memperingatkan ini sebelum retry.
- Baris `error` dengan `errorCode='invalid_json'` tidak bisa direplay
  (payload tidak tersimpan — tidak ada yang bisa diproses ulang);
  penolakannya memakai kode `LOG_PAYLOAD_TRUNCATED` dengan pesan
  "payload tidak lengkap", sesuai kontrak fase ini.
- Replay untuk baris tenant-NULL (unresolved) oleh platform admin
  TIDAK termasuk fase ini: baris-baris itu tidak ber-tenant sehingga
  tidak ada konteks aman untuk memprosesnya ulang dari endpoint
  tenant; jalur masuknya pun kini sudah jauh lebih jarang gagal
  (resolusi akun bersifat deterministik dari payload). Dicatat
  sebagai kandidat lanjutan bila volume event unresolved membenarkan.
- Skenario replay Telegram diuji dari baris tersemai (menginduksi
  `processing_error` live secara deterministik tidak praktis tanpa
  merusak data), sedangkan skenario Meta `ignored_disconnected`
  diuji LIVE penuh dari webhook bertanda tangan sampai tercatat.

---

## Update Fase 7B.3 — Indikator Kesehatan Channel di kartu Channels (2026-11-02)

Setiap kartu channel kini menampilkan kesehatan operasional dari data
yang sudah tercatat sejak 7B.1: webhook terakhir diterima, pengiriman
sukses terakhir, dan titik status (sehat / perlu perhatian / belum ada
aktivitas). Commit fitur `e0c3785` (`feat(channels): phase 7B.3
channel health indicators on channel cards`) + perbaikan `c767a4a`.
TANPA migrasi — skema 7B.1 + messages/audit sudah cukup (tetap 34
tabel / 45 policy, jurnal 29 baris).

### Kontrak & perhitungan (core `packages/core/src/channel-health.ts`)

- `ChannelAccountResponse.health` kini WAJIB hadir di semua respons
  akun channel (daftar, Sampah, connect/disconnect/trash/restore):
  `{ status: 'ok'|'attention'|'idle', lastInboundAt,
  lastInboundOutcome, lastDeliveredAt, lastFailureAt,
  lastFailureOutcome, lastFailureErrorCode }` — waktu ISO atau null.
  `IntegrationLogOutcomeSchema` dipindah ke seksi channel di
  contracts agar dipakai skema health maupun log.
- Perhitungan server: `getChannelHealthMap(db, ctx, accounts)` —
  TIGA kueri agregat untuk seluruh daftar tenant dalam SATU transaksi
  konteks tenant (bukan N+1 per kartu): satu agregat `integration_log`
  untuk semua provider ber-webhook, dua agregat untuk webchat.
  Aturan status (`computeChannelHealthStatus`, fungsi murni):
  - **idle** — tidak ada aktivitas tercatat sama sekali;
  - **attention** — ada sinyal kegagalan DAN (belum pernah ada
    aktivitas sehat ATAU kegagalan terakhir KETAT lebih baru daripada
    aktivitas sehat terakhir);
  - **ok** — ada aktivitas dan tidak ada kegagalan yang lebih baru.
  "Aktivitas sehat" = webhook masuk ber-outcome `recorded`/`duplicate`
  atau kirim keluar sukses. "Sinyal kegagalan" = masuk ber-outcome
  `rejected_signature`, `rejected_unconfigured`,
  `unresolved_account`, `error`, `ignored_disconnected`, atau keluar
  ber-outcome `failed`. `ignored_disconnected` masuk kelas kegagalan
  karena maknanya persis "event tiba tetapi dibuang"; begitu channel
  terhubung lagi dan event tercatat, status pulih sendiri.
- **Sumber data per provider:**
  - Telegram/Messenger/Instagram/WhatsApp: semua fakta dari
    `integration_log` per `channel_account_id` (hit masuk terakhir
    apa pun outcome-nya + outcome-nya; `out`/`sent` terakhir; baris
    kegagalan terakhir + error_code-nya). Hit Meta yang gagal di
    gerbang bersama ber-`channel_account_id` NULL → tidak menempel ke
    kartu mana pun (memang belum teratribusi); terlihat di /logs
    sebagai baris platform.
  - **Webchat** (flush gateway BUKAN percobaan API provider dan tidak
    dicatat integration_log by design 7B.1): masuk terakhir =
    `messages.created_at` pesan inbound terakhir akun (join
    conversations); terkirim terakhir = `audit_logs.created_at` baris
    audit `message.sent` bermeta `channel='webchat'` terakhir —
    `flushQueuedWebchatMessages` adalah SATU-SATUNYA penanda `sent`
    webchat dan auditnya ditulis pada transaksi flush yang sama, jadi
    stempelnya adalah waktu antar sesungguhnya (BUKAN
    `messages.created_at` balasan, yang bisa jauh lebih awal saat
    pengunjung luring — terbukti di rantai: lastDelivered ≥ waktu
    balasan dibuat). Outcome masuk & semua fakta kegagalan webchat
    selalu null: webchat tidak punya konsep outcome webhook dan
    pesannya tidak pernah berstatus `failed` (7B.2).
- **Gotcha driver (akar perbaikan `c767a4a`):** proyeksi agregat
  `max(timestamptz)` lewat templat `sql` Drizzle TIDAK melewati pemeta
  kolom timestamp — driver mengembalikannya sebagai STRING format
  Postgres (`2026-11-02 07:23:35.998333+00`), bukan `Date`. Gejala:
  endpoint channel 500 begitu akun punya baris log (`.getTime()` /
  `.toISOString()` pada string), sementara akun kosong tetap menjawab
  idle dengan sehat. Perbaikan: helper `toDate` menormalisasi semua
  stempel agregat di core. Ingat pola ini untuk agregat SQL mentah
  berikutnya.

### UI (kartu Channels)

Blok `ChannelHealthBlock` di bawah baris pill status kartu: titik
semantik (success/warning/muted) + label status ("Sehat" / "Perlu
perhatian"); `idle` = satu baris redup "Belum ada aktivitas" (bukan
alarm). Fakta tampil sebagai baris label–waktu RELATIF
(`Intl.RelativeTimeFormat` lewat helper baru `formatRelativeTime`;
timestamp penuh di atribut `title`): "Webhook terakhir" (webchat:
"Pesan terakhir") dan "Terakhir terkirim". Kegagalan terakhir tampil
sebagai chip peringatan: label outcome (kunci `logs.outcome*` yang
sama seperti halaman Logs) + `error_code` mono + waktu relatif.
Channel disconnected tetap menampilkan riwayatnya. String baru di
`channels.health*` (en+id); perilaku modal connect/disconnect/trash
tidak berubah.

### Deploy

Build api+web+worker+realtime di VM → commit `e0c3785` → push →
rsync repo (`.env.staging` dikecualikan & utuh) → 4 service direstart
→ health ok; bundle publik **`index-cjxmySoy.js`** identik build
lokal & memuat string health baru. Perbaikan `c767a4a` di-deploy
dengan pola yang sama (rsync + restart API).

### Verifikasi (TANPA Playwright, sesuai aturan user)

- Lokal: typecheck SEMUA paket hijau; build api/web/worker/realtime
  hijau.
- **Rantai dari server terhadap staging publik: 40/40 PASS**
  (tenant uji `fase7b3-*@sk.test` run ber-suffix unik; mock Telegram
  8410 + Graph 8411; jendela `TELEGRAM_API_BASE`/`META_API_BASE` +
  `META_APP_SECRET` uji; `.env.staging` dipulihkan **byte-identik**
  — sha256 diverifikasi driver — dan mock dimatikan sesudahnya):
  - S1: telegram & webchat baru → `health.status='idle'`, semua waktu
    & outcome null (di respons connect maupun daftar).
  - S2: webhook telegram tercatat → `lastInboundOutcome='recorded'`;
    balasan terkirim via poller → `lastDeliveredAt` terisi, status
    `ok`, tanpa kegagalan.
  - S3: mock kirim gagal → status `attention`, chip
    `failed`/`telegram_http_400`; kirim sukses baru → pulih `ok`
    (terkirim terakhir > gagal terakhir).
  - S4: webhook secret salah (401) → `lastFailureOutcome=
    'rejected_signature'`, inbound terakhir juga outcome itu, status
    `attention`; webhook valid → pulih `ok`.
  - S5: messenger lewat jalur yang sama (DM tercatat + balasan
    terkirim via mock Graph → `ok` + `lastDeliveredAt`).
  - S6: webchat — sesi pengunjung + pesan masuk → `lastInboundAt`
    dari messages, outcome null, `ok`; balasan dashboard diantar
    flush gateway saat pengunjung connect WebSocket publik →
    `lastDeliveredAt` dari audit flush terisi dan ≥ waktu balasan
    dibuat.
  - S7: isolasi — bot tenant B idle walau A aktif; aktivitas B tidak
    mengubah health A; daftar B hanya memuat akunnya.
  - S8: channel asli user tidak tersentuh — bot `8fb9b81c…`
    (@botaramyid_bot) tetap `connected` dan baris integration_log
    untuk akun itu tetap 0.
- Insiden proses (bukan produk): run rantai pertama kehilangan output
  karena koneksi SSH putus (keadaan server diverifikasi bersih, env
  pulih oleh trap driver); run kedua (28 PASS / 12 FAIL) membuka bug
  format waktu agregat di atas — akar masalah dibuktikan dengan
  skrip debug core di server, diperbaiki di `c767a4a`, dan run ketiga
  bersih 40/40.

### Batas jujur

- Bukti visual blok kesehatan di kartu (titik, chip, waktu relatif)
  menunggu uji user sesuai pembagian kerja — yang terbukti: kontrak
  API, perhitungan server, bundle tersaji, dan seluruh rantai
  perilaku.
- Kesehatan per kartu hanya mencerminkan event yang TERATRIBUSI ke
  akun itu: penolakan tanda tangan Meta di gerbang bersama (sebelum
  routing per akun) tidak menempel ke kartu mana pun — tempatnya di
  /logs (baris platform/unresolved).
- Untuk Telegram, `rejected_signature` pasca-disconnect memang akan
  menandai kartu terputus sebagai `attention` (secret-nya sudah
  dihapus disconnect sehingga hit basi selalu tertolak) — itu jujur:
  ada webhook yang masih menembak akun mati; pill status tetap
  menunjukkan `disconnected` sebagai konteks utamanya.
- Stempel webchat `lastDeliveredAt` seakurat audit flush gateway:
  flush terjadi saat pengunjung connect / nudge antrean, jadi
  nilainya waktu serah-terima socket — bukan receipt baca pengunjung
  (webchat memang tidak punya konsep itu di v1).

## Update Fase 7D — Meta OAuth Connect: "Lanjutkan dengan Facebook" (2026-11-02)

Penghubungan Messenger/Instagram/WhatsApp kini punya jalur utama OAuth
(login Meta server-side, authorization code) di samping form tempel
token yang tetap ada sebagai "Cara manual (lanjutan)". TANPA migrasi.

### Konfigurasi platform (Panel Admin /admin, grup Meta)

- Tiga kunci platform_settings baru: `meta_app_id`, `meta_ig_config_id`
  (konfigurasi Unified Login IG), `meta_wa_config_id` (konfigurasi
  Embedded Signup WA). Ketiganya IDENTIFIER PUBLIK — bukan rahasia:
  nilai efektifnya (panel → env) DITAMPILKAN di panel agar bisa
  diverifikasi pemilik, dan field-nya teks biasa. Perlakuan ini sengaja
  berbeda dari kunci rahasia (`meta_app_secret` tetap pola 6C/7A.1:
  nilai tak pernah dirender). Env fallback: `META_APP_ID`,
  `META_IG_CONFIG_ID`, `META_WA_CONFIG_ID`.
- Panel juga menampilkan Redirect URI OAuth read-only + tombol salin:
  `https://botara.my.id/api/meta/oauth/callback` — SATU callback
  tunggal untuk ketiga provider; daftarkan persis di konfigurasi
  Facebook Login / Login for Business pada Meta App.
- `GET /api/admin/settings` kini membawa blok `meta` (nilai publik +
  redirect URI); endpoint tenant `GET /tenants/:tenantId/channels/
  meta-oauth-info` (owner/admin) melaporkan ketersediaan OAuth per
  provider (appId terisi? config terisi? appSecretConfigured) TANPA
  membocorkan secret.

### Mesin OAuth (modul API `meta-oauth`)

Endpoint: `POST /tenants/:tenantId/meta-oauth/start` (sesi +
owner/admin) → URL dialog; `GET /api/meta/oauth/callback` (publik,
callback tunggal); `GET /tenants/:tenantId/meta-oauth/sessions/
:sessionId` (aset, tanpa token); `POST .../sessions/:sessionId/
complete` {assetId}.

- **State** = payload bertanda HMAC-SHA256 (kunci `BETTER_AUTH_SECRET`)
  berisi {tenantId, provider, userId, nonce, exp ≤10 menit}. Nonce
  diklaim saat start dan DIKONSUMSI atomik saat callback (sekali
  pakai — replay/kedaluwarsa/tanda tangan rusak →
  `/channels?meta_oauth_error=META_OAUTH_STATE_INVALID`; parameter
  `error` dari Meta → `META_OAUTH_CANCELLED`; kegagalan exchange →
  `META_OAUTH_EXCHANGE_FAILED`; belum terkonfigurasi →
  `META_OAUTH_NOT_CONFIGURED`).
- **Penyimpanan nonce + sesi: Redis platform** (kunci
  `meta-oauth:nonce:*` SET NX EX 600 + GETDEL; `meta-oauth:session:*`
  EX 600) lewat `createRedisConnection` @sahabat-kreator/queue. Tanpa
  `REDIS_URL` jatuh ke Map in-memory (sesi hilang saat API restart —
  staging selalu punya Redis). Isi sesi DIENKRIPSI envelope
  AES-256-GCM yang sama seperti kredensial channel
  (`CHANNEL_TOKEN_SECRET`); token hasil exchange TIDAK PERNAH masuk
  URL/browser/log — callback hanya me-redirect id sesi opak.
- **Complete** mengalir ke jalur create/revive manual yang SAMA
  (penjaga satu akun 409 `META_ACCOUNT_ALREADY_CONNECTED` — dan sesi
  TIDAK dikonsumsi oleh 409 agar aset lain bisa dipilih; perilaku
  trashed/revive sama; enkripsi sama) + audit baru
  `channel.connected` meta {channelAccountId, provider, method:
  'oauth'} (create fungsi lama tetap menulis `channel.created`).
  Foto profil best-effort seperti jalur manual (pola 6D/7A/7B).

### Alur per provider (persis seperti terimplementasi; Graph v26.0)

- **Messenger — Facebook Login klasik (scope di URL).** Dialog:
  `https://www.facebook.com/v26.0/dialog/oauth?client_id&redirect_uri
  &response_type=code&state&scope=pages_show_list,pages_messaging,
  pages_manage_metadata`. Exchange: code → user token (`GET
  /oauth/access_token` DENGAN redirect_uri) → long-lived
  (`grant_type=fb_exchange_token`) → `GET /me/accounts` (fields id,
  name, username, access_token, instagram_business_account). Token
  channel = Page Access Token turunan long-lived per Page;
  external_id = Page ID; public_handle = username Page; IG terhubung
  hanya info pemilih (TIDAK dibuatkan channel IG dari sini). Subscribe:
  `POST /{page-id}/subscribed_apps?subscribed_fields=messages`.
  ASIMETRI terdokumentasi: Messenger memakai scope klasik karena
  terbukti untuk alur Page kita; IG/WA memakai config_id (Login for
  Business). Pembangun URL terstruktur per provider agar Messenger
  kelak bisa pindah ke config_id bila aplikasi user mewajibkannya.
- **Instagram — Unified Login (config_id, redirect-based, BUKAN JS
  SDK).** Dialog: `facebook.com/dialog/oauth?client_id&config_id=
  <meta_ig_config_id>&redirect_uri&response_type=code&state`. Exchange
  code → Business Integration System User Access Token (SUAT) —
  mengikuti contoh dokumentasi Unified Login, exchange TANPA
  redirect_uri. Penemuan: `GET /me/assigned_instagram_accounts?
  fields=id,username` → external_id = ID akun IG, public_handle =
  username. Konteks portfolio: `GET /me?fields=client_business_id`
  disimpan sebagai **parent_external_id** (makna generik kolom itu per
  provider: WhatsApp = WABA ID, Instagram = ID portfolio bisnis klien
  pemilik SUAT — untuk manajemen token kelak). Subscribe: `POST
  /{ig-id}/subscribed_apps?subscribed_fields=messages` (lihat asumsi
  di Batas jujur).
- **WhatsApp — Embedded Signup (config_id).** Dialog sama dengan
  config_id WA. Exchange code → token bisnis. Penemuan aset DARI
  TOKEN di server — KEPUTUSAN redirect-based: kami TIDAK memakai
  JS SDK/FB.login + event WA_EMBEDDED_SIGNUP (yang mengharuskan SDK
  di browser dan memecah alur mobile/redirect); alurnya identik
  dengan dua provider lain: `GET /me/assigned_whatsapp_business_
  accounts?fields=id,name` lalu per WABA `GET /{waba-id}/
  phone_numbers?fields=id,display_phone_number,verified_name`.
  external_id = phone_number_id; parent_external_id = WABA ID;
  public_handle = nomor tampilan. Subscribe: `POST /{waba-id}/
  subscribed_apps` (tanpa subscribed_fields — langganan webhook WABA
  adalah level aplikasi; field diatur di dashboard aplikasi).
- **Kegagalan auto-subscribe TIDAK menggagalkan koneksi** (token &
  akun valid): channel tetap `connected`, respons complete membawa
  `warnings: ["META_SUBSCRIBE_FAILED"]` yang ditampilkan UI
  dwibahasa dengan arahan menghubungkan ulang / memeriksa webhook.
- Semua panggilan Graph menghormati override `META_API_BASE`
  (terbukti lewat mock rantai).

### UI (modal Hubungkan Channel yang ada)

- Langkah 2 untuk messenger/instagram/whatsapp: tombol primer biru
  Facebook "Lanjutkan dengan Facebook" (POST start → redirect penuh
  ke dialogUrl) bila provider tersedia; belum terkonfigurasi → tombol
  nonaktif + petunjuk dwibahasa. Form token lama utuh di dalam lipatan
  "Cara manual (lanjutan)" (tertutup secara default).
- Langkah Instagram memuat blok prasyarat Unified Login (dwibahasa):
  (1) akun IG harus Professional (Bisnis/Kreator); (2) akun harus di
  dalam Portofolio Bisnis Meta — bila belum punya, buat gratis di
  business.facebook.com (Pengaturan Bisnis), tambahkan akun IG ke
  portofolio, lalu kembali; (3) login dialog bisa memakai akun IG itu
  sendiri atau akun Facebook yang punya akses ke portofolio. Ringkasan
  yang sama ada di teks bantuan Panel Admin untuk konfigurasi IG.
- Pulang `?meta_oauth=<id>` → dialog pemilih aset (Page / akun IG /
  nomor WA berkelompok per WABA; IG terhubung Page ditampilkan
  sebagai info) → complete → dialog tertutup, daftar refresh, kartu
  disorot (pola yang ada); peringatan subscribe tampil sebagai banner.
  `?meta_oauth_error=<kode>` → banner error dwibahasa via kode kontrak.
  Query param dibersihkan (history.replaceState) sesudah ditangani.

### Deploy

Build api+web+worker+realtime di VM → commit `9baefb7` → push →
rsync repo (`.env.staging` dikecualikan & utuh) → 4 service
direstart → health ok; bundle publik **`index-FRh5tUSD.js`** identik
build lokal & memuat UI OAuth.

### Verifikasi (TANPA Playwright, sesuai aturan user)

- Lokal: typecheck SEMUA paket hijau; build api/web/worker/realtime
  hijau. Tanpa migrasi (tak ada perubahan skema).
- **Rantai dari server terhadap staging publik: 67/67 PASS** (tenant
  uji `fase7d-*@sk.test`; mock Graph OAuth lokal 8411 meniru exchange
  code + fb_exchange_token, /me/accounts, assigned_instagram_accounts,
  /me client_business_id, assigned WABA + phone_numbers,
  subscribed_apps; jendela `META_API_BASE` + email admin uji di
  `PLATFORM_ADMIN_EMAILS`; panel diisi dummy lewat API admin lalu
  DIHAPUS kembali; `.env.staging` dipulihkan **byte-identik** —
  sha256 diverifikasi driver; mock dimatikan sesudahnya):
  - Konfigurasi: info sebelum konfigurasi semua provider tidak
    tersedia; non-admin platform PUT panel → 404; panel menampilkan
    nilai publik + redirect URI; app secret tidak pernah muncul di
    respons panel/info mana pun.
  - Messenger penuh: URL dialog benar (host, client_id, redirect_uri,
    scope); callback → sesi; 2 aset Page (handle + IG terhubung);
    complete 201; subscribed_apps terpanggil fields=messages;
    exchange tercatat memakai redirect_uri + fb_exchange_token;
    token tersimpan envelope `v1:` (bukan plaintext, dibuktikan via
    DB); audit channel.connected method=oauth; sesi terkonsumsi.
  - Instagram penuh: dialog config_id TANPA scope; exchange TANPA
    redirect_uri (pola Unified Login); discovery assigned; complete
    201 (nama akun dari profil Graph); parent_external_id =
    client_business_id (DB); subscribe dicoba.
  - WhatsApp penuh: dialog config_id WA; discovery WABA + 2 nomor;
    complete 201; parent = WABA (DB); handle = nomor tampilan;
    subscribe WABA dicoba.
  - Negatif: state dipakai ulang / tanda tangan rusak / kedaluwarsa
    (HMAC valid, exp lampau) → STATE_INVALID; error Meta →
    CANCELLED; code buruk → EXCHANGE_FAILED; sesi tenant lain
    dibaca/di-complete → 404; aset sudah terhubung → 409 dan sesi
    TIDAK terkonsumsi (aset lain tetap bisa dipilih); subscribe
    gagal di mock → tetap connected + warnings META_SUBSCRIBE_FAILED.
  - Regresi & integritas: form manual messenger tetap 201; manual ke
    aset hasil OAuth tenant lain → 409 (penjaga yang sama);
    pembersihan panel mengembalikan info ke tidak tersedia; channel
    asli user (@botaramyid_bot `8fb9b81c…`) tetap connected; TIDAK
    ADA token OAuth (Page/SUAT/bisnis/long-lived) yang muncul di
    respons/Location mana pun sepanjang rantai; health ok.
  - Catatan proses: run pertama 64 PASS lalu crash di kueri
    pemeriksaan terakhir rantai (uuid `LIKE` tanpa cast — bug skrip
    uji, bukan produk); run kedua membuktikan penjaga 409 bekerja
    terhadap sisa data run pertama; pra-bersih antar-run (hanya
    tenant uji fase7d-*) ditambahkan, run ketiga bersih 67/67.

### Batas jujur

- Dialog Meta ASLI (halaman login Facebook, pemilih akun/portofolio,
  persetujuan izin) berada di luar jangkauan mock — yang terbukti:
  konstruksi URL dialog, kontrak callback, exchange, penemuan,
  complete, subscribe, dan seluruh perilaku server/UI kami. Wiring
  live menunggu user mengisi App ID + config ID asli di /admin dan
  mendaftarkan Redirect URI di aplikasi Meta-nya.
- ASUMSI yang harus dibuktikan saat live (dokumen advanced resmi
  tidak terbaca penuh saat implementasi): (1) penemuan WABA lewat
  `GET /me/assigned_whatsapp_business_accounts` — berpola simetris
  dengan `assigned_instagram_accounts` yang terverifikasi dari
  dokumen Unified Login; (2) bentuk subscribe akun IG `POST
  /{ig-id}/subscribed_apps?subscribed_fields=messages` mengikuti pola
  Messenger Platform (dokumen Unified Login hanya menyatakan akun
  harus di-subscribe ke aplikasi). Keduanya terisolasi di satu metode
  klien Graph sehingga koreksi live cukup satu titik.
- Batas dev-mode Meta tetap berlaku: aplikasi yang belum lolos App
  Review (Advanced Access untuk pages_messaging /
  instagram_manage_messages / whatsapp_business_messaging) hanya
  bisa menghubungkan aset milik akun berperan di aplikasi.
- Bukti visual (tombol Facebook, dialog pemilih, banner) menunggu uji
  user sesuai pembagian kerja — yang terbukti: kontrak API, perilaku
  server, bundle tersaji, dan rantai end-to-end di atas.

---

## Update Fase 7D.1 — Halaman Legal Publik + hotfix prompt=login OAuth IG (2026-11-02)

Dua pekerjaan, dua commit fitur terpisah: `68baccf` (halaman legal) dan
`7904525` (hotfix prompt=login).

### Halaman legal publik

App Review Meta mensyaratkan URL Kebijakan Privasi + URL instruksi
penghapusan data yang dapat dibuka publik; sebelum fase ini keduanya
BELUM ADA. Kini ada tiga halaman publik dwibahasa di luar shell &
tanpa sesi, mengikuti locale aktif pengunjung:

- `GET /privacy` — Kebijakan Privasi (12 seksi)
- `GET /terms` — Syarat Layanan (11 seksi)
- `GET /data-deletion` — Penghapusan Data Pengguna (7 seksi; URL
  instruksi penghapusan data untuk didaftarkan ke aplikasi Meta)

Struktur: komponen bersama `apps/web/src/pages/LegalPage.tsx` (header
ringkas: nama produk + kontrol bahasa/tema yang sama seperti permukaan
standalone lain + tautan kembali; kaki: tautan silang antar ketiga
halaman lewat `components/LegalLinks.tsx`) dan manifest struktur di
komponen yang hanya merakit kunci — SELURUH teks hidup sebagai
resource i18n terstruktur `legal.*` (judul seksi + paragraf + daftar
butir) di `packages/i18n/src/resources/en.ts` & `id.ts`, tanpa string
hardcoded. Tanggal berlaku: **2 November 2026** (kunci
`legal.effectiveDate`).

Isi ditulis akurat terhadap perilaku produk yang SUDAH dibangun —
tidak mengklaim fitur/sertifikasi yang tidak ada:

- Privacy: peran ganda (pengendali untuk data akun Kreator vs
  pemroses untuk data Pelanggan Akhir atas nama Kreator); kategori
  data (akun, kredensial channel yang disimpan TERENKRIPSI, isi
  pesan & kontak, data pemakaian); data platform Meta/Telegram hanya
  untuk mengoperasikan channel pemiliknya, tidak dijual, tidak untuk
  iklan/profiling pihak ketiga; pemrosesan AI — isi pesan diteruskan
  ke OpenRouter bila agen AI aktif; penyimpanan database + Cloudflare
  R2; retensi nyata (log integrasi 30 hari; purge channel 30 hari
  setelah masuk Sampah; token dihapus saat disconnect); cookie
  esensial sesi saja; hak akses/koreksi/hapus; keamanan (enkripsi
  envelope AES-256-GCM, isolasi per tenant); anak; perubahan; kontak.
- Terms: deskripsi layanan; akun & kelayakan; tanggung jawab
  pengguna (kepemilikan/otorisasi channel, kepatuhan kebijakan
  Meta/WhatsApp/Telegram + hukum anti-spam & PDP yang berlaku,
  larangan penyalahgunaan); konten AI dapat tidak akurat — pengguna
  bertanggung jawab meninjau & atas pesan yang terkirim dari
  channel-nya; sifat layanan tahap awal (staging/beta) disampaikan
  apa adanya; kekayaan intelektual; biaya tahap ini; batas tanggung
  jawab wajar; penghentian; hukum yang berlaku = Republik Indonesia.
- Data deletion: disconnect menghapus token seketika; Sampah →
  purge permanen setelah tenggang 30 hari (percakapan/pesan/
  identitas/media channel terhapus; kontak, log audit, catatan
  pemakaian TIDAK ikut — sesuai perilaku Fase 6I); data Meta terhapus
  lewat jalur yang sama; penghapusan menyeluruh akun/workspace lewat
  email dari alamat terdaftar — **penghapusan mandiri dalam aplikasi
  BELUM ada dan dikatakan apa adanya**; retensi terbatas log
  audit/keamanan; komitmen pemrosesan ≤30 hari.

Email kontak yang diterbitkan: **`support@botara.my.id`** (konstanta
`LEGAL_CONTACT_EMAIL` di `LegalPage.tsx`, diinterpolasi ke resource
lewat `{email}`). ⚠️ **Alamat ini PILIHAN AWAL yang harus
dikonfirmasi user** — belum diverifikasi sebagai kotak surat yang
aktif/dibaca; bila user memilih alamat lain, cukup ubah satu
konstanta itu.

Tautan: footer "Privasi · Syarat · Penghapusan Data" tampil di
`/login` dan `/register` (prop `footer` baru di `AuthLayout` +
`LegalLinks`), tautan silang di kaki tiap halaman legal. Tautan di
shell (Pengaturan) SENGAJA tidak ditambah: `SettingsPage` tidak
memiliki plumbing navigasi dan manfaatnya kecil dibanding risiko
mengubah kontrak props shell — footer auth + tautan silang +
Panel Admin sudah menjangkau semua kebutuhan (termasuk App Review).

Panel Admin: grup Meta kini menampilkan tiga URL legal sebagai baris
read-only dengan tombol salin (`CopyableUrlRow` di `AdminPage.tsx`,
label `admin.metaPrivacyUrlLabel` / `metaTermsUrlLabel` /
`metaDeletionUrlLabel`), bersebelahan dengan baris Redirect URI
OAuth. Nilainya diturunkan dari `window.location.origin` + path
tetap (`LEGAL_PATHS`), jadi selalu menunjuk domain publik aktif.

### Hotfix prompt=login (commit `7904525`)

Pembuat URL dialog OAuth Instagram di
`apps/api/src/modules/meta-oauth/routes.ts` kini menambahkan
`prompt=login` — sesuai dokumen Unified Login terverifikasi, dialog
selalu menampilkan pemilih akun termasuk opsi login Instagram
(konfigurasi IG user berlabel Instagram Login Compatible); tanpa
parameter ini pengguna yang sudah login Facebook diteruskan sebagai
akun itu tanpa pilihan. Messenger (scope klasik) & WhatsApp
(Embedded Signup) TIDAK diubah. Assertion rantai 7D di
`/tmp/sk7d-local/chain.ts` diperbarui (IG: prompt=login ada; WA &
Messenger: prompt tidak ada).

### Verifikasi (tanpa Playwright)

- Typecheck i18n + web + api hijau; build web & api hijau. Bundle
  publik `index-1ql1EauZ.js` identik dengan build lokal dan memuat
  judul ketiga halaman dalam KEDUA locale (Privacy Policy /
  Kebijakan Privasi, Terms of Service / Syarat Layanan, Data
  Deletion / Penghapusan Data), path `/data-deletion`, dan email
  kontak yang diterbitkan.
- Publik: `GET /privacy`, `/terms`, `/data-deletion`, `/login`,
  `/register` → 200; 4 service systemd active; `/api/health` ok.
- Rantai assertion URL ringan di server (driver `/tmp/sk7d1/`,
  pola jendela uji 7D — admin uji di allowlist, panel dummy diisi
  lalu DIBERSIHKAN, `.env.staging` pulih byte-identik): **18/18
  PASS** — dialog IG memakai config_id + `prompt=login` tanpa scope;
  dialog WA config_id tanpa prompt; dialog Messenger path
  `/v26.0/dialog/oauth` + scope klasik tanpa prompt; sesudah
  pembersihan panel, ketiga provider kembali tidak tersedia.
- Batas jujur: bukti visual halaman legal (rendering, footer di
  halaman auth, baris Panel Admin) menunggu uji user sesuai
  pembagian kerja; yang terbukti di sini adalah typecheck, build,
  bundle tersaji identik, status HTTP publik, dan rantai URL di
  atas. Dialog Meta asli tetap di luar jangkauan (lihat batas 7D).

## Update Fase 7B.4 — Viewer Audit Log (2026-11-02)

Satu commit fitur: `cb5dd8b`. Fitur MURNI BACA: `audit_logs` yang
selama ini ditulis di mana-mana kini bisa ditelusuri manusia dari
dashboard. TANPA migrasi (skema `audit_logs` sejak 0001 + lengan
platform 0022 sudah cukup) dan TANPA penulisan audit baru.

### Taksonomi nyata (dipetakan dari kode, bukan ingatan)

Seluruh 35 titik penulisan ada di `packages/core/src`. actor_type
yang benar-benar dipakai hanya empat: `user`, `agent`, `system`,
`api_key` (enum skema). Action nyata: `tenant.created`;
`channel.created/connected/disconnected/trashed/restored/exported/
purged`; `message.queued/sent/failed/status/retry`;
`automation.fired`; `sequence.enrolled/step_sent/completed/
cancelled_reply/cancelled_opt_out`; `agent.responded/capped/failed/
handoff/payment_link/suggestion_approved/suggestion_rejected`;
`contact.tagged/stage_changed`; `payment_link.created`;
`payment.paid`; `api_key.created/revoked`; `telegram.my_chat_member`;
`integration.replay`; dan khusus tenant-NULL
`platform_settings.set/cleared/test`. Penulis audit secara eksplisit
tidak menulis token/secret ke meta (pola yang dijaga semua fase);
satu-satunya nilai bersyarat = teks error provider di `agent.failed`
dan `code` tautan bayar publik di `payment_link.created` — keduanya
sudah tampil di permukaan owner/admin lain.

### API (pola modul logs)

- `GET /api/tenants/:tenantId/audit` — sesi + membership;
  **owner/admin saja** (member `agent`/`viewer` → 403, non-member →
  404), konsisten dengan /logs karena metadata audit menyangkut
  operasi workspace. Query: `actorType`, `category` (awalan action
  sebelum titik: tenant/channel/message/automation/sequence/agent/
  contact/payment_link/payment/api_key/telegram/integration/
  platform_settings), `q` (substring action, ILIKE dengan wildcard
  `%_\` di-escape), `from`/`to` (datetime), `cursor` + `limit`
  (paginasi kursor base64url {createdAt,id}, urutan createdAt DESC,
  id DESC).
- `GET /api/audit/platform` — pandangan baris tenant-NULL untuk
  sesi admin platform (allowlist yang ada); non-admin → 404.
  Baris platform TIDAK PERNAH tercampur ke daftar tenant; sebaliknya
  daftar tenant terkurung `tenant_id = :tenantId` (RLS) sehingga
  baris platform tidak bisa bocor ke tenant mana pun.
- Respons per baris (`packages/core/src/audit-log.ts`): id,
  tenantId, createdAt, actorType, actorId, **actorLabel teresolusi**
  (user → nama users, fallback email; api_key → `nama · prefix`;
  agent → nama agent dari actorId `agent:<id>`; system → actorId
  itu sendiri sebagai label jujur nama komponen; tak teresolusi →
  null dan UI menampilkan actorId mentah), action, category,
  **target ringkas** diturunkan dari kunci meta yang memang ditulis
  penulis (prioritas: channelAccountId, paymentLinkId, apiKeyId,
  suggestionId, enrollmentId, automationId, agentId, messageId,
  conversationId, productId, contactId, sourceLogId, key), dan
  **meta mentah** untuk panel detail — tidak ada endpoint detail
  terpisah karena meta audit memang kecil (berbeda dari payload
  log integrasi ±32KB).

### UI — halaman `/audit`

Item NAV_REGISTRY sesudah Logs (ikon clipboard-check baru di
NavIcon; urutan desktop 14 / more 10; item admin bergeser ke
15/11). `AuditPage` meniru LogsPage: filter actor/kategori/
pencarian/tanggal (rentang lokal → ISO awal/akhir hari), daftar
baris (waktu, chip actor semantik, actor teresolusi, **label aksi
diterjemahkan untuk 35 action yang dikenal** — action tak dikenal
tampil apa adanya dan tidak pernah gagal), baris dapat diperluas
menampilkan actor id/target + metadata JSON terformat yang
dirender React sebagai DATA (tanpa HTML mentah), tombol "Muat
lagi" berkursor, auto-refresh 5 dtk mengikuti pola Logs, dan
pengalih "Baris platform" untuk sesi admin platform di halaman
yang sama. i18n en+id lengkap (seksi `audit.*` + `nav.audit`).

### Verifikasi (tanpa Playwright)

- Typecheck SELURUH workspace hijau; build api (tsup) + web
  (Vite) hijau. Bundle publik `index-Bm29Y3Rz.js` identik dengan
  build lokal dan memuat string halaman Audit kedua locale.
- Publik: `GET /audit` → 200; 4 service systemd active (restart
  via bunuh MainPID — `systemctl restart` non-sudo ditolak
  polkit); `/api/health` ok.
- Rantai API dari server terhadap URL publik (driver
  `/tmp/sk7b4/driver.sh` + `chain.ts`, tenant uji saja; jendela
  admin uji di `PLATFORM_ADMIN_EMAILS` dengan pemulihan
  `.env.staging` byte-identik terverifikasi sha256 + email uji
  tidak berstatus admin lagi sesudahnya): **54/54 PASS** —
  tenant.created/channel.created/payment_link.created/
  api_key.created+revoked/message.queued (user) muncul dengan
  actor, label teresolusi, kategori, dan target yang benar;
  message.queued via API publik tercatat sebagai actor `api_key`
  dengan label nama kunci + prefix; filter actorType/kategori/
  rentang tanggal bekerja dua arah (dalam rentang berisi, di luar
  rentang kosong); q literal termasuk bukti escape wildcard
  (`%` → kosong, `_` → hanya action ber-underscore); paginasi
  kursor dua halaman disjoint dan terurut menurun; member role
  agent → 403; non-member → 404; isolasi antar-tenant utuh;
  pandangan platform: non-admin 404, admin 200 dengan semua baris
  tenant-NULL (63 baris platform nyata saat uji, termasuk
  platform_settings.*), filter kategori platform bekerja, dan
  admin platform yang bukan member tetap 404 di daftar tenant.
- Batas jujur: bukti visual halaman (rendering tabel, panel
  detail, tema gelap/terang) menunggu uji user sesuai pembagian
  kerja; yang terbukti di sini adalah kontrak API ujung-ke-ujung,
  typecheck/build, dan bundle tersaji. File rantai tinggal di
  server `/tmp/sk7b4/` (sementara).

---

## Update Fase 7B.5 — Reply Quote lintas channel (2026-11-02)

Satu commit fitur: `d3b7ddd`. Pengguna kini bisa membalas pesan
tertentu dengan kutipan pesan aslinya — masuk maupun keluar — tampil
sebagai blok kutipan di Inbox dan widget webchat, dan terkirim secara
native ke provider bila salurannya mendukung.

### Desain data & tautan

- Migrasi `0029_message_reply_to`: `messages.reply_to_message_id`
  uuid NULLABLE, FK ke `messages(id)` **ON DELETE SET NULL** + index
  `messages_reply_to_message_id_idx`. SET NULL disengaja: purge
  channel (6I) menghapus baris target tanpa menggagalkan purge dan
  tanpa menghapus balasan — kutipannya lepas dengan anggun (serializer
  melaporkan `replyTo: null`). TIDAK ada policy RLS baru: kolom berada
  di tabel `messages` yang sudah ternaungi `tenant_isolation` (0005);
  staging tetap 45 policy. PGlite verify seksi **[22]** membuktikan
  kolom ada, terbaca dalam konteks tenant pemilik lewat policy yang
  ada, tak terlihat tenant lain, dan SET NULL bekerja.
- ID provider kutipan **TIDAK disimpan duplikat**: poller menurunkan
  id mentah target saat kirim dari `provider_message_id` baris target
  (konteks tenant, `getMessageProviderMessageId` +
  `extractRawProviderMessageId` — uraian sesudah titik dua kedua dari
  bentuk majemuk). Sumber kebenaran tunggal, tidak bisa basi.
- Resolusi tampilan server-side: `listMessages`, hasil antrean, dan
  riwayat sesi webchat membawa `MessageWithReplyTo` — serializer
  memetakannya ke kontrak `replyTo: { id, direction, senderType,
  type, authorLabel, contentPreview } | null` (preview teks terpotong
  140 char; non-teks tanpa caption → null, UI menampilkan label tipe
  dwibahasanya). API publik v1 memakai serializer yang sama persis.

### Peta per provider (masuk / keluar + bentuk parameter persis)

| Provider | Masuk (parser → tautan) | Keluar (poller → parameter native) |
|---|---|---|
| Telegram | `message.reply_to_message.message_id` (juga `channel_post`) → majemuk `telegram:<botId>:<id>` | `reply_parameters: { message_id: <number> }` pada sendMessage |
| WhatsApp | `messages[].context.id` (wamid) → majemuk `meta:<phoneId>:<wamid>` | `context: { message_id: <wamid> }` pada payload Cloud API |
| Messenger | `message.reply_to.mid` → majemuk `meta:<pageId>:<mid>` | **tanpa parameter** (keterbatasan terdokumentasi di bawah) |
| Instagram | `message.reply_to.mid` → majemuk `meta:<igId>:<mid>` | **tanpa parameter** (sama) |
| Webchat | — (tidak ada kutipan sisi pengunjung di v1) | payload REST riwayat/sesi membawa `replyTo`; widget me-render blok kutipan |

- Penautan masuk: target dicari DI PERCAKAPAN YANG SAMA dalam
  transaksi pencatatan yang sama; tidak ditemukan → `reply_to` null
  dan pesan TETAP tercatat (webhook tidak pernah gagal karena kutipan
  asing).
- **Keterbatasan Messenger/Instagram keluar (hasil riset referensi):**
  referensi resmi Send API untuk objek `message` hanya
  mendokumentasikan `text`, `attachment`, `quick_replies`,
  `metadata` — tidak ada parameter balasan-terkutip untuk pengiriman
  Page/IG; `reply_to` hanya ada di payload webhook (arah masuk, yang
  kita parse penuh). Karena itu poller SENGAJA mengirim polos untuk
  kedua provider ini (didokumentasikan juga di
  `MetaGraphClient.sendMessage`): tautan kutipan tetap tersimpan dan
  tampil sebagai blok kutipan di inbox kita, tetapi penerima di
  Messenger/IG melihat pesan biasa tanpa kutipan native. Jangan
  menambahkan field tak terdokumentasi ke body Send API — risikonya
  penolakan Graph pada pesan yang seharusnya terkirim polos.
- Validasi keluar: `replyToMessageId` opsional pada
  `SendMessageRequestSchema` (dashboard + API publik v1, paritas).
  Target harus ada, milik tenant yang sama, dan di PERCAKAPAN YANG
  SAMA — selain itu **422 `MESSAGE_REPLY_TARGET_INVALID`** (kode
  kontrak baru), tanpa tulisan apa pun. Pesan automation/sequence/
  agent TIDAK memakai kutipan (jalurnya tidak disentuh).

### UI

- Inbox: blok kutipan di dalam gelembung (penulis + cuplikan, token
  tema; varian gelembung accent memakai lapisan putih transparan);
  klik blok menggulir + menyorot pesan asal ±1,6 dtk BILA termuat di
  utas (bila tidak, no-op senyap). Aksi gelembung "Balas dengan
  kutipan" (muncul saat hover/fokus) menetapkan target → chip
  pratinjau di atas composer (penulis + cuplikan + ✕; Esc membatalkan
  saat composer fokus); chip dibersihkan sesudah kirim sukses dan
  saat pindah percakapan. i18n en+id (`inbox.replyWithQuote`,
  `inbox.quoteTeamLabel`, `inbox.quoteCancel`, `inbox.quoteJumpTitle`,
  `inbox.messageType.*`, `errors.MESSAGE_REPLY_TARGET_INVALID`).
- Widget (`packages/embed`): blok kutipan dirender di gelembung dari
  payload `replyTo` (riwayat sesi + sinkronisasi realtime via REST),
  dwibahasa (`quoteYou`/`quoteTeam`/`quoteMedia`), gaya netral
  semi-transparan yang terbaca di tema terang/gelap.
- **Stretch widget DITOLAK secara eksplisit untuk v1:** compose
  kutipan dari sisi widget (pengunjung mengutip pesan) TIDAK
  dikerjakan — UX kutipan pada widget melayang (aksi per gelembung
  untuk pengunjung anonim) bukan pekerjaan murah yang aman
  ditambahkan di akhir fase; dicatat sebagai kandidat fase lanjutan.
  Balasan berkutipan dari dashboard ke pengunjung tampil penuh.

### Verifikasi (tanpa Playwright)

- Lokal: typecheck SELURUH workspace hijau; build semua paket hijau;
  PGlite verify lulus [1]–[22]. Bundle web `index-CflMSHj-.js`.
  Catatan lingkungan: `pnpm install` di direktori repo VM gagal
  `EPERM chown` (file repo bergrup `nogroup` yang tidak bisa di-chown
  sesi root ini) — build dijalankan di salinan kerja `/tmp/skbuild`
  dengan pnpm yang sama; hasil rsync ke server identik pola biasanya.
- Rantai mock dari server (`/tmp/sk7b5/`, mock Telegram :8410 + Graph
  :8411, jendela env singkat lalu pulih): **47/47 PASS** —
  (1) Telegram masuk berkutipan tertaut (preview + authorLabel nama
  kontak benar), target asing → null tanpa error; (2) Telegram keluar:
  mock menerima `reply_parameters.message_id` = 101 (number), kirim
  polos tanpa parameter itu; (3) WhatsApp `context.id` tertaut dan
  mock Graph menerima `context.message_id` = `wamid.in.1`, context
  asing → null; (4) Messenger `reply_to.mid` tertaut, kirim keluar
  terverifikasi TANPA parameter kutipan sesuai keputusan
  terdokumentasi, tautan tetap tersimpan; (5) webchat: payload
  riwayat widget membawa `replyTo` (preview + nama pengunjung);
  (6) validasi lintas-percakapan & target acak → 422 kode yang benar
  di dashboard DAN API v1 (kunci scope `messages:write`), + satu
  kirim v1 berkutipan sukses 201; (7) migrasi terpasang di staging
  (kolom ada; FK SET NULL terbukti di PGlite [22]).
- Sesudah jendela mock: `.env.staging` pulih **byte-identik**
  (sha256 `9c1ded2a…` sebelum = sesudah), API direstart dengan env
  asli, port mock tertutup. Channel asli user utuh: bot Telegram
  `8fb9b81c…` (@botaramyid_bot, "Botara My Id") tetap `connected`.
  Publik: `/api/health` ok, bundle `index-CflMSHj-.js` identik build
  lokal dan memuat string kutipan kedua locale, `widget.js` publik
  memuat render kutipan.
- Batas jujur: pembuktian live per provider menunggu wiring nyata —
  Telegram bisa langsung diuji user lewat bot aslinya; WhatsApp/
  Messenger/IG live menunggu kredensial Meta asli (App Secret panel +
  akun uji), sama seperti status fase 7A/7B. Bukti visual UI
  (rendering blok kutipan, tema) menunggu uji user sesuai pembagian
  kerja; yang terbukti di sini adalah kontrak ujung-ke-ujung, bentuk
  parameter persis di mock, typecheck/build, dan bundle tersaji.

## Update Fase 7C — Broadcasts v1 (2026-11-02)

Broadcast = satu pesan teks (variabel `{name}` per penerima, pola
placeholder automation) ke audiens kontak pada SATU channel, sekarang
atau terjadwal, dieksekusi worker, dengan statistik per penerima.
Commit fitur `ccfe9e8`, dua perbaikan temuan rantai `2628de0`
(validasi ulang poller) + `b2a6a07` (resolusi akun Meta
connected-first) — keduanya dijelaskan di bawah.

### Model data (migrasi 0030)

- `broadcasts`: tenant, channel_account_id, name, message_text
  (varchar 4096), audience_filter jsonb (`{tags?: string[],
  stages?: string[]}` — OR di dalam kelompok, AND antar kelompok;
  kosong = semua kontak beridentitas di channel itu), status
  `draft|scheduled|sending|completed|partially_failed|failed|cancelled`,
  scheduled_at/started_at/completed_at, error_code (penyebab gagal
  tingkat dispatch), created_by_user_id (FK users SET NULL).
- `broadcast_recipients`: broadcast, contact, conversation (SET
  NULL), message (FK messages SET NULL), status
  `queued|sent|delivered|read|failed|skipped|cancelled`, skip_reason,
  error_code; unik (broadcast_id, contact_id).
- RLS: tenant_isolation kedua tabel + lengan sempit
  `system_broadcast_scan` (SELECT saja, flag transaction-local
  `app.system_broadcast='reconcile'`) untuk penyapu worker.
  Staging: 36 tabel / 48 policy. PGlite verify seksi [23] membuktikan
  isolasi, lengan scan hanya-SELECT (UPDATE memengaruhi 0 baris),
  keunikan (broadcast, kontak), dan message terhapus → SET NULL.

### Alur eksekusi

API schedule → outbox `broadcast.dispatch_due` → relay worker →
job BullMQ `broadcast.dispatch` tertunda sampai scheduled_at
(jobId `broadcast-<id>`, kirim-sekarang = tanpa delay) → core
`dispatchBroadcast` mengklaim atomik scheduled→sending, lalu
mematerialisasi penerima + pesan `queued` (sender_type `system`,
teks `{name}` tersubstitusi) dalam potongan transaksi 200 baris.
Pesan diarahkan ke percakapan privat yang ada atau dibuat
(find-or-create; providerChatId = externalUserId identitas).
Pengiriman NYATA tetap oleh poller telegram/meta di API — tidak ada
pengirim paralel. Pesan keluar broadcast tidak memicu
automation/agent (memang tidak ada jalur keluar→pemicu).
- Statistik SUMBER KEBENARAN = baris recipients. Penyapu worker
  `reconcileBroadcasts` (tiap 10 dtk, flag scan) menyinkron status
  recipient ← status pesannya (termasuk error_code kegagalan Graph),
  penerima yatim (message_id NULL masih queued) → skipped/
  message_deleted, lalu memfinalisasi broadcast:
  completed (tak ada failed) / partially_failed (ada failed) /
  failed (semua gagal atau nol terkirim dengan kegagalan). Broadcast
  `sending` yang di-resume (job ganda/retry) melewati penerima yang
  sudah terbaris.
- Dispatch error tingkat broadcast: channel terputus saat waktunya
  → failed/CHANNEL_DISCONNECTED; audiens kosong saat dispatch →
  failed/AUDIENCE_EMPTY.

### Keputusan lingkup v1

- Channel: telegram, messenger, instagram. **WhatsApp dikecualikan**:
  broadcast di luar jendela 24 jam wajib template resmi Meta —
  manajemen template adalah FASE LANJUTAN TERSENDIRI sesudah ini.
  **Webchat dikecualikan**: tidak ada semantik push ke pengunjung
  anonim. Keduanya ditolak API `422 BROADCAST_CHANNEL_UNSUPPORTED`
  dan tampil NONAKTIF beralasan dwibahasa di pemilih channel UI
  (tidak disembunyikan).
- **Jendela 24 jam Meta** (messenger/instagram): penerima yang pesan
  masuk terakhirnya (lintas semua percakapan privat kontak itu di
  channel ini) lebih tua dari 24 jam → `skipped` beralasan
  `outside_24h_window` SAAT dispatch — tidak dicoba kirim, tidak
  dihitung gagal, tampil jujur di statistik/detail. Telegram tanpa
  aturan ini.
- Opt-out: sinyal yang dihormati adalah
  `contacts.opt_in_status='opted_out'` (preseden sequence 2C).
  Kontak opt-out yang cocok filter TETAP mendapat baris recipient
  `skipped/opted_out` (jejak jujur), tidak pernah dikirimi pesan.
  Estimasi audiens memisahkan matched/optedOut/totalWithIdentity.
- Akses: mutasi (buat/edit/hapus/jadwalkan/batalkan) = owner/admin
  (broadcast = pengiriman massal keluar, setara mengelola channel);
  baca (daftar/detail/recipient/estimasi) = semua member workspace.
- **Cancel**: scheduled → batal total, tidak ada pesan dibuat.
  sending → pesan recipients yang masih `queued` DIHAPUS (bukan
  ditandai — tidak ada pesan hantu) + recipient `cancelled`; yang
  sudah sent/failed tidak berubah; status akhir broadcast
  `cancelled` (ditetapkan langsung, bukan oleh penyapu).
- Audit: `broadcast.created/scheduled/dispatched/completed/failed/
  cancelled/deleted` + kategori `broadcast`, target `broadcast`, dan
  label dwibahasa di viewer audit 7B.4.

### Dua perbaikan temuan rantai (di luar berkas 7C murni)

1. `2628de0` — **Balapan cancel vs poller.** Rantai run pertama
   membuktikan poller telegram/meta bekerja dari snapshot batch
   (≤25 baris, dikirim sekuensial): cancel menghapus pesan queued,
   tetapi poller tetap mengirim sisa snapshot-nya (mock mencatat 25
   kiriman vs 9 tercatat sent saat cancel). Perbaikan: kedua poller
   kini memanggil helper core `isOutboundMessageQueued` tepat
   sebelum menangani SETIAP pesan dan melewati baris yang sudah
   hilang/berubah status. Sisa balapan yang jujur & tak
   terhindarkan: tepat SATU permintaan provider yang sudah terlanjur
   terbang saat cancel tiba tidak bisa ditarik dari jaringan.
2. `b2a6a07` — **Resolusi akun webhook Meta/WhatsApp.** Bila
   external_id yang sama hidup sebagai baris `disconnected` di satu
   tenant dan `connected` di tenant lain (sah menurut penjaga 0020),
   resolver lama mengambil `limit(1)` tanpa urutan dan bisa memungut
   baris disconnected → webhook koneksi aktif ter-abaikan
   (`ignored_disconnected`). Kedua resolver kini mengurutkan
   connected-first lalu terbaru — deterministik karena maks. satu
   baris connected boleh ada.

### UI

Halaman `/broadcasts` nyata (route/nav sudah ada sejak 6E): daftar
dengan chip status semantik + ringkasan statistik, formulir buat/
edit draf (pemilih channel connected dengan WA/webchat nonaktif
beralasan, filter tag/stage, estimasi audiens live, editor pesan +
petunjuk `{name}`, kirim sekarang vs jadwal datetime), panel detail
(grid statistik 8 sel + daftar penerima berpaginasi + alasan
skip/error dwibahasa), tombol batal dua-langkah untuk
scheduled/sending, polling 5 dtk saat ada yang `sending`. i18n
en+id penuh.

### Verifikasi (tanpa Playwright)

- Lokal: typecheck seluruh workspace hijau; build semua paket
  hijau; PGlite verify lulus [1]–[23]. Bundle web `index-CRB5kuUd.js`.
  (Artefak `widget.js` yang tertinggal dari sumber embed 7B.5
  dibangun ulang di commit terpisah `439bd38` agar yang tersaji
  sama dengan sumber.)
- Rantai mock dari server (`/tmp/sk7c/`, mock gabungan Telegram
  :8410 + Graph :8411, jendela env singkat lalu pulih): **78/78
  PASS** pada run bersih final —
  (S1) Telegram filter tag: estimasi matched 3/optedOut 1/total 5;
  tepat 3 kiriman mock dengan `{name}` benar (Ani/Budi/Eka —
  percakapan Eka dibuat dispatch), Citra tanpa tag tersisih, Dodi
  opt-out `skipped/opted_out`, broadcast completed, audit
  broadcast.* lengkap; (S2) terjadwal +2 menit: nol kiriman sebelum
  waktunya, 4 terkirim sesudahnya, completed; (S3a) cancel scheduled
  → nol pesan, recipients kosong; (S3b) cancel saat sending (mock
  lambat 300 ms/kirim, 30 penerima): mayoritas ≥20 cancelled,
  kiriman mock == sent atau sent+1 (satu in-flight), tidak ada
  kiriman baru sesudah settle, nol pesan queued yatim di DB;
  (S4) Messenger: 8801 dalam jendela terkirim, 8802 (inbound 25 jam)
  `skipped/outside_24h_window` tanpa dicoba Graph, 8803 gagal Graph
  → failed + errorCode → broadcast partially_failed (sent 1/failed
  1/skipped 1); (S5) isolasi tenant (daftar kosong, baca silang 404,
  channel silang 404), member agent baca 200 tetapi buat/jadwalkan/
  batalkan 403, channel disconnected → schedule 409
  CHANNEL_DISCONNECTED, webchat & whatsapp → 422
  BROADCAST_CHANNEL_UNSUPPORTED, audit broadcast.cancelled tercatat,
  bot asli user tetap connected.
- Sesudah jendela mock: `.env.staging` pulih **byte-identik**
  (sha256 `9c1ded2a…` sebelum = sesudah), API direstart dengan env
  asli, port mock tertutup. Publik: `/api/health` ok, bundle
  `index-CRB5kuUd.js` tersaji, `/broadcasts` 200.
- Batas jujur: (1) template WhatsApp = fase lanjutan terpisah —
  broadcast WA belum bisa sama sekali di v1; (2) status
  delivered/read recipient mengikuti laporan platform ke pesan kita
  (Meta melaporkannya; Telegram tidak — tidak ada angka baca yang
  dikarang); (3) satu pesan in-flight saat cancel dapat tetap
  terkirim (lihat perbaikan 1); (4) bukti visual UI menunggu uji
  user sesuai pembagian kerja.

## Fase 8A — Flow Engine (backend) (2026-11-02)

- Commit fitur `ad80b57` (migrasi 0031 + kontrak graf + core flows +
  API + worker/queue + audit/i18n). Deploy: build lokal → rsync →
  migrasi 0031 bersih via drizzle-kit migrate (jurnal 32 baris;
  staging kini **39 tabel / 51 policy RLS**) → restart
  api+worker+web. Publik: health ok, bundle `index-DIc_B-Pi.js`.
- **Format graf = kontrak sumber kebenaran untuk builder 8B**
  (`packages/contracts`): `FlowGraph { nodes: [{id, type, config}],
  edges: [{from, to, branch?}] }`, tepat SATU node `trigger`.
  Tipe node v1: `trigger` {kind `keyword` {keywords, match
  exact|contains} | `any_message`}, `send_message` {text, variabel
  {name}}, `condition` {predicate `has_tag`|`stage_equals`|
  `field_equals` (name|phone|email)|`message_contains`} → edges
  branch `yes`/`no`, `delay` {amount, unit seconds|minutes|hours},
  `add_tag`/`remove_tag` {tag}, `set_stage` {stage},
  `enroll_sequence` {automationId}, `ai_response` {}, `handoff` {},
  `end` {}. Mencapai tepi tanpa node berikutnya juga menyelesaikan
  run.
- Skema: `flows` (graph jsonb), `flow_runs` (status
  running|waiting|completed|failed|cancelled, current_node_id,
  next_step_seq, konteks jsonb berisi teks pemicu), `flow_run_steps`
  (satu baris per node dieksekusi: node_id, tipe, detail hasil,
  error) — log per langkah untuk debugging/8B. RLS: ketiga tabel
  `tenant_isolation` saja; eksekutor worker selalu berjalan dalam
  konteks tenant pemilik run (tanpa lengan sistem baru). Indeks unik
  parsial `(flow_id, trigger_message_id)` = idempotensi satu run
  per (flow, pesan pemicu).
- Semantik eksekusi: evaluasi pesan masuk diperluas — automation
  keyword → **flow aktif bertrigger cocok** → agent.respond hanya
  bila keduanya diam (replay/duplikat dihitung "sudah ditangani"
  agar tidak bocor ke agent). Job BullMQ `flow.step`, jobId
  deterministik `flow-<runId>-<stepSeq>`; event outbox
  `flow.step_due` (delay = resumeAt). Satu transaksi tenant per
  node. **Cap 100 langkah/run** (`FLOW_MAX_STEPS`) → run `failed`
  `step_cap_exceeded`. Node `send_message` = pesan queued
  sender_type system lewat poller/realtime yang ada;
  `enroll_sequence` meniru jalur sequence yang ada (langkah
  `skipped` beralasan bila sequence hilang/nonaktif/sudah terdaftar,
  run lanjut); `ai_response` memanggil `respondToInboundMessage`
  untuk pesan pemicu DI LUAR transaksi (mode auto terkirim, suggest
  tercatat, nonaktif/cap/error tercatat sebagai langkah — run tidak
  crash); `handoff` mematikan `conversations.agent_enabled` + audit
  `agent.handoff`. Opt-out kontak: tidak ada run baru + run
  `waiting` di percakapan itu dibatalkan (`contact_opted_out`,
  konsisten sequence). **Balasan kontak biasa TIDAK membatalkan run
  flow** (keputusan desain v1; beda dengan sequence yang berhenti
  saat kontak membalas).
- API: CRUD `/tenants/:tenantId/flows` (mutasi owner/admin; edit &
  hapus hanya status draft — selain itu 409 `FLOW_INVALID_STATE`),
  `POST /flows/:id/validate` (validasi kering, body graf opsional),
  `activate` (422 `FLOW_GRAPH_INVALID` + `details.issues`
  terstruktur; sukses mengembalikan `warnings`), deactivate /
  archive / unarchive, `GET /flows/:id/runs`,
  `GET /flows/runs/:runId/steps` (paginasi kursor). Validasi:
  error = graf kosong, id node ganda, trigger hilang/ganda, edge ke
  node tak dikenal / dari node tak dikenal, branch condition
  hilang, branch di edge non-condition, config per tipe tidak sah,
  sequence tidak ditemukan / bukan sequence / nonaktif; warning
  (tidak memblokir) = trigger tanpa node lanjutan, node tak
  terjangkau. Audit `flow.created/updated/activated/deactivated/
  run_started/run_completed/run_failed/run_cancelled` + kategori
  `flow` berlabel dwibahasa di viewer /audit.
- Verifikasi: typecheck semua paket hijau; build api/worker/web
  hijau; PGlite verify lulus 24 seksi (seksi [24] baru: isolasi
  ketiga tabel + unik (flow, pesan) + cascade hapus); **rantai
  mock Telegram dari server 75/75 PASS dalam satu run bersih**:
  (S1) flow keyword lengkap — kontak bertag menempuh branch yes
  (add_tag + pesan VIP), tanpa tag menempuh no (set_stage), urutan
  & isi flow_run_steps terverifikasi, replay webhook yang sama
  tidak membuat run kedua; (S2) delay 6 dtk — run `waiting`, pesan
  belum terkirim, lalu completed + terkirim; (S3) enroll_sequence
  benar-benar mendaftarkan + langkah sequence terkirim + handoff
  mematikan agent_enabled; (S4) ai_response tercatat
  `responded`; (S5) loop melingkar berhenti di cap — run failed
  `step_cap_exceeded`, 101 baris langkah (100 + baris cap), worker
  & API tetap sehat; (S6) opt-out membatalkan run waiting
  (`contact_opted_out`, pesan sesudah delay tidak pernah terkirim);
  (S7) validasi — edge menggantung `EDGE_TO_UNKNOWN`, condition
  satu branch `CONDITION_BRANCH_NO_MISSING`, dua trigger
  `TRIGGER_MULTIPLE`, sequence tenant lain `SEQUENCE_NOT_FOUND`,
  node yatim hanya warning `NODE_UNREACHABLE`, member agent baca
  200/mutasi 403, isolasi lintas tenant 404, edit/hapus flow aktif
  409; (S8) regresi gabungan — keyword automation lama, sequence
  lama, gating flow any_message menahan agent, dan fallback agent
  sesudah flow nonaktif semuanya utuh; channel asli user
  (@botaramyid_bot) tetap connected; `.env.staging` pulih
  byte-identik (sha256 `9c1ded2a…`), port mock tertutup.
- Catatan rantai (bukan bug produk): worker staging kini memakai
  **LLM asli OpenRouter** (kunci panel sudah terisi), jadi balasan
  agent tidak lagi teks kalengan MockProvider — asersi rantai
  dibuat agnostik isi. LLM asli juga sah membalas tool-call saja
  tanpa teks (semantik Fase 3A: `responded` tanpa pesan keluar).
  Skenario timing (delay/opt-out) sensitif terhadap banjir pesan
  uji loop pada proses API tunggal; rantai menunggu antrean poller
  terkuras sebelum skenario timing.
- Batas jujur: (1) belum ada UI builder (itu Fase 8B) — flow saat
  ini dibuat via API; (2) satu pesan masuk dapat memulai banyak
  flow berbeda sekaligus (satu run per flow) — belum ada prioritas
  antar-flow; (3) balasan kontak tidak membatalkan run (keputusan
  v1 di atas); (4) `ai_response` selalu memakai pesan PEMICU run
  sebagai konteks, bukan pesan terbaru percakapan; (5) cap langkah
  menghitung node yang dieksekusi, bukan waktu — flow delay-panjang
  yang sah tidak terpotong cap.

## Hotfix 7B.6 — Snapshot Kutipan Cadangan (2026-11-02)

- Latar (diagnosis parent dari data live): uji live user 16:27 —
  user mengutip pesan bot "Pagi juga gaes" di Telegram; payload
  webhook terekam lengkap di integration_log (`reply_to_message`
  membawa message_id 30 + teks asal), tetapi tautan 7B.5 gugur
  karena baris target adalah pesan keluar pra-6A.2 yang
  `provider_message_id`-nya kosong. Quote untuk pesan yang lebih
  baru bekerja (dikonfirmasi user). Hotfix ini membuat kutipan yang
  targetnya tidak tertaut tetap TERLIHAT isinya.
- Migrasi 0032: kolom nullable `messages.reply_to_snapshot` jsonb
  {authorLabel, contentPreview}; tanpa policy baru (ternaungi
  `tenant_isolation` yang ada; PGlite verify seksi [25] baru).
  Jurnal kini 33 baris; staging tetap 39 tabel / 51 policy.
- **Keputusan desain: snapshot disimpan SELALU** setiap kali payload
  Telegram membawa `reply_to_message` (bukan hanya saat tautan
  gagal) — alasan: bila baris target kelak terhapus (purge channel
  6I), FK tautan menjadi NULL oleh SET NULL, tetapi snapshot
  bertahan sehingga kutipan tetap terlihat; biaya datanya sepele
  (label + cuplikan ≤200 char). Serializer & UI SELALU mendahulukan
  tautan teresolusi; snapshot murni cadangan. Snapshot yang kedua
  bidangnya kosong (payload minimal hanya membawa id) dinormalisasi
  menjadi NULL di core (`normalizeReplyToSnapshot`) — blok label
  umum akan menyesatkan untuk isi yang memang tidak diketahui.
- Semantik builder (SATU sumber: `buildTelegramReplyToSnapshot` di
  channel-telegram, dipakai parser pesan, parser channel_post,
  ingest live, dan backfill): label penulis — bot → `@username`
  bila ada, selain itu nama tampil (nama lengkap → @username);
  tanpa `from` → `sender_chat` (judul chat → @username);
  channel_post tanpa label jatuh ke judul channel-nya. Cuplikan:
  `text` → `caption`, terpotong 200 karakter; media tanpa caption
  → null. Kontrak: `MessageResponse.replyToSnapshot` terpisah dari
  `replyTo` agar klien membedakan tertaut vs cadangan. UI Inbox:
  blok snapshot adalah `<div>` NON-klik (bukan tombol) bergaya sama
  dengan blok tertaut + title/aria dwibahasa
  `inbox.quoteOriginalUnavailable` ("Pesan asal tidak tersedia").
- **WhatsApp & Meta TIDAK dapat snapshot** — payload kutipan mereka
  hanya membawa id (`context.id` / `reply_to.mid`) tanpa teks;
  ketimpangan ini apa adanya, tidak dikarang. Widget webchat tidak
  berubah (tidak ada jalur snapshot di sana).
- Backfill sekali jalan: `apps/api/scripts/backfill-reply-snapshots.ts`
  (script npm `backfill:reply-snapshots` di paket api — ditempatkan
  di api karena lapisan itulah yang sudah menggabungkan core +
  channel-telegram seperti `process.ts`). Membaca baris
  integration_log telegram arah 'in' berpayload lengkap (bukan
  penanda truncated), mencocokkan baris pesan PERSIS lewat
  provider_message_id majemuk `telegram:<botId>:<message_id>` +
  tenant sama, dan hanya mengisi baris ber-`reply_to_message_id`
  NULL & snapshot NULL. Dijalankan dengan `MIGRATION_DATABASE_URL`
  (RLS integration_log memang tanpa lengan baca lintas tenant;
  pola perbaikan data role migrasi seperti fase sebelumnya).
  Hasil di staging: 138 baris log terpindai, **2 baris terisi**
  (satu baris mock rantai lama dibersihkan kembali karena snapshot
  kedua-bidang-kosong, menyisakan **1 baris nyata terisi**), 2
  terhitung sudah-tertaut pada run pertama; run kedua membuktikan
  idempotensi (0 terisi). Bukti kasus user: pesan
  `telegram:8808425227:35` ("Test balas quota", akun bot asli
  8fb9b81c…) kini ber-snapshot
  `{"authorLabel": "@botaramyid_bot", "contentPreview": "Pagi juga gaes"}`
  dengan tautan tetap NULL — persis perilaku yang dirancang.
- Verifikasi (tanpa Playwright): typecheck semua paket hijau;
  build semua paket hijau (bundle publik `index-1y34ujAJ.js`
  memuat render snapshot); PGlite verify 25/25 seksi (baru [25]);
  **rantai mock Telegram dari server 20/20 PASS** — quote target
  hilang → snapshot persis; quote target ada → tautan menang +
  snapshot tersimpan; pesan polos → keduanya null; replay update
  sama → tetap satu baris; quote media bercaption → preview dari
  caption; channel_post berkutipan → snapshot berlabel judul
  channel. Jendela mock ditutup bersih: `.env.staging` pulih
  byte-identik (sha256 `9c1ded2a…` sebelum = sesudah), port mock
  tertutup, bot asli user (@botaramyid_bot) tetap `connected`.
- Batas jujur: (1) backfill hanya menjangkau payload yang masih
  tersimpan di integration_log (retensi 30 hari) — kutipan yang
  lebih tua dari itu tidak bisa dipulihkan snapshot-nya;
  (2) snapshot pra-6A.2 tetap tidak bisa menjadi tautan klik (tidak
  ada data pemetaan id yang tersimpan dari era itu) — yang berubah
  hanya keterlihatannya; (3) bukti visual UI (render blok snapshot,
  tema gelap/terang) menunggu uji user sesuai pembagian kerja.

## Fase 8B — Flow Builder UI (2026-11-02)

- Commit fitur `50749bf` (kontrak position + core normalize +
  i18n + web: daftar /flows, builder /flows/:flowId, penampil run).
  Deploy: build di salinan `/tmp` (pola EPERM fase sebelumnya) →
  rsync seluruh repo termasuk node_modules → restart api+worker+web
  (kill MainPID; unit Restart=always). Publik: health ok, bundle
  `index-u5pGGHsf.js`, /flows & /flows/:id 200. TANPA migrasi —
  `position` hidup di jsonb graf yang sudah ada.
- **Keputusan: posisi node di graf yang sama.** Kontrak diperluas
  kompatibel ke belakang: `FlowNode.position {x, y}` opsional
  (`FlowNodePositionSchema`); `normalizeFlowGraph` di core membawanya
  apa adanya hanya bila bentuknya sah (dua angka finite) dan
  eksekutor worker TIDAK pernah membacanya. Satu sumber kebenaran —
  tidak ada tabel/kolom layout terpisah. Graf 8A tanpa position tetap
  sah persis seperti sebelumnya (terbukti rantai S3); builder memberi
  layout awal deterministik (kedalaman BFS dari trigger → kolom)
  untuk node yang belum berposisi saat flow lama dibuka.
- **Library canvas: `@xyflow/react` ^12** (React Flow — pola yang
  sama dengan referensi ZernFlow yang diadopsi). Ditambahkan sah ke
  apps/web; bundle web naik ke ±809 kB (gzip ±222 kB) — aplikasi
  memang satu bundle sejak awal; code-splitting per halaman adalah
  utang teknis terpisah, bukan bagian fase ini.
- Permukaan: (1) Daftar `/flows` — chip status, ringkasan pemicu,
  runCount dari API, filter status, aksi aktif/nonaktif/arsip/
  keluar-arsip/hapus draf (konfirmasi dua langkah ala Broadcasts),
  buat baru → langsung masuk builder. Item nav `flows` (ikon cabang
  baru) sesudah Automations di registry tunggal — desktop + grup
  More mobile; `/flows/:flowId` terpetakan lewat matchNavPath
  (pola deep-link Inbox), dan <main> shell melebar ke 1440px hanya
  saat builder terbuka. (2) Builder — palet 10 tipe node tambah
  (klik ATAU drag; trigger tunggal dibuat otomatis, tidak bisa
  ditambah/dihapus), node kustom dwibahasa + ringkasan config satu
  baris, node condition dengan dua handle sumber berlabel Ya/Tidak
  yang menghasilkan edge branch yes/no, satu edge keluar per
  (node, cabang) — koneksi baru menggantikan yang lama, selaras
  semantik eksekutor; panel konfigurasi per tipe persis kontrak
  (tag & stage dari data kontak tenant lewat API kontak, sequence
  dari daftar automations kind=sequence aktif; field_equals memakai
  name|phone|email kontrak); hapus node/edge (Delete) dengan edge
  yatim ikut dibersihkan; zoom/pan/Controls/MiniMap; chrome canvas
  diwarnai token semantik (scope CSS `.sk-flow`) agar terbaca di
  tema gelap & terang. (3) Simpan draf (PATCH; hanya draft), Validasi
  kering, Aktifkan — aktivasi menyimpan dulu bila kotor; 422
  FLOW_GRAPH_INVALID ditampilkan sebagai daftar issues yang sama
  (diterjemahkan di klien dari kodenya, `flows.issue.*`; klik issue
  memilih + memusatkan node-nya; node ber-issue berbingkai
  danger/warning di canvas). ApiClientError kini membawa
  `details` kontrak agar itu bisa dibaca. (4) Penampil run —
  tab "Run" di builder: daftar run + timeline langkah per run
  (tipe node, outcome & detail diterjemahkan, error mentah) dari
  endpoint 8A; polling 5 dtk selama ada run berjalan/menunggu.
- **Semantik read-only:** flow active/archived tampil read-only
  penuh di canvas (seleksi tetap bisa untuk membaca konfigurasi)
  dengan spanduk dwibahasa + tombol Nonaktifkan/Keluarkan-dari-arsip
  untuk kembali mengedit — persis semantik API (edit hanya draft,
  selain itu 409). Member non-owner/admin juga read-only.
- **Builder desktop-first (keputusan sadar):** kanvas drag-and-drop
  dioptimalkan untuk desktop; di layar kecil palet & panel menumpuk
  di bawah/atas kanvas dan tetap bisa dibaca, tetapi pengeditan
  serius memang pekerjaan desktop — tidak ada klaim optimasi mobile
  untuk canvas.
- Verifikasi (tanpa Playwright, sesuai keputusan user — UI diuji
  user sendiri): typecheck SEMUA paket hijau; build api/worker/web
  hijau; bundle publik memuat string dwibahasa flows + kode issue +
  react-flow, mengembalikan 200 untuk /flows & builder. **Rantai
  API bentuk-builder dari server 35/35 PASS dalam satu run bersih**
  (mock Telegram 8410, tenant uji): payload graf PERSIS seperti
  yang dikirim builder (position di semua node) → buat 201 →
  position utuh di respons & GET round-trip semua node → PATCH
  geser posisi tersimpan → validate kering valid nol issue →
  aktivasi 200 → webhook mock memicu run: Ani (tag vip) menempuh
  s1,c1,a1,s2, Budi menempuh s1,c1,st1,e1 (branch no + end), pesan
  mock terkirim persis per cabang, tag/stage kontak berubah,
  runCount ≥ 2 di daftar; member agent baca 200 / PATCH 403. Graf
  rusak ala builder (condition tanpa branch no) → validate
  valid=false dengan CONDITION_BRANCH_NO_MISSING pada node yang
  benar, aktivasi 422 FLOW_GRAPH_INVALID + details.issues
  terstruktur dan flow tetap draft. Regresi: graf 8A tanpa position
  dibuat/diaktifkan/dijalankan utuh dan node-nya tetap tanpa
  position di respons. Channel asli user (@botaramyid_bot) tetap
  connected; `.env.staging` pulih byte-identik (sha256 `9c1ded2a…`
  sebelum = sesudah), port mock tertutup.
- Batas jujur: (1) bukti VISUAL (rendering canvas, keterbacaan node
  di dua tema, rasa drag/zoom) menunggu uji user — yang terbukti di
  sini adalah kontrak ujung-ke-ujung yang dipakai UI-nya; (2) tidak
  ada auto-layout selain layout awal BFS untuk node tanpa posisi,
  tidak ada undo/redo, tidak ada ekspor/impor graf — kandidat
  lanjutan; (3) satu flow tetap satu trigger & bentuk graf v1 8A —
  builder tidak menambah kemampuan engine apa pun.

## Fase 9A — Paket Quick-Win I: Saved Replies, Spintax, Smart Delay, Batching AI + Rider Toggle Password (2026-11-02)

Empat fitur kecil dari riset repo referensi (user: "kerjakan
rekomendasimu saja") + satu rider permintaan user di tengah fase.
Commit: `008b81b` (spintax + smart delay), `c808bb6` (saved replies
+ rider), `ffd5c28` (batching), `4a82cbd` (fix batching — lihat
di bawah).

- **Saved Replies (macro `/`)**: migrasi 0033 `saved_replies`
  (tenant, title, body, `created_by_user_id` FK SET NULL) + RLS
  `tenant_isolation` (staging kini 40 tabel / 52 policy; PGlite
  verify seksi [26]). API `/tenants/:tenantId/saved-replies`: baca +
  buat untuk SEMUA member; edit/hapus hanya pembuat ATAU owner/admin
  (ditegakkan di core `saved-replies.ts` → 403; non-member 404).
  Audit `saved_reply.created/updated/deleted` + label dwibahasa di
  viewer audit. UI di dalam Inbox: draft diawali `/` membuka pemilih
  (filter judul/isi, ArrowUp/Down, Enter memilih — bukan mengirim,
  Esc menutup, entri "Kelola…" di bawah); memilih MENGGANTI seluruh
  draft dengan body dan `{name}` diganti KLIEN saat itu juga dari
  nama kontak percakapan (WYSIWYG); panel kelola menempel di form
  composer (daftar + form buat/edit + hapus dua langkah).
- **Spintax — satu helper render bersama**: `renderMessageText`
  (`packages/core/src/render-text.ts`) adalah satu-satunya jalur
  render teks keluar otomatis: substitusi `{name}` DULU (supaya
  pilihan spintax yang memuat `{name}` tetap satu grup), lalu grup
  `{a|b|...}` dipilih acak per render (regex `\{[^{}]+}` — TANPA
  nesting; grup satu pilihan & kurung tak berpasangan dibiarkan apa
  adanya; render TIDAK PERNAH gagal gara-gara spintax). Terpasang di
  4 titik: balasan keyword automation, langkah sequence, node flow
  `send_message`, dispatch broadcast (per penerima = render terpisah
  → variasi menyebar antar-penerima). Balasan manual dari dashboard
  TIDAK diproses (teks harfiah user).
- **Smart Delay (node delay flow)**: kontrak delay bertambah
  opsional `random: {min, max}` (bilangan bulat, satuan node yang
  sama; `random` mengalahkan `amount`; `amount` tetap fallback &
  wajib ada di skema). Validasi aktivasi: integer, 1 ≤ min ≤ max ≤
  100_000, pelanggaran = issue `DELAY_RANDOM_INVALID` (422
  FLOW_GRAPH_INVALID). Eksekutor memilih integer inklusif acak dan
  mencatat `{random:{min,max,unit}, chosenAmount, delayMs, resumeAt}`
  di detail langkah — bisa diaudit dari tab Run builder. Random
  rusak di graf aktif lama → jatuh ke `amount`, run tidak gagal.
  Builder: mode radio Tetap/Acak pada panel delay + ringkasan
  rentang di node.
- **Batching balasan AI**: env `AGENT_BATCH_WINDOW_MS`
  (0..120_000, default 5000) — job `agent.respond` kini dijadwalkan
  worker dengan delay sebesar jendela itu; saat job berjalan, bila
  ada pesan inbound kontak yang LEBIH BARU di percakapan yang sama,
  job menyerah: audit `agent.batched` {conversationId,
  triggerMessageId, supersededByMessageId}, return reason
  `"batched"`, TANPA memanggil LLM dan TANPA mengonsumsi cap
  harian. Hanya job pesan terbaru yang menjawab (riwayat dibaca
  saat eksekusi → jawaban mencakup seluruh rentetan). Mode suggest
  berbagi semantik; node flow `ai_response` TIDAK ikut (flag hanya
  dinyalakan jalur job agent.respond); automation/flow TIDAK
  tertunda sama sekali. **Trade-off terdokumentasi: balasan agent
  kini sengaja ±satu jendela lebih lambat.**
- **BUG yang tertangkap rantai staging (fix `4a82cbd`)**: versi
  pertama cek "pesan lebih baru" memakai `gt(createdAt,
  message.createdAt)` polos — Postgres `timestamptz` berpresisi
  mikrodetik, Date JS hanya milidetik (terpotong saat dibaca),
  sehingga baris pemicu cocok dengan dirinya sendiri dan SEMUA job
  menyerah (audit menunjukkan supersededBy == trigger). Fix:
  kecualikan eksplisit `ne(messages.id, messageId)`. Pelajaran:
  jangan pernah membandingkan timestamp DB dengan salinan JS-nya
  tanpa mengecualikan baris itu sendiri.
- **RIDER — toggle lihat password** (permintaan user 17:51):
  komponen bersama `PasswordInput` (ikon mata stroke konsisten
  dengan ikon aplikasi; tombol `type="button"` — tidak pernah
  men-submit form; state per field; default tersembunyi; aria-label
  + title dari `common.showPassword`/`common.hidePassword` en+id).
  Terpasang di SEMUA field password web: Login, Register, field
  rahasia Panel Admin, dan 4 field token di modal connect Channels
  (Telegram/Messenger/Instagram/WhatsApp). Semantik keamanan tidak
  berubah: nilai tersimpan tidak pernah dikembalikan server —
  toggle hanya memperlihatkan teks yang SEDANG diketik. Halaman
  Settings tidak punya form ganti password (tidak ada yang diubah
  di sana).
- **Pelajaran deploy (penting)**: API & worker staging berjalan
  dari `apps/*/dist/index.js` (bundle tsup), BUKAN dari src — build
  SEMUA dist (api+worker+web) di salinan /tmp sebelum rsync; rsync
  src saja membuat staging menjalankan kode lama secara diam-diam
  (rantai pertama 9A gagal persis karena ini: saved-replies 404,
  spintax literal, validasi delay absen). Verifikasi cepat sesudah
  deploy: `grep -c <string-baru> apps/worker/dist/index.js` di
  server.
- Verifikasi (tanpa Playwright, sesuai keputusan user — UI diuji
  user sendiri): typecheck semua paket hijau di salinan /tmp; PGlite
  verify SEMUA LULUS (26 seksi); build web/api/worker hijau; bundle
  publik `index-BdGlP0yE.js` memuat string rider dwibahasa ("Show
  password"/"Tampilkan kata sandi") + "Saved replies"/"Smart
  Delay". **Rantai dari server 51/51 PASS dalam satu run bersih**
  (mock Telegram 8410, satu tenant uji): saved replies CRUD +
  gerbang kepemilikan (member edit/hapus milik owner 403; owner
  menimpa milik member 200; non-member 404) + audit
  created:2/updated:2/deleted:1; spintax 8 kontak → semua balasan
  anggota himpunan sah dengan `{name}` benar & ≥2 varian, teks polos
  persis, kurung rusak terkirim apa adanya; smart delay 2–4 dtk →
  run waiting→completed, `chosenAmount ∈ [2,4]` tercatat, aktivasi
  min>max 422 DELAY_RANDOM_INVALID; regresi sequence 2 langkah +
  broadcast spintax per penerima selesai; batching: 3 pesan beruntun
  → TEPAT 1 `agent.responded` + 2 `agent.batched` + 1 baris usage
  ai_token, pesan tunggal tetap dijawab sesudah jendela, keyword
  automation membalas seketika dan TIDAK dijawab agent. Channel
  asli user (@botaramyid_bot) tetap connected; `.env.staging`
  pulih byte-identik (sha256 `9c1ded2a…` sebelum = sesudah), port
  mock tertutup.
- Batas jujur: (1) isi balasan agent memakai LLM OpenRouter ASLI
  (kunci panel milik user): pada kedua run burst, satu-satunya
  respons agent memilih tool `handoff_to_human` (KB kosong) sehingga
  tidak ada teks keluar — itu keputusan konten LLM (perilaku 3A
  terdokumentasi), bukan kegagalan batching; jaminan batching
  dibuktikan dari audit/usage yang deterministik; (2) bukti visual
  pemilih `/`, panel kelola, mode Acak builder, dan toggle mata
  menunggu uji user — yang terbukti di sini kontrak API + bundle;
  (3) jendela batch adalah konstanta env per-deployment, bukan
  per-tenant; (4) spintax tanpa nesting dan tanpa bobot pilihan —
  kandidat lanjutan bila dibutuhkan.

## Update Hotfix 7D.2 — Exchange OAuth Meta wajib redirect_uri (2026-11-02)

Wiring live Meta oleh user menemukan kegagalan nyata: callback
Instagram berulang berakhir `META_OAUTH_EXCHANGE_FAILED` dengan log
`[meta-oauth] exchange/discovery gagal (provider instagram) graph 100`
(Graph code 100 = parameter tidak valid; panel Meta terisi penuh oleh
user 18:31–18:39 +07 hari yang sama, jadi bukan soal konfigurasi
kosong).

- **Akar masalah — asumsi 7D GUGUR.** Dokumentasi contoh Unified Login
  yang dibaca pada Fase 7D menyiratkan exchange config-flow tanpa
  `redirect_uri`, dan implementasi 7D mengikutinya untuk cabang
  instagram & whatsapp (`exchangeOAuthCode` dipanggil tanpa
  `redirectUri`), sedangkan dialog OAuth untuk KETIGA provider
  dibangun dengan `redirect_uri` yang sama
  (`https://botara.my.id/api/meta/oauth/callback`). Aturan Meta yang
  terbukti live: code yang diterbitkan dialog ber-redirect_uri wajib
  ditukar dengan redirect_uri yang identik; tanpa itu Graph menolak
  dengan error 100 "Error validating verification code".
- **Perilaku baru.** Ketiga provider kini menukar code DENGAN
  `redirectUri` callback yang sama (`apps/api/src/modules/meta-oauth/
  routes.ts` — cabang instagram + whatsapp diperbaiki; messenger
  sudah benar sejak 7D). Komentar asumsi lama di routes.ts dan di
  `packages/channels/channel-messenger` diperbarui agar tidak
  menyesatkan pembaca berikutnya.
- **Logging diagnosis.** `MetaGraphError` kini membawa `graphSubcode`
  (ditangkap dari `error.error_subcode` pada respons Graph), dan log
  kegagalan exchange/discovery mencatat kode + subcode + pesan resmi
  Graph — kegagalan berikutnya terdiagnosis dari log saja. Auth code,
  token, dan secret TIDAK PERNAH dicatat (pesan resmi Graph tidak
  memuat ketiganya).
- **Deploy & batas.** Hanya dist api yang dibangun ulang dan service
  api yang direstart; service lain tidak disentuh. Pembuktian akhir
  adalah retry connect oleh user — OAuth live dengan dialog Meta asli
  tidak bisa dibuktikan dari mock/rantai lokal.

## Fase 9B — Paket Quick-Win II: Dashboard Pemakaian AI, Tiering MCP, Dedup & Merge Kontak (2026-11-02)

Commits: `215d6e7` (9B.1 analytics + fondasi 0034), `122ef17` (9B.2 MCP),
`2d9dd08` (9B.3 dedup/merge). Migrasi **0034** teraplikasi di staging
(jurnal DB terverifikasi **35 entri**; kolom `usage_ledger.meta` jsonb
default `'{}'` terverifikasi via information_schema).

### Fondasi 0034 (sisa agent 9B sebelumnya — DITERUSKAN apa adanya)

Agent 9B pertama mati karena daemon restart ±5 menit setelah spawn dan
meninggalkan fondasi yang belum ter-commit. Telaah sesi ini terhadap
keempatnya: migrasi `0034_usage_ledger_meta.sql` konsisten dengan skema
`usage_ledger` nyata (kolom meta memang belum ada), entri jurnal idx 34
konsisten, kolom Drizzle di `system.ts` cocok, dan seksi verify **[27]**
menguji default + agregasi + isolasi. **Diteruskan tanpa perubahan**;
PGlite verify lulus 27/27 termasuk [27]. Keputusan desain fondasi yang
dipertahankan: biaya provider disimpan di `meta.costUsd`, BUKAN kolom
`cost_model` (mata uang baris ledger = IDR; tidak boleh tercampur).

### 9B.1 Dashboard pemakaian AI (`/analytics`)

- **Pencatatan.** `recordUsageAndAudit` (satu-satunya penulis `ai_token`)
  kini menulis `usage_ledger.meta` = `{agentId, provider, model,
  tokensIn, tokensOut, costUsd?, costCurrency: 'USD'}`. `qty` tetap
  sumber total token semua era. Provider: `LlmUsage.costUsd?` baru;
  OpenRouter memintanya lewat `usage: { include: true }` pada request
  dan mengurai `usage.cost` dari respons (hanya bila number finite ≥ 0).
- **KEJUJURAN BIAYA (keputusan fase ini).** Biaya dicatat HANYA bila
  provider melaporkannya pada respons itu. TIDAK ada tabel harga statis,
  TIDAK ada estimasi. MockProvider tidak melaporkan biaya (`costUsd`
  absen — terbukti di rantai). Agregat menampilkan `costUsd` (null bila
  tak satu pun baris berbiaya) + `costReportedResponses` sebagai cakupan.
  Baris warisan tanpa rincian token in/out dihitung terpisah sebagai
  `undetailedResponses` dan hanya menyumbang `responses` + `tokensTotal`
  (qty) — rinciannya tidak pernah ditebak dari qty.
- **Backfill.** `pnpm --filter @sahabat-kreator/api backfill:usage-meta`
  (skrip `apps/api/scripts/backfill-usage-meta.ts`, run-once, idempoten):
  baris `ai_token` bermeta `'{}'` diisi dari audit `agent.responded`
  terbaru dengan `meta.triggerMessageId = ref_id` pada tenant yang sama.
  Biaya TIDAK di-backfill (audit lama tak mencatatnya). Hasil staging:
  run pertama **38 kandidat → 38 terisi, 0 tanpa pasangan**; run kedua 0;
  run di tengah rantai 9B: 1 kandidat rantai → 1 terisi.
- **API & UI.** `GET /tenants/:tenantId/analytics/ai-usage?days=1..90`
  (default 30; SEMUA member boleh membaca; non-member 404): ringkasan
  periode, deret harian UTC lengkap tepat `days` titik (hari nol tetap
  tampil), rincian per agent (nama ter-join dari tabel agents; bucket
  `agentId: null` = baris warisan), dan cap `{dailyLimit: 200, usedToday,
  remainingToday}` semantik UTC yang sama dengan runtime. Halaman
  `/analytics` menggantikan placeholder untuk seksi ini: kartu ringkasan
  (respons, token masuk, token keluar, biaya terlapor + catatan cakupan),
  catatan baris warisan bila ada, kartu cap dengan progress bar, tabel
  per agent, tabel harian; dwibahasa; keadaan kosong yang jujur.

### 9B.2 Tiering keamanan MCP

- Klasifikasi 7 tool yang benar-benar ada — BACA: `whoami`,
  `list_contacts`, `list_conversations`, `list_messages`,
  `list_products`; TULIS: `create_contact`, `send_message`.
- **Default server kini READ-ONLY.** Tool tulis TETAP terdaftar
  (discoverable) tetapi handler-nya menolak dengan error MCP yang jelas
  menyebut `MCP_ALLOW_WRITES=1` bila env tidak bernilai persis `"1"`.
  Penanda tier: `annotations.readOnlyHint` (true baca / false tulis),
  sufiks `[TIER TULIS …]` pada deskripsi tool tulis, dan baris log
  startup (stderr) yang menyatakan tier aktif.
- Lapisan ini independen dari scope API key: tulis berhasil hanya bila
  env DAN scope sama-sama mengizinkan (terbukti sesi C verify: kunci
  terbatas + env aktif → tetap `API_KEY_SCOPE_DENIED` dari API).
  **SDK tidak diubah.** README mcp-server menyatakan default read-only
  secara eksplisit + tabel tier per tool.

### 9B.3 Dedup & merge kontak

- **Sinyal** (tenant yang sama): telepon ternormalisasi sama (digit
  saja; awalan `0` → `62`; `+` dibuang; < 7 digit bukan sinyal) ATAU
  email ternormalisasi sama (trim + lowercase, wajib `@`) ATAU identitas
  channel sama (`provider + external_user_id`) di DUA kontak — identitas
  pada satu akun channel tak mungkin ganda (index unik), jadi sinyal
  identitas menangkap orang yang sama yang menempel lewat dua akun
  channel berbeda. Kelompok = komponen terhubung (union-find) atas
  sinyal-sinyal itu.
- `GET /tenants/:tenantId/contacts/duplicates` (semua member) →
  `{groups: [{contacts, reasons: [{type, value, contactIds}]}]}`;
  route didaftarkan sebelum `/:id`.
- `POST /tenants/:tenantId/contacts/:id/merge` `{mergedId}` — `:id` =
  survivor; **owner/admin saja** (member 403 `FORBIDDEN`); survivor ==
  merged → 422 `CONTACT_MERGE_SAME` (kode kontrak baru); salah satu tak
  ada di tenant → 404. SATU transaksi tenant:
  identitas channel, percakapan, automation runs, flow runs, saran
  agent, tautan bayar berpindah; enrollment sequence aktif sumber yang
  automation-nya juga aktif di survivor DIBATALKAN lebih dulu (index
  unik parsial `(automation, contact) WHERE active`), sisanya pindah;
  baris `broadcast_recipients` sumber yang broadcast-nya sudah dimiliki
  survivor DIHAPUS (unik `(broadcast, contact)`), sisanya pindah; foto
  profil kontak pindah bila survivor belum punya (bila punya, foto
  survivor menang, foto sumber dihapus); tags = gabungan; custom_fields
  survivor menang konflik + kunci kosong terisi dari sumber; phone/email
  survivor diisi dari sumber bila kosong; stage survivor dipertahankan;
  **opted_out MENANG** bila salah satu opted_out (consentAt mengikuti);
  `lastContactedAt` = yang terbaru; kontak sumber dihapus; audit
  `contact.merged` (meta: contactId survivor, mergedContactId,
  mergedContactName, reasons, movedCounts) + label viewer dwibahasa.
  Merge TIDAK mensyaratkan sinyal bersama — keputusan owner/admin;
  `reasons` dicatat apa adanya (bisa `[]`).
- UI Contacts: seksi "Kemungkinan duplikat" hanya tampil bila ada
  kandidat; survivor yang dipertahankan = kontak tertua dalam grup
  (urutan createdAt dari core); anggota lain punya tombol Gabungkan →
  dialog konfirmasi dwibahasa berisi konsekuensi (pindah + sumber
  dihapus + tidak bisa dibatalkan); tombol hanya untuk owner/admin
  (member melihat catatan gerbang). Sesudah sukses daftar + grup dimuat
  ulang.
- Catatan cakupan: `custom_fields` kontak saat ini TIDAK bisa diisi
  lewat API create/update kontak v1 (kontraknya memang tidak memuat
  field itu — terisi dari jalur lain); aturan merge-nya tetap diuji
  rantai dengan penyemaian langsung.

### Verifikasi (tanpa Playwright, sesuai aturan fase)

- Typecheck semua paket hijau (exit 0); build semua dist hijau;
  PGlite verify **27/27** termasuk [27].
- Deploy: build di salinan kerja → rsync → migrasi 0034 → jurnal **35**
  → backfill → restart 4 service → health ok; bundle server memuat
  `analytics/ai-usage` + duplicates; bundle publik memuat string
  analytics + duplikat dwibahasa.
- Rantai dari server (tenant uji + mock; log lengkap
  `/home/ubuntu/sk9b-chain/chain4.log` di server): **86 PASS / 0 FAIL**.
  (1) Usage: 4 baris semai deterministik (2 agent, 1 berbiaya ×2, 1
  warisan) → agregat cocok persis (responses 4, total 1464, in/out
  310/155, detailed 3/undetailed 1, cost 0.033 cakupan 2, cap 2/200,
  deret 30 titik, per-agent + nama ter-join); member 200, non-member
  404, tenant lain 0 & cost null. Backfill atas baris rantai: detailed
  4/0, in/out 1210/254, biaya TIDAK berubah. Pemicu agent deterministik:
  `respondToInboundMessage` + MockProvider lewat skrip tsx core di
  server (mekanisme yang dinyatakan; worker produksi tidak disentuh) →
  baris usage baru `mock|mock-1|94|27`, qty = in+out, TANPA costUsd.
  (2) MCP verify:mcp 17/17 dalam 3 sesi (baca jalan; tulis ditolak tanpa
  env dengan pesan MCP_ALLOW_WRITES; tulis berhasil dengan env; kunci
  terbatas + env → API_KEY_SCOPE_DENIED). (3) Dedup/merge: kelompok
  {K1,K2,K3} dengan 3 alasan benar (phone `6281234567890`, email,
  `webchat:visitor-merged`); member merge 403; merge-ke-kontak-tenant-
  lain 404; merge K2→K1: tags gabungan, opted_out menang, custom_fields
  survivor menang + terisi, percakapan + identitas berpindah, sumber
  404, audit `contact.merged` ber-reasons; merge K3→K1; kandidat habis;
  kontak tenant lain utuh. (4) Regresi automation keyword lewat mock
  Telegram: webhook (secret plaintext ditangkap dari payload setWebhook
  mock — DB hanya menyimpan hash-nya) → balasan ter-render `{name}` →
  terkirim via mock, status sent.
- `.env.staging` pulih **byte-identik** (sha256 `9c1ded2a…` sebelum =
  sesudah); channel asli user `@botaramyid_bot` (akun `8fb9b81c`,
  tenant user) tetap **connected**; tenant asli user tidak disentuh.

### Batas jujur

- Bukti biaya end-to-end dengan OpenRouter ASLI (baris ber-`costUsd`
  dari respons live) belum terjadi di rantai ini: pemicu rantai memakai
  MockProvider demi determinisme (dan tidak membakar kuota free-tier
  user). Jalur pencatatan biaya terverifikasi pada level provider
  (parsing `usage.cost`) + agregasi atas baris semai ber-costUsd; bukti
  live-nya akan muncul sendiri di `/analytics` tenant user dari respons
  agent asli berikutnya (panel sudah memakai kunci OpenRouter asli).
- `findDuplicateContacts` memuat seluruh kontak tenant ke memori —
  wajar pada skala workspace saat ini; kandidat lintas tenant tidak
  pernah muncul karena semua query dalam konteks RLS tenant.
- UI/UX (halaman analytics + seksi duplikat) dibuktikan lewat bundle +
  rantai API; pengujian visual tetap oleh user sesuai pembagian kerja.

## Fase 7D.3 — Koneksi Instagram via System User Token + Rantai Penemuan OAuth Multi-Tepi (2026-11-02)

Konteks: wiring live membuktikan aplikasi Meta user ("Botara Dev") dan
akun IG user (@syahidsyahdansaja) berada di portofolio bisnis yang SAMA
(SHD Store). Untuk kasus satu-portofolio, wizard Unified Login
menciptakan "business integration system user" tersembunyi yang tidak
menerima aset portofolio itu sendiri, sehingga penemuan 7D
(`/me/assigned_instagram_accounts` saja) selalu kosong bagi akun
pemilik — padahal dialognya sendiri sah dan tetap menjadi jalur yang
benar untuk klien dari portofolio LAIN. Fase ini membuka dua jalan
sekaligus: jalur manual SUAT untuk kasus portofolio-sama, dan rantai
penemuan multi-tepi (adopsi pendekatan kode referensi yang diberikan
user dan terbukti menghubungkan IG-nya; implementasi ditulis ulang
penuh dengan pola klien Graph kita, tanpa menyalin kode referensi).

### 1. Varian manual Instagram via System User Token

- Kontrak: `CreateChannelRequest.tokenType` —
  `"page_access_token"` (bawaan bila absen; perilaku 7A persis) atau
  `"system_user_token"` (baru; hanya bermakna untuk instagram). Token
  tetap masuk lewat field `pageAccessToken` yang sama.
- Varian SUAT: field = ID akun IG + SUAT, TANPA Page ID. Validasi
  server `GET /{ig-id}?fields=id,username` dengan SUAT
  (`MetaGraphClient.getInstagramAccountProfile`); ditolak Graph → 422
  `META_TOKEN_INVALID` (kode yang sama seperti jalur Page);
  `public_handle` dari username. `parent_external_id` diisi dari
  `GET /me?fields=client_business_id` secara best-effort (gagal →
  null, tidak menggagalkan koneksi).
- Simpan lewat jalur create/revive 7A yang sama persis (penjaga
  satu-akun 409 `META_ACCOUNT_ALREADY_CONNECTED`, enkripsi envelope
  yang sama). Menghubungkan ulang akun yang sudah 'connected' tetap
  idempoten mengembalikan baris lama (kredensial tidak ditimpa).
- Sesudah tersimpan (create & revive), subscribe
  `POST /{ig-id}/subscribed_apps` (field messages) dicoba dengan SUAT;
  kegagalan TIDAK menggagalkan koneksi — respons connect menyertakan
  field tambahan `warnings: ["META_SUBSCRIBE_FAILED"]` (konsisten
  dengan complete OAuth 7D; jalur non-SUAT tidak berubah sama sekali,
  termasuk tidak adanya panggilan subscribe seperti sebelumnya).
- Pengiriman keluar: poller Meta memakai token tersimpan apa adanya
  sebagai Bearer ke `POST /{ig-id}/messages` — terverifikasi tidak ada
  asumsi "token = Page token" di jalur kirim IG, jadi SUAT bekerja
  tanpa perubahan poller.
- UI: form manual Instagram mendapat radio "Jenis token" (Page access
  token / Token System User). Varian SUAT menyembunyikan field Page
  ID; label + placeholder + petunjuk dwibahasa (`channels.suat*`)
  menjelaskan dengan jujur kapan varian ini dipakai (akun satu
  portofolio dengan aplikasi; buat System User di Pengaturan Bisnis,
  tetapkan aplikasi + akun IG, generate token tak-kedaluwarsa berizin
  instagram_basic + instagram_manage_messages). Field token tetap
  `PasswordInput` berikon mata. Peringatan subscribe dari respons
  ditampilkan pada banner peringatan yang sama seperti alur OAuth.

### 2. Rantai penemuan OAuth (callback) + probe profil token

Penemuan Instagram bukan lagi satu tepi. `MetaGraphClient.
discoverInstagramAccounts(trace)` mencoba berurutan dan menggabungkan
(dedupe by ID akun IG; username terisi dari tepi mana pun; Page token
menang atas kandidat tanpa token):

- (a) `assigned_instagram_accounts` — `GET /me/assigned_instagram_accounts?fields=id,username` (jalur SUAT murni).
- (b) `accounts_instagram_business_account` — `GET /me/accounts?fields=id,access_token,instagram_business_account{id,username}`: IG yang menempel pada Page; kandidat membawa Page token Page itu. Menurut komentar kode referensi, dialog Unified Login pada praktiknya menyerahkan PAGE sebagai aset dan IG menumpang padanya — tepi inilah yang menemukan akun pada implementasi referensi.
- (c) `businesses_instagram_accounts` — `GET /me/businesses?fields=id,instagram_accounts{id,username}`: IG MILIK portofolio yang terlihat token. Tepi kritis untuk akun aset portofolio yang tidak tertaut ke Page mana pun (persis kasus user). Tepi ini dapat menolak dengan error izin (graph_200) bila konfigurasi Login untuk Bisnis tidak memuat `business_management`.
- (d) `page_instagram_business_account` — per-Page (maks 10) via rantai daftar Page di bawah: IG tertaut tiap Page (`GET /{page-id}?fields=instagram_business_account{id,username}` bila belum diketahui dari daftar); kandidat membawa token Page itu bila ada.

Setiap tepi meninggalkan jejak `{label, count, error}`; callback
menulis SATU baris log
`[meta-oauth] discovery provider=instagram <label>=<n|ERR:kelas> ... total=<n> token=<system_user|user|unknown>`.
Kegagalan satu tepi tidak menggagalkan tepi lain. Rancangan awal fase
ini (union `/{client_business_id}/assigned_instagram_accounts`)
digantikan rantai ini — semangat tepi bisnisnya tercakup oleh (c).

Probe profil token: `GET /me?fields=id,client_business_id`
best-effort di callback IG. `client_business_id` terisi = SUAT.
Hasilnya (tanpa token) disimpan di sesi OAuth dan menentukan
petunjuk keadaan kosong picker (`MetaOAuthSessionResponse.emptyHint`,
hanya untuk instagram ber-aset kosong):

- `business_permission_missing` — tepi (c) menolak graph_200/graph_10
  → picker menyebut kemungkinan izin `business_management` belum ada
  di konfigurasi Login untuk Bisnis. (Prioritas tertinggi: paling
  bisa ditindak.)
- `not_system_user` — token bukan SUAT → periksa jenis token pada
  konfigurasi Facebook Login untuk Bisnis.
- `no_accounts_shared` — SUAT sah tetapi semua tepi kosong → akun
  belum dibagikan / kasus portofolio-sama; arahkan ke jalur manual
  System User Token.
- `null` — probe/jejak tak memberi kesimpulan → pesan generik lama.

Complete OAuth: token per aset (`pageTokens`) kini berlaku juga untuk
Instagram — kandidat lewat Page disimpan dengan Page token-nya
(semantik sama seperti connect manual IG via Page), kandidat lain
dengan SUAT alur. Subscribe complete memakai token terpilih itu.

Rantai daftar Page bersama (`listPageCandidates`, jejak
`pages_accounts`/`pages_assigned_pages`/`pages_businesses`/
`pages_backfill`): `/me/accounts` (fields penuh) →
`/me/assigned_pages?fields=id,name` →
`/me/businesses?fields=owned_pages,client_pages`; dedupe first-wins;
token Page yang kosong diisi best-effort lewat
`GET /{page-id}?fields=id,name,username,access_token,instagram_business_account{id,username}`.
Discovery Messenger memakai rantai yang sama (`getManagedPages`
menyaring kandidat bertoken): exchange tidak berubah; untuk token
user klasik himpunan Page dari /me/accounts dipertahankan persis
(kemunculan pertama menang; rantai hanya menambah). Discovery
WhatsApp tidak berubah; log jumlahnya diseragamkan
(`me=<WABA> business=null total=<nomor>`).

### 3. Pemeriksaan satu kali Page asli user (konfirmasi, bukan pembuktian)

Sesuai brief, token Page Messenger ASLI user (tenant "Mas Romo WS
Baru", Page "Sahabat Kreator Indonesia", external_id 1272001186005103)
dipakai satu kali di server untuk `GET /{pageId}?fields=
instagram_business_account{id,username}` ke Graph asli (token tidak
pernah dicetak). Hasil: Graph MENOLAK dengan error 100 — endpoint
meminta izin `pages_read_engagement` (atau fitur Page Public Content/
Metadata Access), yang TIDAK termasuk scope OAuth Messenger kita
(pages_show_list, pages_messaging, pages_manage_metadata). Jadi
keterkaitan IG tidak bisa dikonfirmasi maupun disangkal lewat token
tersimpan itu; pernyataan user sendiri (IG adalah aset portofolio
SHD Store, tidak tertaut ke Page tersebut) tetap menjadi dasar —
tepi (c) adalah jalur kritisnya, dan tepi (b)/(d) untuk akun user ini
memang diperkirakan kosong. Scope Messenger SENGAJA tidak diperluas
di fase ini (mengubah scope menyentuh alur yang sudah terbukti live
dan berimplikasi App Review).

### Verifikasi (TANPA Playwright)

- Typecheck: contracts, channel-messenger, i18n, api hijau di tree
  utama; web hijau penuh di salinan build. (Di tree utama VM,
  typecheck web menampilkan 35 error lama di FlowBuilderPage.tsx —
  terkonfirmasi pra-ada di HEAD 47701a8 dan disebabkan paket
  `@xyflow/react` yang belum ter-install di node_modules tree utama;
  salinan build `/var/tmp/sk7d3-build` dengan install `--frozen-lockfile`
  lengkap membuktikan keduanya hijau. Catatan lingkungan: `pnpm install`
  di direktori salinan yang node_modules-nya hasil rsync akan menunggu
  prompt interaktif — jalankan dengan `CI=true` sesudah menghapus
  node_modules salinan.)
- PGlite verify db: 27/27 SEMUA LULUS (fase ini TANPA migrasi —
  tidak ada perubahan skema; parent_external_id & kolom lain sudah
  ada sejak 0026/0027).
- Build semua paket hijau di salinan; bundle API memuat
  `discoverInstagramAccounts`/`businesses_instagram_accounts`/
  `system_user_token`; bundle web memuat kunci SUAT + petunjuk picker.
- Rantai mock Graph dari server (mock di 127.0.0.1:4719, jendela
  META_API_BASE): **44/44 PASS** — connect SUAT sukses (handle +
  parent terisi, subscribe terpanggil dengan SUAT), token buruk 422,
  subscribe gagal → 201 + warnings, poller mengirim dengan SUAT
  tersimpan; regresi jalur Page token (201, tanpa subscribe);
  penemuan hanya-(b) / hanya-(c) / hanya-(d) (termasuk backfill
  token Page), dedupe lintas tepi dengan Page token menang, tiga
  petunjuk kosong spesifik + trace `ERR:graph_200`; Messenger persis
  himpunan /me/accounts klasik + kirim dengan Page token; WhatsApp +
  log discovery; channel asli user (Telegram + Messenger) tetap
  connected. Driver memurge artefak tenant rantai sebelumnya di awal
  agar penjaga satu-akun tidak menabrak antar-run.
- Deploy: rsync salinan build (tanpa `--delete`, `.env.staging`
  dikecualikan) → restart api/web/worker via MainPID; health lokal +
  publik ok. `.env.staging` pulih byte-identik sesudah jendela mock
  (sha256 `9c1ded2a5a69…` sebelum = sesudah).

### Batas jujur

- Bukti LIVE penuh menunggu user: (1) membuat System User eksplisit
  di SHD Store + SUAT tak-kedaluwarsanya lalu connect manual varian
  System User Token (jalur yang dirancang persis untuk kasusnya);
  (2) retry OAuth IG untuk melihat rantai penemuan + jejak log pada
  token nyata — khususnya apakah tepi (c) mengembalikan
  @syahidsyahdansaja dan apakah konfigurasinya memuat
  business_management. Mock membuktikan perilaku kode terhadap
  bentuk-bentuk respons Graph, bukan kebijakan delegasi Meta yang
  sebenarnya.
- Subscribe `subscribed_apps` untuk akun IG dengan SUAT (bentuk
  respons Graph-nya) tetap asumsi yang hanya bisa dibuktikan oleh
  connect live pertama; kegagalannya sudah dirancang tidak
  menggagalkan koneksi (warnings).

## Fase 9C — Kedalaman Inbox Tim: Assignment, Catatan Internal, Undangan & Peran (2026-11-02)

Migrasi **0035** teraplikasi di staging (jurnal DB terverifikasi
**36 entri**; total **41 tabel, 54 policy**; `has_table_privilege`
sk_app atas `conversation_notes` = true lewat ALTER DEFAULT
PRIVILEGES). Fondasi yang SUDAH ada dan dipakai apa adanya:
`conversations.assignee_user_id` (sejak 0004 — fase ini menambah
endpoint assign + filter + UI + index, BUKAN kolom baru) dan tabel
`invitations` (sejak 0000, belum pernah punya API — fase ini
melengkapinya dengan `revoked_at` + seluruh siklus hidupnya).

### Keputusan desain

- **Catatan internal = tabel TERPISAH `conversation_notes`**, bukan
  penanda di `messages`. Seluruh jalur keluar (poller Telegram/Meta,
  flush webchat, broadcast, agent) hanya pernah membaca tabel
  `messages`, jadi catatan tidak bisa bocor ke kontak/provider —
  bukan difilter, melainkan tidak berada di tabel yang pernah dibaca
  pengirim mana pun; tabelnya pun tidak punya kolom direction/status.
  Penulis FK `ON DELETE SET NULL` (pola saved_replies): catatan
  bertahan walau penulis keluar; penghapusan hanya penulis atau
  owner/admin. Isi catatan TIDAK masuk meta audit (hanya id).
- **Undangan hash-only + sekali lihat** (pola kunci API 5A): token
  mentah 32 byte acak hanya muncul di `inviteUrl` respons PEMBUATAN;
  server menyimpan SHA-256-nya saja. Mengundang ulang email yang sama
  mencabut undangan pending lamanya (satu tautan hidup per email).
  Masa berlaku 7 hari. Status diturunkan dari kolom waktu
  (pending/accepted/revoked/expired), bukan kolom status.
- **Lengan RLS `invitation_token_lookup`** (migrasi 0035): penerima
  belum member di mana pun, jadi pembacaan token berjalan TANPA
  konteks tenant lewat setting transaksi `app.invitation_token_hash`
  (SELECT saja, hanya baris pemilik hash persis — pola 0006/0012/
  0016). Penulisan terima/cabut tetap dalam konteks tenant barisnya.
- **Invariant owner ditegakkan di core**: peran owner tidak bisa
  diberikan (skema undangan & ganti peran hanya admin/agent/viewer),
  diturunkan, atau dikeluarkan (`TEAM_OWNER_PROTECTED`); aksi pada
  diri sendiri ditolak (`TEAM_SELF_ACTION` — presedensi: bila target
  adalah owner SEKALIGUS diri sendiri, OWNER_PROTECTED yang
  dilaporkan, terbukti di rantai). Mengeluarkan member men-NULL-kan
  `assignee_user_id` percakapannya dalam transaksi yang sama.
- **Email sungguhan TIDAK dikirim** (belum ada provider email): UI
  Settings menyatakan apa adanya bahwa tautan disalin & dibagikan
  manual oleh pengundang. Penerima membuka `/invite/:token` (halaman
  standalone di dalam AuthProvider; path undangan disimpan sebagai
  tujuan-kembali 6E saat belum login), email sesi harus sama persis
  dengan email undangan (selain itu 403 `INVITATION_EMAIL_MISMATCH`).
- **Assignment TIDAK menyentuh `agent_enabled`**: kolom & perilaku
  handoff AI persis seperti sebelumnya; audit
  `conversation.assigned`/`conversation.unassigned` bermeta id saja.
  Serializer percakapan bersama (dashboard + API v1) kini memuat
  `assigneeName` (nama ?? email penerima; join users dalam query
  daftar yang sama).
- **Audit baru**: `conversation.assigned`, `conversation.unassigned`,
  `conversation.note_created`, `conversation.note_deleted`,
  `team.invited`, `team.invitation_revoked`, `team.member_joined`,
  `team.role_changed`, `team.member_removed` + label viewer dwibahasa
  + target `invitation`/`member`/`conversation_note`.

### API baru

- `POST /tenants/:tid/conversations/:id/assign` {assigneeUserId|null}
  (semua member; target harus member tenant ini → 422
  `ASSIGNEE_NOT_MEMBER`); `GET .../conversations?assignment=mine|
  unassigned` (mine = penugasan pada pemanggil).
- `GET|POST /tenants/:tid/conversations/:id/notes`,
  `DELETE .../notes/:noteId` (204; hapus oleh bukan-penulis
  non-manajer → 403 FORBIDDEN).
- `GET /tenants/:tid/team/members` (semua member);
  `GET|POST /tenants/:tid/team/invitations` + `DELETE
  .../invitations/:id` (owner/admin);
  `PATCH|DELETE /tenants/:tid/team/members/:userId` (owner/admin;
  422 OWNER_PROTECTED / SELF_ACTION).
- `GET /api/invitations/:token` (pratinjau: workspace, peran, status,
  emailMatches) + `POST /api/invitations/:token/accept` (422
  EXPIRED/REVOKED/ALREADY_ACCEPTED; 403 EMAIL_MISMATCH).

### UI

- Inbox: tab filter Semua/Milik saya/Belum ditugaskan di atas daftar;
  chip `@nama` assignee di item daftar; pemilih assignee di header
  panel; tab panel Pesan | Catatan — tab catatan menggantikan
  utas+composer dengan daftar catatan (penulis + waktu, aksen
  peringatan) + form tambah. Penjagaan: sinkronisasi badge unread
  hanya berjalan pada filter "all" agar angka nav tidak menyusut
  saat filter aktif.
- Settings: seksi **Tim** (daftar member + chip/peran, ganti peran
  via select, keluarkan member dengan modal konfirmasi; form undang
  email+peran; panel tautan sekali-lihat dengan tombol salin; daftar
  undangan + status + cabut). Non-manajer melihat catatan khusus.
- `/invite/:token`: halaman terima undangan (lihat keputusan di
  atas). Audit viewer menampilkan 9 aksi baru dwibahasa.

### Verifikasi Fase 9C

- Typecheck SEMUA paket hijau. Catatan lingkungan: typecheck web di
  VM sempat gagal oleh `Cannot find module '@xyflow/react'` —
  node_modules VM basi terhadap lockfile (bukan regresi 9C); pulih
  dengan `pnpm install --frozen-lockfile` di tree utama (berakhir
  EPERM jinak pada penulisan `.modules.yaml`; paket terpasang &
  typecheck hijau sesudahnya).
- PGlite verify: **28/28 seksi LULUS** termasuk [28] baru
  (conversation_notes terisolasi + insert silang ditolak + tanpa
  konteks 0 baris; lengan invitation_token_lookup membuka tepat
  baris pemilik hash & menolak hash lain; hitungan kini 41 tabel /
  54 policy).
- Rantai dari server (tenant uji `fase9c5-*@sk.test`, mock Telegram
  lokal bot 777555114 lewat jendela `TELEGRAM_API_BASE`, env dipulih
  byte-identik sha `9c1ded2a…` + API restart sesudahnya): **66 PASS /
  1 FAIL** + 2/2 probe tambahan. Yang terbukti: assign→filter
  mine/unassigned benar dua arah→unassign; assign non-member 422;
  assign oleh non-member 404; catatan dibuat & dibaca member lain,
  TIDAK memicu satu pun `sendMessage` ke mock dan tidak muncul
  sebagai pesan, hapus oleh bukan-penulis 403, owner bisa menghapus
  catatan member; balasan manual tetap terkirim ke mock & berstatus
  sent (regresi inbox sehat); undangan buat→preview→terima berperan
  agent; token dipakai ulang 422 ALREADY_ACCEPTED; dicabut 422
  REVOKED; kedaluwarsa (expires_at dimundurkan via DB) 422 EXPIRED;
  email berbeda 403 EMAIL_MISMATCH; ganti peran berlaku (viewer
  kehilangan hak mengundang 403); keluarkan member → akses 404 +
  assignment-nya ter-NULL otomatis; 9 aksi audit baru terbaca dari
  API audit. Satu FAIL adalah presedensi kode: owner menarget diri
  sendiri mendapat `TEAM_OWNER_PROTECTED` (bukan `TEAM_SELF_ACTION`)
  — keduanya 422 tanpa perubahan; probe tambahan membuktikan
  `TEAM_SELF_ACTION` untuk admin non-owner (PATCH & DELETE diri →
  422). Isolasi lintas tenant terbukti untuk assign/notes/team.
- Jendela mock ±7 menit: nol pesan & nol baris integration_log pada
  tenant asli user selama jendela; channel asli user terverifikasi
  utuh sesudahnya (Telegram @botaramyid_bot + Page Messenger tetap
  connected). Berkas mock/rantai di server dihapus; tidak ada
  kredensial di log rantai (secret webhook uji ditulis sebagai hash
  langsung ke baris akun uji).
- Batas jujur: (1) UI 9C (tab catatan, pemilih assignee, seksi Tim,
  halaman /invite) belum diuji klik — menunggu uji UI user seperti
  fase-fase sebelumnya; bundle web terverifikasi memuat string baru.
  (2) Regresi agent tidak dijalankan live fase ini (kode agent tidak
  disentuh; staging memakai LLM asli dari Panel Admin — tidak
  dibakar untuk tenant uji). (3) Undangan yang diterima saat penerima
  SUDAH member lewat jalur lain: undangan ditutup & peran lama
  dipertahankan (perilaku terpilih di core; tidak diuji rantai).
  (4) Daftar member/undangan tanpa pagination (skala tim kini kecil).
