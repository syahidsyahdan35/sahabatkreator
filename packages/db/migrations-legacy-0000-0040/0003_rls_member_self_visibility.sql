-- RLS tambahan Fase 1B: visibilitas keanggotaan diri sendiri.
--
-- Kebutuhan: GET /api/tenants harus mendaftar SEMUA workspace milik user
-- yang login. Dengan policy 0001 yang murni berbasis app.tenant_id, query
-- seperti itu mustahil (satu transaksi hanya punya satu konteks tenant).
--
-- Solusi: policy tenant_members diperluas satu lengan — baris juga terlihat
-- bila `user_id` baris sama dengan setting sesi `app.user_id` (di-set API
-- dari sesi login, transaction-local, hanya untuk query daftar/detail
-- keanggotaan user itu sendiri). Ini TIDAK melemahkan isolasi: user hanya
-- dapat melihat baris keanggotaan MILIKNYA, bukan milik user lain, dan
-- konteks yang tidak di-set tetap fail closed (NULL).
--
-- WITH CHECK sengaja TIDAK diberi lengan user: penulisan member tetap
-- hanya boleh dalam konteks tenant yang cocok (app.tenant_id), seperti
-- pada 0001. Pembuatan tenant baru men-set app.tenant_id = id tenant yang
-- baru dibuat di dalam transaksi yang sama (lihat packages/core tenants).
DROP POLICY "tenant_isolation" ON "tenant_members";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_members"
  USING (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
