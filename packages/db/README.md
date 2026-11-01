# @sahabat-kreator/db

Drizzle schema, migrasi, dan client PostgreSQL untuk Sahabat Kreator.
Status: **Fase 1A terimplementasi** — kelompok Identity & Tenant + Sistem fondasi (RANCANGAN §6). Kelompok Channels / Audience / Automation / Agent / Campaign menyusul di fase berikutnya (termasuk pgvector untuk `knowledge_chunks`).

## Isi

- `src/schema/identity.ts` — tabel global: `users` (email unik, locale default `en`, theme `system|light|dark`), `plans` (code unik, limits jsonb).
- `src/schema/tenants.ts` — `tenants` (slug unik, default_locale, timezone default `Asia/Jakarta`), `tenant_members` (role enum `owner|admin|agent|viewer`, unik tenant+user), `invitations` (token hash, expires_at, accepted_at), `api_keys` (key hash, scopes text[], last_used_at, revoked_at), `subscriptions` (plan, status enum, current_period_end).
- `src/schema/system.ts` — `webhook_inbox` (unik provider + provider_event_id untuk dedup), `outbox_events` (Transactional Outbox, index published_at), `audit_logs` (actor user/agent/system), `usage_ledger` (**append-only** — tanpa `updated_at`; qty + cost_model + cost_provider).
- `src/client.ts` — `createDb(connectionString)` → `{ db, pool }` (drizzle + node-postgres).
- `migrations/` — SQL ter-generate drizzle-kit (`0000`) + migrasi custom RLS (`0001`). **Jangan edit file migrasi yang sudah ter-commit; buat migrasi baru.**

Semua tabel tenant-scoped punya `tenant_id` + index; semua PK `uuid defaultRandom`; timestamps konsisten (`timestamptz`, default now).

## Cara migrasi

```bash
# dari root monorepo
export DATABASE_URL="postgres://<user>:<pass>@<host>:5432/sahabat_kreator"   # jangan commit nilai asli
pnpm --filter @sahabat-kreator/db db:migrate     # terapkan migrasi ke DB target
pnpm --filter @sahabat-kreator/db db:generate    # setelah mengubah skema: generate migrasi baru
pnpm --filter @sahabat-kreator/db verify         # bukti jalan lokal (PGlite, tanpa server)
```

## Pola Row Level Security (RLS)

Migrasi `0001_rls_tenant_isolation.sql` mengaktifkan RLS pada 8 tabel tenant-scoped (`tenant_members`, `invitations`, `api_keys`, `subscriptions`, `webhook_inbox`, `outbox_events`, `audit_logs`, `usage_ledger`) dengan policy `tenant_isolation`:

```sql
tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
```

untuk `USING` maupun `WITH CHECK` (select/insert/update/delete sama-sama terkunci). `users`, `plans`, dan `tenants` sendiri tidak di-RLS pada fase ini.

Konsekuensi wajib untuk kode aplikasi:

1. **API men-set `app.tenant_id` di setiap transaksi** sebelum query tenant mana pun — transaction-local via `set_config('app.tenant_id', $1, true)`. Gunakan helper `withTenant(db, tenantId, fn)` dari `@sahabat-kreator/core`; jangan query tabel tenant-scoped di luar transaksi seperti itu.
2. **Role koneksi aplikasi harus non-superuser dan bukan pemilik tabel** — superuser dan pemilik tabel melewati RLS. Role migrasi (pemilik) hanya untuk `db:migrate`; worker sistem yang memang lintas tenant memakai koneksi pemilik secara sadar & terbatas.
3. Konteks yang belum di-set menghasilkan **nol baris** (fail closed), bukan error.

## Verifikasi (scripts/verify.ts)

Karena Docker tidak tersedia di VM pengembangan, verifikasi memakai **PGlite** (Postgres asli dalam WASM) dan membuktikan:

1. Kedua file migrasi teraplikasi bersih dari nol (11 tabel).
2. Seed 2 tenant + member + usage/audit/outbox berhasil.
3. Insert duplikat ke `webhook_inbox` dengan `(provider, provider_event_id)` yang sama **ditolak** constraint unik.
4. Sebagai role non-superuser `app_user` dengan konteks `app.tenant_id = tenant A`: `tenant_members`, `usage_ledger`, dan `audit_logs` hanya mengembalikan baris tenant A, dan insert untuk tenant B ditolak policy (`WITH CHECK`).

Jalur yang sama akan dipakai terhadap Postgres sungguhan (docker-compose / staging) pada fase deploy DB tanpa perubahan skrip berarti — cukup ganti transport-nya.
