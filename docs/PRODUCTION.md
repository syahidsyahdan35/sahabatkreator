# Runbook Produksi — Sahabat Kreator (Fase 14C)

Semua yang dibutuhkan untuk mengangkat produksi begitu user
menyediakan domain produksi. Status dokumen ini: **spesifikasi yang
sudah dibuktikan di staging sejauh yang bisa dibuktikan tanpa domain &
kredensial produksi** — item yang memang hanya bisa dieksekusi sesudah
domain ada ditandai eksplisit `[DOMAIN]`, dan langkah yang hanya bisa
dilakukan user ditandai `[USER]` (daftar gabungannya di §9).

Sepanjang dokumen, `<domain>` = domain produksi (mis. `app.contoh.id`).
Nilai staging yang menjadi acuan pola: `botara.my.id`.

## 0. Urutan go-live (ringkas)

1. `[USER]` Domain + akun Cloudflare menaungi domain itu.
2. Server produksi siap (topologi sama seperti staging, §4) + DB kosong
   ter-migrasi (§5).
3. `.env.production` terisi (template `.env.production.example`) +
   Panel Admin diisi (§5).
4. Ruleset edge Cloudflare diterapkan (§2) `[USER — dashboard CF]`.
5. Dependensi eksternal: App Review Meta (§6.1), verifikasi Google
   (§6.2), domain pengirim Resend (§6.3), aktivasi merchant production
   (§6.4) — beberapa berjalan paralel dan memakan waktu hari-minggu,
   mulai paling awal.
6. Checklist pra-luncur (§9) hijau → buka pendaftaran.

## 1. DNS & Cloudflare

Pola staging yang terbukti: domain di Cloudflare → **Cloudflare Tunnel
(remotely managed)** → origin `127.0.0.1:5180` di server; origin tidak
pernah terekspos langsung. Produksi memakai pola yang sama:

1. `[USER]` Tambahkan domain ke Cloudflare; nameserver mengikuti CF.
2. `[USER]` Zero Trust → Networks → Tunnels → buat tunnel produksi →
   public hostname `<domain>` → service `http://127.0.0.1:5180`.
3. Pasang cloudflared di server produksi dengan token tunnel itu
   (rahasia sisi server — lihat SECRETS-RUNBOOK.md).
4. SSL/TLS mode: **Full (Strict)** tidak relevan untuk tunnel (koneksi
   edge→origin terenkripsi oleh tunnel); set "Always Use HTTPS" aktif.
5. Verifikasi: `https://<domain>/api/health` → `{"status":"ok",...}`.

Alternatif (tidak dipilih): DNS A-record + origin terekspos — ditolak
karena asumsi kepercayaan header `cf-connecting-ip` pada rate limit
auth (lihat `apps/api/src/auth.ts`) hanya sah bila origin HANYA bisa
dicapai lewat Cloudflare.

## 2. Ruleset edge Cloudflare — SPESIFIKASI (terapkan di dashboard CF saat domain ada)

App sudah punya rate limit per-IP-asli untuk auth (§8); ruleset edge
ini adalah lapisan di depannya: menahan banjir sebelum mencapai origin
dan memberi batas untuk permukaan publik yang memang tidak punya limit
aplikasi. **Belum diterapkan di mana pun** — tidak ada kredensial CF
yang dipegang agent; ekspresi di bawah siap tempel
(Rules → Rate limiting rules), karakteristik semua rule = IP,
aksi = Block (CF menjawab 429 untuk rate-limit block).

| # | Nama | Ekspresi | Batas | Catatan |
|---|---|---|---|---|
| E1 | Auth sign-in | `(http.host eq "<domain>" and http.request.uri.path eq "/api/auth/sign-in/email")` | 20 req / 60 dtk per IP → Block | Menyamai batas aplikasi (20/60) |
| E2 | Auth sign-up | `(http.host eq "<domain>" and http.request.uri.path eq "/api/auth/sign-up/email")` | 10 req / 60 dtk per IP → Block | Menyamai batas aplikasi (10/60) |
| E3 | Reset kata sandi | `(http.host eq "<domain>" and (http.request.uri.path eq "/api/auth/request-password-reset" or starts_with(http.request.uri.path, "/api/auth/reset-password")))` | 10 req / 60 dtk per IP → Block | Aplikasi tidak punya rule khusus jalur ini (hanya cap global) — edge adalah kontrol utamanya |
| E4 | Webhook — langit-langit pemantau | `(http.host eq "<domain>" and (starts_with(http.request.uri.path, "/api/meta/webhook") or starts_with(http.request.uri.path, "/api/telegram/webhook") or starts_with(http.request.uri.path, "/api/payments/webhook")))` | 6.000 req / 60 dtk per IP → Block | **Dikecualikan dari E5**, bukan dari pemantauan: ketiga jalur ini diverifikasi tanda tangan/token di aplikasi (fail-closed) dan provider sah memang mengirim burst. Angka ini hanya langit-langit anti-banjir; pantau lewat CF Analytics (aksi Log khusus tersedia di plan berbayar) |
| E5 | API umum | `(http.host eq "<domain>" and starts_with(http.request.uri.path, "/api/") and not (starts_with(http.request.uri.path, "/api/meta/webhook") or starts_with(http.request.uri.path, "/api/telegram/webhook") or starts_with(http.request.uri.path, "/api/payments/webhook")))` | 600 req / 60 dtk per IP → Block | Termasuk `/api/v1/*` (API key) — penyalahgunaan per-kunci ditangani pencabutan kunci tenant, bukan edge |
| E6 | Publik bayar & growth | `(http.host eq "<domain>" and (starts_with(http.request.uri.path, "/pay/") or starts_with(http.request.uri.path, "/go/") or starts_with(http.request.uri.path, "/api/pay/")))` | 120 req / 60 dtk per IP → Block | Halaman bayar publik + redirect growth link |
| E7 | Webchat publik | `(http.host eq "<domain>" and starts_with(http.request.uri.path, "/api/webchat/"))` | 300 req / 60 dtk per IP → Block | Sesi + pesan + handshake WS widget di situs tenant |

Staging (`botara.my.id`): menerapkan E1–E3 + E5 dengan host diganti
**disarankan** tetapi opsional (lingkungan uji; rate limit aplikasi
sudah aktif dan terbukti — §8).

## 3. Inventaris URL yang berubah mengikuti domain

Satu-satunya sumber domain di kode adalah `BETTER_AUTH_URL` (origin
publik). Semua URL di bawah diturunkan darinya atau didaftarkan
dengan pola yang sama; saat domain produksi dipasang, daftarkan nilai
produksinya di tempat yang tercantum.

| Keperluan | Pola URL | Didaftarkan / diatur di |
|---|---|---|
| Basis publik aplikasi | `https://<domain>` | env `BETTER_AUTH_URL` |
| Callback OAuth Meta (Messenger/IG/WA) | `https://<domain>/api/meta/oauth/callback` | Meta App → Facebook Login → Valid OAuth Redirect URIs |
| Webhook Meta (callback) | `https://<domain>/api/meta/webhook` | Meta App → Webhooks (verify token = env `META_WEBHOOK_VERIFY_TOKEN`) |
| Domain konfigurasi FLB (IG & WA Unified Login) | `<domain>` | Meta App → konfigurasi FLB: allowed domains |
| Redirect OAuth Google Calendar | `https://<domain>/api/google/oauth/callback` | Google Cloud Console → OAuth client → Authorized redirect URIs (HARUS persis) |
| Notifikasi Midtrans | `https://<domain>/api/payments/webhook/midtrans` | Dashboard Midtrans (per tenant, diarahkan oleh UI Settings → Payments kita) |
| Callback invoice Xendit | `https://<domain>/api/payments/webhook/xendit` | Dashboard Xendit (per tenant, sama seperti di atas) |
| Webhook Telegram | `https://<domain>/api/telegram/webhook/<channelAccountId>` | Otomatis: aplikasi mendaftarkannya via setWebhook dari basis publik saat channel terhubung — tidak ada langkah manual |
| Domain pengirim email (Resend) | domain pengirim pilihan platform | Resend → Domains: tambahkan record DKIM/SPF yang diberikan Resend ke DNS CF `[USER]`; isi `resend_from_email` di Panel Admin |
| Tautan bayar publik | `https://<domain>/pay/<code>` | Turunan `BETTER_AUTH_URL`; tidak ada pendaftaran |
| Halaman legal (untuk App Review) | `https://<domain>/privacy`, `/terms`, `/data-deletion` | URL ini yang didaftarkan ke Meta App & Google consent screen |

## 4. Server produksi — delta terhadap staging

Topologi identik dengan staging (docs/DEPLOY-STAGING.md): container
`pgvector/pgvector:pg16` (port lokal 5434, dua role `sk_app` /
`sk_migration`), container Redis proyek (6381), empat unit systemd
user `ubuntu` dengan runtime Bun. Delta saja:

| Aspek | Staging | Produksi |
|---|---|---|
| Domain | botara.my.id | `<domain>` `[DOMAIN]` |
| Berkas env | `.env.staging` | `.env.production` (template `.env.production.example`) |
| Unit systemd | `sahabat-kreator-{api,web,worker,realtime}` | Nama sama di host terpisah; bila satu host berbagi dengan staging, akhiran `-prod` + port berbeda (API 3201, web 5280, realtime 3203) |
| `BETTER_AUTH_URL` | https://botara.my.id | `https://<domain>` |
| `R2_BUCKET` | (default staging) | **`sahabat-kreator-prod` — WAJIB eksplisit** (default kode memang bucket staging; bucket prod sudah dibuat user 2026-11-01) |
| `LLM_PROVIDER` | mock/openrouter mengikuti panel | `openrouter` |
| Tunnel | tunnel staging | tunnel produksi tersendiri (§1) |
| Backup | rehearsal terbukti (Fase 14C, §7) | cron harian aktif (§7) — dipasang operator saat go-live |
| `.env.staging` di host produksi | — | TIDAK ikut disalin; rsync deploy selalu `--exclude '.env.*'` selain env target (aturan insiden 14A meluas: kecualikan SEMUA berkas env server dari rsync) |

## 5. Bootstrap: migrasi + admin pertama + Panel Admin

1. Buat container pg + dua role + database produksi (pola
   DEPLOY-STAGING.md Fase 1B; kata sandi digenerate acak di server,
   ditulis langsung ke `.env.production`).
2. Migrasi dari checkout repo di server/VM:
   `DATABASE_URL=$MIGRATION_


...[truncated 3119 chars]DATABASE_URL pnpm db:migrate`
   (drizzle membaca `DATABASE_URL`; JANGAN memakai URL aplikasi —
   terlihat jalan tetapi tidak menerapkan DDL).
3. Nyalakan service (unit pola §4, `EnvironmentFile=.env.production`).
4. Admin pertama: pastikan email pemilik ada di
   `PLATFORM_ADMIN_EMAILS`, lalu **daftar lewat `/register`** dengan
   email itu — `syncAppUser` menautkan akun dan flag admin platform
   aktif otomatis (pola yang terbukti saat remedy insiden 13G). Buat
   workspace pertama.
5. Isi Panel Admin (`/admin`), urutan menyalakan fitur:

   | Kunci panel | Menyalakan |
   |---|---|
   | `openrouter_api_key` (+ model) | AI agent & embedding KB sungguhan |
   | `meta_app_secret` + `meta_app_id` / `meta_ig_config_id` / `meta_wa_config_id` | OAuth & webhook Meta |
   | `resend_api_key` + `resend_from_email` / `resend_from_name` | Email undangan & reset kata sandi (sesudah §6.3) |
   | `google_oauth_client_id` / `google_oauth_client_secret` | Sinkron Google Calendar (sesudah §6.2) |
   | `r2_access_key_id` / `r2_secret_access_key` | Media & berkas KB di bucket prod |

6. Uji asap go-live: register user uji → buat workspace → hubungkan
   satu channel tiap provider → kirim webhook uji → satu pembayaran
   sandbox end-to-end → satu reset kata sandi (email harus tiba).

## 6. Dependensi eksternal go-live

### 6.1 Meta App Review — Advanced Access `[USER]`

Selama aplikasi Meta ("Botara Dev") belum lolos App Review, HANYA
pengguna yang punya peran di aplikasi (admin/dev/tester) yang bisa
menghubungkan aset — **pelanggan sungguhan tidak bisa**. Karena itu App
Review adalah gerbang keras sebelum pelanggan eksternal pertama:
paket lengkapnya di docs/APP-REVIEW.md §0 (urutan: verifikasi bisnis
SHD Store → pra-terbang konsol → screencast → submit; klik submit
tetap milik user). Domain produksi mengubah URL yang didaftarkan
(§3) — ajukan review DENGAN domain produksi sejak awal agar tidak
mengajukan dua kali.

### 6.2 Verifikasi aplikasi Google (scope sensitif) `[USER]`

Scope Calendar yang kita pakai (`calendar.events`,
`calendar.readonly`) adalah **scope sensitif** Google. Tanpa
verifikasi OAuth app: layar consent menampilkan peringatan
"unverified app" dan aplikasi dibatasi 100 pengguna seumur hidup.
Produksi untuk tenant sungguhan MEMBUTUHKAN verifikasi Google Cloud:
siapkan URL Privacy Policy produksi (§3), video demo alur OAuth, dan
justifikasi scope; prosesnya hari–minggu dan berjalan paralel dengan
6.1. Redirect URI produksi (§3) didaftarkan di client yang sama —
client staging tidak perlu diganti, URI bisa lebih dari satu.

### 6.3 Domain pengirim Resend `[USER]`

Email produksi tidak boleh bertumpu pada domain uji: verifikasi
domain pengirim milik platform di Resend (record DKIM/SPF ke DNS
Cloudflare), lalu set `resend_from_email` di Panel Admin. Tanpa ini
email reset kata sandi & undangan tidak terkirim (status tercatat
jujur `not_configured`/`failed`; tidak ada jalan pintas).

### 6.4 Aktivasi merchant production `[USER, per tenant]`

Midtrans/Xendit production per tenant aktif sesudah tenant itu sendiri
menyelesaikan pendaftaran & aktivasi merchant-nya; platform hanya
menyediakan tempat kunci production di Settings → Payments (Fase 14A).
Tidak ada langkah platform di sini selain dokumentasi untuk tenant.

## 7. Backup & restore

- Skrip ter-commit: `scripts/backup-db.sh` — pg_dump terkompresi +
  manifest (sha256, jumlah tabel/policy) ke `/home/ubuntu/backups`,
  retensi 14 dump terakhir per DB (env `SK_*` untuk override; default
  berbentuk staging).
- Jadwal yang DIREKOMENDASIKAN (belum dipasang di server mana pun;
  pemasangan adalah langkah operator saat go-live): cron harian
  03.30 waktu server untuk DB produksi + salinan manifest diperiksa
  mingguan. Contoh baris ada di kepala skrip.
- Aset non-DB: objek R2 hidup sisi provider (DB hanya menyimpan
  kuncinya); berkas env TIDAK ikut dicadangkan ke repo/folder backup
  (lihat SECRETS-RUNBOOK.md) — yang dijaga adalah template namanya +
  akses ke konsol pemilik tiap rahasia.
- Prosedur restore: buat DB kosong **milik role migrasi** → restore
  sebagai role migrasi (`gunzip -c <file>.sql.gz | docker exec -i
  sahabat-kreator-pg psql -U sk_migration -d sahabat_kreator_prod_baru`;
  role migrasi wajib karena pembuatan ekstensi di dump memerlukan
  superuser container — rehearsal membuktikan restore sebagai role
  pemilik biasa gagal tepat di titik ini) → berikan ulang grant role
  aplikasi dengan **satu perintah** (dump dibuat `--no-privileges`
  sehingga grant tidak ikut terbawa):
  `MIGRATION_DATABASE_URL=… pnpm --filter @sahabat-kreator/db db:grant`
  → arahkan `DATABASE_URL` aplikasi ke DB itu → restart service →
  pastikan `pnpm db:doctor` hijau.
- **Grant role aplikasi bukan lagi langkah manual yang harus diingat.**
  `migrations/0009_app_role_grants.sql` memberi grant + `ALTER DEFAULT
  PRIVILEGES` sebagai bagian rantai migrasi, sehingga `db:migrate`
  (termasuk setelah skema direset) selalu menghasilkan DB yang bisa
  dipakai. Nama role dapat diganti lewat `SET sk.app_role` atau env
  `APP_DB_ROLE` tanpa menyunting migrasi. `db:grant` tetap disediakan
  untuk kasus restore-dari-dump di atas.
- **Gerbang wajib pasca-restore & pasca-reset: `pnpm db:doctor`**
  (baca-saja, exit ≠ 0 bila ada masalah). Ia memeriksa jumlah migrasi
  vs berkas di disk, jumlah tabel/policy/tabel ber-RLS, apakah role
  aplikasi non-superuser & tidak bypass RLS, hak DML nyata pada tabel
  inti (`tenants`, `contacts`, `messages`), dan keberadaan default
  privileges. Inilah yang menangkap keadaan "DB hidup tetapi setiap
  query gagal permission denied" sebelum pengguna menemukannya —
  kegagalan yang dulu terjadi karena grant hanya hidup sebagai prosa
  di dokumen ini.
- **Reset total (menghapus SELURUH data):**
  `MIGRATION_DATABASE_URL=… pnpm --filter @sahabat-kreator/db db:reset
  -- --yes` — menjatuhkan skema `public` + `drizzle`, menjalankan
  seluruh migrasi, memberi grant, lalu menjalankan `doctor`. Tanpa
  `--yes` perintah menolak (exit 2). Database, role, dan container
  tidak disentuh.
- Bukti rehearsal Fase 14C (DB buangan `sk_chain14c` → `sk_restore14c`):
  sha256 manifest cocok dengan berkas; sesudah restore, hitungan tabel
  (59), policy (73), dan baris per tabel cocok persis dengan sumber.

## 8. Rate limit — pembagian wewenang

Terbukti di rantai Fase 14C terhadap instance terisolasi (per IP asli
lewat `cf-connecting-ip`):

| Jalur | Aplikasi (Better Auth, aktif sekarang) | Edge (§2) |
|---|---|---|
| POST sign-in | 20 req / 60 dtk per IP → 429 pada ke-21 (terbukti) | E1 menyamai |
| POST sign-up | 10 req / 60 dtk per IP → 429 pada ke-11 (terbukti) | E2 menyamai |
| Jalur auth sensitif lain (change-password dll.) | rule khusus library 3 req / 10 dtk | — |
| Semua jalur auth (global) | 100 req / 10 dtk per IP (default library, eksplisit di konfigurasi) | — |
| request/reset password | tanpa rule khusus (ikut global) | E3 = kontrol utama |
| Endpoint publik (`/pay`, `/go`, webchat, webhook) | **tidak ada limit aplikasi** (terbukti: 30× GET `/api/pay/<code>` → 30× 200, 0× 429) | E4–E7 |

Penyimpanan penghitung aplikasi = in-memory satu proses API (reset
saat API restart) — cukup untuk topologi satu proses; multi-proses
membutuhkan storage bersama (catatan di `apps/api/src/auth.ts`).

## 9. Checklist pra-luncur

**Hanya user yang bisa:**

- [ ] Domain produksi + Cloudflare menaunginya; tunnel dibuat (§1)
- [ ] Ruleset edge §2 diterapkan di dashboard CF
- [ ] Verifikasi bisnis Meta + App Review diajukan & lolos (§6.1)
- [ ] Verifikasi aplikasi Google untuk scope sensitif (§6.2)
- [ ] Domain pengirim Resend terverifikasi (§6.3)
- [ ] Nilai `.env.production` diisi di server (rahasia tidak lewat chat)
- [ ] Keputusan host produksi (server baru / berbagi) & pemasangan cron backup

**Agent bisa (sesudah domain diberikan):**

- [ ] Provisioning server produksi meniru topologi staging (§4)
- [ ] Migrasi DB produksi + bootstrap admin pertama (§5)
- [ ] Deploy build produksi + verifikasi asap §5.6 terhadap domain asli
- [ ] Pemeriksaan kesehatan berkala & rehearsal restore berkala (§7)

**Sesudah luncur (pemantauan):**

- [ ] Log `password_reset_email status=failed/not_configured` terpantau
      (= email platform bermasalah, bukan bug pengguna)
- [ ] Audit mingguan: integration_log rejected_signature pembayaran,
      antrean outbox, dan manifest backup terakhir
