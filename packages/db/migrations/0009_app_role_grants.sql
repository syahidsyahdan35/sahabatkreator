-- Hak akses role aplikasi (sk_app) — dijalankan sebagai bagian rantai migrasi.
--
-- MENGAPA MIGRASI, BUKAN PROSA DI DOKUMEN
-- Selama ini langkah "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES …
-- TO sk_app" hidup sebagai instruksi manual di docs/PRODUCTION.md §7 dan
-- catatan Fase 1B. Akibatnya: (a) reset skema menghapus seluruh hak role
-- aplikasi dan API hidup tetapi setiap query gagal "permission denied";
-- (b) dokumen menyebut ALTER DEFAULT PRIVILEGES sudah dipasang padahal
-- pg_default_acl kosong — tidak ada yang memeriksanya. Dengan grant
-- berada di rantai migrasi, keadaan DB yang benar dihasilkan oleh
-- `db:migrate` itu sendiri, dari kosong maupun sesudah reset.
--
-- ROLE TIDAK DIBUAT DI SINI. Role adalah objek tingkat cluster (bertahan
-- lintas database, dimiliki provisioning container), bukan bagian skema.
-- Bila role belum ada — mis. PGlite pada `pnpm --filter db verify`, atau
-- database pengembangan tanpa role aplikasi — migrasi ini MELEWATI grant
-- dengan catatan, bukan gagal. Itu sebabnya seluruhnya dibungkus DO.
--
-- NAMA ROLE DAPAT DIGANTI tanpa menyunting migrasi:
--   SET sk.app_role = 'sk_app_produksi';  -- sebelum menjalankan migrasi
--
-- Idempoten: GRANT berulang tidak menumpuk hak, dan ALTER DEFAULT
-- PRIVILEGES menambahkan entri yang sama tanpa efek ganda. Aman
-- dijalankan pada DB yang sudah punya data.
DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('sk.app_role', true), ''), 'sk_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'role % tidak ada — grant role aplikasi dilewati', app_role;
    RETURN;
  END IF;

  -- Skema: tanpa USAGE, seluruh grant tabel di bawahnya tidak berguna.
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);

  -- DML pada seluruh tabel yang ada sekarang. SENGAJA tanpa
  -- TRUNCATE/REFERENCES/TRIGGER: aplikasi tidak membutuhkannya, dan
  -- TRUNCATE akan melewati RLS.
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
    app_role
  );

  -- Sequence untuk kolom serial/identity.
  EXECUTE format(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
    app_role
  );

  -- Tabel & sequence yang dibuat migrasi BERIKUTNYA otomatis ter-grant.
  -- Inilah yang membuat migrasi baru tidak perlu menyebut grant lagi.
  -- Tanpa FOR ROLE, berlaku untuk role yang sedang menjalankan migrasi
  -- (sk_migration) — pemilik objek baru.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    app_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
    app_role
  );
END
$$;
