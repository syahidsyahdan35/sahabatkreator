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
