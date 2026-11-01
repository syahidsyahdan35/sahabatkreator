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
