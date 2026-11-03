# Runbook Rahasia — Inventaris & Rotasi (Fase 14C)

Inventaris seluruh rahasia yang dipegang sistem Sahabat Kreator: tempat
menyimpan, pemilik, prosedur rotasi, radius ledak, dan apa yang rusak di
tengah rotasi. Nilai rahasia TIDAK PERNAH ditulis di dokumen ini (atau
di repo mana pun) — yang dicatat hanya nama, lokasi, dan prosedur.

Prinsip yang sudah berjalan sejak awal dan tetap berlaku:

- Rahasia server hanya hidup di berkas env server (`.env.staging` /
  `.env.production`, chmod 600, tidak masuk repo) dan di Panel Admin
  (tabel `platform_settings`, terenkripsi AES-256-GCM di bawah
  `PLATFORM_SETTINGS_SECRET`).
- Rahasia tenant terenkripsi per baris di DB di bawah
  `CHANNEL_TOKEN_SECRET` (envelope `v1:` AES-256-GCM yang sama).
- Resolusi kunci provider platform: Panel Admin → env → tidak ada.
- Tidak ada rahasia yang dikirim lewat chat; pengisian selalu lewat
  Panel Admin / konsol pemilik / berkas server langsung.

## 1. Kunci induk & rahasia env server (pemilik: platform/kita)

| Rahasia | Disimpan di | Rotasi | Radius ledak | Rusak di tengah rotasi |
|---|---|---|---|---|
| `CHANNEL_TOKEN_SECRET` | env server | **JANGAN dirotasi tanpa re-enkripsi** — lihat §2 | SELURUH kredensial tenant (token channel, kunci pembayaran, token Google, ciphertext token undangan yang sedang terbang) | Semua channel putus, konfigurasi pembayaran & Google tenant tak terbaca |
| `PLATFORM_SETTINGS_SECRET` | env server | **JANGAN dirotasi tanpa re-enkripsi** — lihat §2 | Seluruh nilai Panel Admin (kunci OpenRouter/R2/Meta/Resend/Google) | Panel terbaca kosong; fitur provider jatuh ke fallback env / tidak-terkonfigurasi |
| `BETTER_AUTH_SECRET` | env server | Ganti nilai env → restart API | Semua sesi login semua pengguna | Semua pengguna keluar & harus login ulang; kata sandi & data tidak terpengaruh. Tidak ada jendela ganda-secret di library — rotasi = logout massal sesaat, jadwalkan |
| `WEBCHAT_SECRET` | env server | Ganti nilai env → restart API | Semua token sesi pengunjung webchat yang masih hidup | Pengunjung yang sedang membuka widget kehilangan tokennya dan mulai sesi/percakapan baru; percakapan lama tetap utuh di dashboard |
| `DATABASE_URL` (kata sandi role aplikasi `sk_app`) | env server + Postgres | `ALTER ROLE sk_app PASSWORD '…'` di container → perbarui env → restart api/worker/realtime | Koneksi DB aplikasi | Layanan 503/DB-error sejak kata sandi DB diganti sampai env diperbarui & service di-restart — lakukan dalam satu jendela, urutan: env dulu tidak bisa (env baru belum berlaku di DB), jadi: ganti DB → segera perbarui env → restart |
| `MIGRATION_DATABASE_URL` (kata sandi role `sk_migration`) | env server + Postgres | Sama seperti di atas (role migrasi) | Kemampuan migrate & backup | Migrasi/backup gagal sampai env diperbarui; runtime aplikasi tidak terpengaruh |
| `META_WEBHOOK_VERIFY_TOKEN` | env server + konsol Meta | Nilai bebas pilihan kita: ganti env → restart API → tempel nilai yang sama di konsol Meta (Webhook → Verify Token) | Handshake (re)subscribe webhook Meta | POST webhook yang sudah berjalan TIDAK terpengaruh (verifikasi token hanya untuk handshake GET); hanya subscribe ulang yang gagal sampai kedua sisi sama |
| Kunci SSH deploy repo (`~/.ssh/id_ed25519_sahabat_kreator_repo`, di VM Muse) | VM + GitHub deploy keys | Generate pasangan baru → daftarkan public key sebagai deploy key repo → uji push → cabut yang lama di GitHub | Push/deploy dari VM | Push gagal selama jendela pergantian; tidak memengaruhi server & pengguna |
| Kunci SSH server (`~/.ssh/id_ed25519_botara_vps`) | VM + `authorized_keys` server | Generate baru → tambahkan ke authorized_keys → uji login → hapus baris lama | Akses SSH/rsync deploy | Akses deploy saja; aplikasi tidak terpengaruh |
| Token Cloudflare Tunnel | Server (tunnel remotely-managed) + konsol Cloudflare | Konsol Zero Trust → Networks → Tunnels → connector: regenerate token → pasang ulang cloudflared di server | Ingress publik domain | Domain tidak terjangkau sampai connector menyambung ulang dengan token baru |
| Kata sandi sudo `ubuntu` | Milik user (tidak disimpan kita) | User mengganti di server (`passwd` / panel provider VPS) | Akses sudo operator | — |

`PLATFORM_ADMIN_EMAILS` bukan rahasia (allowlist), tetapi
keamanan-kritis: mengubahnya mengubah siapa yang menjadi admin
platform; perlakukan perubahannya seperti rotasi rahasia (env + restart
API, verifikasi `/api/admin/*` menjawab 404 untuk non-admin).

Identifier PUBLIK (bukan rahasia — boleh tampil, tetap dicatat agar
tidak tertukar dengan rahasia): Meta App ID, config ID FLB IG/WA,
Google OAuth Client ID, Resend from email/name, R2 account ID & nama
bucket, site key webchat per tenant, kode tautan bayar `/pay/<code>`.

## 2. Dua kunci induk — prosedur re-enkripsi (belum ada alatnya)

`CHANNEL_TOKEN_SECRET` dan `PLATFORM_SETTINGS_SECRET` mengenkripsi
data yang SUDAH tersimpan. Mengganti nilainya begitu saja membuat
seluruh ciphertext yatim. Prosedur rotasi yang benar (pekerjaan
terjadwal, bukan insiden):

1. Tulis skrip re-enkripsi satu kali pakai: baca setiap ciphertext
   dengan secret LAMA, tulis ulang dengan secret BARU (cakupan:
   `platform_settings.value` untuk kunci panel; kolom kredensial
   `channel_accounts`, `payment_provider_configs`,
   `google_calendar_connections`, dan payload outbox undangan yang
   belum terkirim untuk kunci channel).
2. Jalankan skrip dalam jendela pemeliharaan (API/worker berhenti —
   ciphertext yang ditulis di tengah jalan adalah risiko balapan).
3. Ganti nilai env → restart semua service → verifikasi: panel terbaca,
   satu channel tiap provider terhubung, satu uji-koneksi pembayaran.
4. Hancurkan salinan secret lama sesudah masa observasi singkat.

Status Fase 14C: skrip ini BELUM ditulis (tidak ada kebutuhan rotasi
saat ini); dokumen ini adalah spesifikasinya. Rotasi kunci induk
bukanlah respons insiden yang bisa dilakukan terburu-buru.

## 3. Kunci provider platform (Panel Admin; pemilik: user di konsol provider)

Pola rotasi sama untuk semuanya: **buat kunci baru di konsol provider →
tempel di Panel Admin → verifikasi fitur → cabut kunci lama di konsol**.
Urutan ini membuat jendela putus nol (resolver membaca panel per
resolusi dan cache ter-invalidasi saat set/clear). Jangan pernah
mencabut yang lama sebelum yang baru terbukti jalan.

| Kunci panel | Konsol pemilik | Yang rusak bila salah urutan |
|---|---|---|
| `openrouter_api_key` | OpenRouter | Balasan AI agent & embedding KB berhenti (provider error tercatat; pesan tidak hilang) |
| `meta_app_secret` | Meta (App Dashboard → Pengaturan → Dasar) | Verifikasi tanda tangan webhook Meta gagal fail-closed (webhook ditolak), pertukaran token OAuth gagal; channel yang sudah terhubung berhenti menerima event sampai panel diperbarui |
| `resend_api_key` | Resend | Email undangan & reset kata sandi gagal (status tercatat jujur `failed`/`not_configured`, tidak pernah pura-pura terkirim) |
| `r2_access_key_id` / `r2_secret_access_key` | Cloudflare R2 (API Tokens) | Unggah/unduh media & berkas KB gagal |
| `google_oauth_client_secret` | Google Cloud Console | Connect Google baru & refresh token Calendar gagal; booking tetap jalan (sinkron tercatat error per booking, tidak menggagalkan booking) |

## 4. Rahasia milik tenant (terenkripsi di DB; pemilik: tenant)

Platform tidak bisa merotasi ini atas nama tenant — jalurnya adalah
tenant sendiri mengulang kredensialnya:

| Rahasia tenant | Tersimpan di | Rotasi oleh tenant | Radius |
|---|---|---|---|
| Token bot Telegram | `channel_accounts` (terenkripsi) | BotFather `/revoke` → tempel token baru di Channels | Satu channel Telegram tenant itu |
| Token Meta (user/page/system-user) | `channel_accounts` (terenkripsi) | Reconnect OAuth / tempel token baru | Satu channel Meta tenant itu |
| Kunci Midtrans (server/client, sandbox + production) & Xendit (secret + verification token) | `payment_provider_configs` (terenkripsi) | Dashboard provider → Settings → Payments | Checkout & webhook tenant itu; webhook dengan kunci lama ditolak tanda tangannya sampai diperbarui |
| Token OAuth Google (access + refresh) | `google_calendar_connections` (terenkripsi) | Putuskan & hubungkan ulang Google di Appointments | Sinkron kalender tenant itu |
| API key publik `sk_live_…` | `api_keys` — hanya HASH SHA-256 + prefix tampil yang disimpan | Settings → API keys: buat baru → pindahkan pemakaian → cabut lama (soft revoke) | Integrasi pemakai kunci itu saja. **Prosedur ini dibuktikan end-to-end pada Fase 14C** terhadap tenant buangan (kunci lama 401 sesudah dicabut, kunci pengganti 200) |

## 5. Yang dilakukan / tidak dilakukan Fase 14C

- TIDAK ada rahasia live yang dirotasi fase ini: setiap kandidat
  membut
...[truncated 1015 chars]uhkan konsol user (Meta/Resend/Google/Cloudflare/OpenRouter), akan
  mengunci seseorang (BETTER_AUTH_SECRET, kunci induk), atau keduanya.
- Yang dibuktikan: prosedur rotasi API key tenant pada tenant buangan
  (§4), dan seluruh prosedur di atas siap dieksekusi per jendela
  perubahannya masing-masing.
