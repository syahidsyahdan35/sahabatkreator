# Baseline Migrasi DB — Fase 11A.1 (2026-11-03)

Perbaikan perkakas migrasi yang tercatat sebagai utang di
`docs/DB-NORMALIZATION-11A.md`: rantai snapshot drizzle-kit berhenti di
0026 sehingga `drizzle-kit generate` tidak bisa dipakai sejak migrasi
kustom tulis-tangan 0027. Fase ini melakukan **squash**: seluruh rantai
0000–0040 digantikan **satu baseline 0000** yang dihasilkan perkakas
sendiri, dan `generate` berfungsi normal lagi. Momennya tepat: staging
baru direset (11A) dan masih kosong, jadi penukaran lineage tidak
menyentuh data apa pun.

## Akar masalah (rekam jejak)

- `drizzle-kit generate` membandingkan definisi skema Drizzle saat ini
  dengan **snapshot terakhir** di `migrations/meta/`. Snapshot terakhir
  adalah keadaan 0026; migrasi 0027–0040 ditulis tangan (SQL + entri
  jurnal manual) **tanpa snapshot pendamping**. Akibatnya generate
  mengusulkan pembuatan ulang semua perubahan 0027+.
- Jalur `drizzle-kit migrate` (berbasis jurnal) selalu sehat — yang
  rusak hanya kemampuan *menghasilkan* migrasi baru.

## Cara baseline dibangun

1. `drizzle-kit generate` dijalankan dengan folder keluaran KOSONG
   (`migrations-baseline/` sementara) dari definisi skema saat ini
   (`packages/db/src/schema`) → satu file `0000_baseline.sql` +
   `0000_snapshot.json` + jurnal 1 entri, semuanya hasil perkakas.
   Keluaran murni perkakas: 44 tabel, 27 enum, 110 index eksplisit,
   semua FK/check/index parsial — definisi skema ternyata sudah
   lengkap (termasuk customType `vector(1536)`/`tsvector` generated/
   `bytea`, nilai enum tambahan `'comment'` & `'api_key'`, dan 12 index
   FK dari 0040). **Tidak ada perubahan definisi skema yang diperlukan.**
2. SQL kustom yang tidak bisa diekspresikan generate **dipanen dari
   rantai lama** (melacak CREATE/DROP POLICY berurutan → keadaan final)
   dan ditempel ke file baseline sebagai bagian berkomentar [K1]–[K3]:
   - **[K1] Ekstensi**: `CREATE EXTENSION IF NOT EXISTS "vector"`
     (dari 0009) — disisipkan juga di kepala file, sebelum tabel
     `kb_chunks` yang berkolom `vector(1536)` dibuat.
   - **[K2] RLS enable**: `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
     pada **37 tabel** (dari 0001/0005/0008/0010/0012/0014/0022/0025/
     0028/0030/0031/0033/0035/0036/0037/0039). Tidak ada FORCE RLS.
   - **[K3] 57 policy final**: pola `tenant_isolation` +
     lengan sempit SELECT-only (`provider_external_lookup`,
     `telegram_webhook_lookup`, `system_delivery_scan`,
     `meta_delivery_scan`, `system_purge_scan`, `system_broadcast_scan`,
     `public_code_lookup`, `public_key_lookup`,
     `invitation_token_lookup`, `system_relay`,
     `integration_log_ingest`/`integration_log_prune`/
     `platform_integration_log`, `platform_audit`,
     `platform_settings_admin`, `member_self_visibility`,
     `webchat_site_key_lookup`, dst.). Tiga policy yang sempat diganti
     di rantai lama masuk dalam bentuk FINALNYA: `tenant_isolation`
     pada `tenant_members` (diganti 0003), `tenant_isolation` pada
     `channel_accounts` (diganti 0006), `meta_delivery_scan` pada
     4 tabel (diganti 0027 agar mencakup WhatsApp).
   - Yang **sengaja tidak** masuk baseline: dua UPDATE data historis
     (0019 & 0021 — perbaikan data grup/channel Telegram pada DB yang
     berisi data; baseline membangun skema kosong, tidak relevan) dan
     6 DROP POLICY perantara (sudah teresolusi ke bentuk final di atas).
   - Tidak ditemukan fungsi/trigger/grant istimewa di seluruh rantai.

## Bukti kesetaraan (objektif)

Dua DB buangan di container staging yang sama:

- **DB-A** dimigrasi dengan rantai LAMA (0000–0040, folder asli).
- **DB-B** dimigrasi dengan BASELINE baru.

`pg_dump --schema-only` keduanya → normalisasi (buang komentar, baris
`OWNER TO`, token `\restrict` acak pg_dump, perintah SET; statement
diurutkan) → diff:

- **427 statement ternormalisasi di kedua sisi.** Di luar CREATE TABLE,
  **semua statement identik persis** (enum, FK, index, policy, sequence,
  default).
- 10 CREATE TABLE berbeda **hanya pada urutan ordinal kolom**
  (`api_keys`, `automations`, `broadcasts`, `channel_accounts`,
  `conversations`, `invitations`, `kb_documents`, `messages`,
  `usage_ledger`, `users`): rantai lama menambahkan kolom belakangan
  lewat ALTER TABLE (menempel di akhir), baseline mengikuti urutan
  definisi skema. Perbandingan himpunan membuktikan: **himpunan kolom
  (nama+tipe+default+nullability) dan constraint identik di 44/44
  tabel** — perbedaan urutan ini semantiknya nol (semua akses aplikasi
  menyebut kolom by-name).
- Hitungan langsung di kedua DB **identik**: **44 tabel, 57 policy,
  162 index, 437 kolom, 92 FK**.

Kedua DB buangan di-drop sesudah pembuktian.

## Uji perkakas (dua arah)

- (a) Tree final, skema tidak diubah: `pnpm db:generate` →
  **"No schema changes, nothing to migrate"**, folder migrasi
  byte-identik sebelum/sesudah.
- (b) Salinan scratch skema + satu kolom dummy (`tenants.probe_baseline`):
  generate menghasilkan migrasi inkremental yang tepat —
  `ALTER TABLE "tenants" ADD COLUMN "probe_baseline" varchar(32);` —
  tanpa pembuatan ulang tabel. Salinan scratch dibuang.

## Lineage baru (keadaan akhir)

- `packages/db/migrations/` — HANYA baseline: `0000_baseline.sql` +
  `meta/0000_snapshot.json` + `meta/_journal.json` (1 entri).
- `packages/db/migrations-legacy-0000-0040/` — arsip rantai lama
  lengkap (41 SQL + snapshot + jurnal lama). **Tidak dibaca perkakas**
  (konfigurasi menunjuk `./migrations`); disimpan sebagai rekam jejak
  dan jalur rollback konseptual. Boleh dihapus di masa depan bila
  sudah tidak diperlukan.
- Konsumen generik tidak berubah perilaku: PGlite `verify.ts` dan
  skrip verify worker menerapkan semua `*.sql` di `migrations/` —
  kini satu file baseline. Rujukan nomor migrasi lama di komentar/
  pesan seksi verify [31]/[32]/[34] diselaraskan menjadi asersi
  baseline (provenance "dulu migrasi NNNN" dipertahankan di komentar).
- **Prosedur migrasi berikutnya kembali normal**: ubah definisi skema
  di `packages/db/src/schema` → `pnpm db:generate` → periksa SQL →
  commit → deploy → `drizzle-kit migrate` di server dengan
  `DATABASE_URL=$MIGRATION_DATABASE_URL`. SQL kustom baru (policy,
  ekstensi, dsb.) yang tak terwakili di definisi skema ditempel
  sebagai migrasi `--custom` tersendiri atau bagian kustom
  berkomentar di file hasil generate — jangan pernah lagi menulis
  migrasi tangan tanpa snapshot pendamping.

## Penukaran staging (penjaga perawan)

- Sebelum menyentuh staging, keadaan DB diperiksa read-only:
  `auth_user=0, tenants=0, platform_settings=0, users=0` — **masih
  perawan**, jadi penukaran dilakukan: folder migrasi server
  diselaraskan, DB di-drop & dibuat ulang (pemilik `sk_migration`,
  default privileges `sk_app` dipasang ulang), migrasi dari baseline
  lewat jalur standar.
- Pasca-tukar terverifikasi read-only: **jurnal 1 entri, 44 tabel,
  57 policy, 162 index, ekstensi `vector` aktif, total 0 baris di
  semua tabel**. Empat service di-restart (kill MainPID eksplisit),
  health publik ok, `/register` 200, dan tidak ada data uji yang
  ditulis sesudahnya. `.env.staging` byte-identik (sha256 `9c1ded2a…`).
- Bila penjaga menemukan staging sudah berisi data (user sudah daftar
  ulang), prosedurnya adalah BERHENTI dan menahan penukaran staging —
  baseline tetap berlaku untuk instalasi baru. (Tidak terjadi di fase
  ini.)

## Verifikasi fase

- PGlite `db verify`: **SEMUA LULUS (34 seksi)** pada lineage baru;
  `verify:agent-tools` worker juga SEMUA LULUS.
- Typecheck semua paket hijau; `pnpm check:drift` lulus (26 rute).
- **Smoke ringkas di DB buangan berbasis baseline** (API+worker rantai
  asli, `LLM_PROVIDER=mock`, Redis DB 9): **13 PASS / 0 FAIL** —
  register → workspace → dokumen KB → agen auto → channel webchat →
  sesi visitor → agen membalas mengutip fakta KB "349" (retrieval
  hidup) → API key bawaan → `GET /v1/me` 200, `GET /v1/broadcasts`
  200 → kunci `contacts:read`-only ditolak 403 `API_KEY_SCOPE_DENIED`.
  DB buangan di-drop, Redis rantai di-flush, proses rantai dibersihkan
  (PID eksplisit).
