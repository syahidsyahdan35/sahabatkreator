-- Row Level Security: isolasi tenant (RANCANGAN §2 prinsip 3, §6).
--
-- Pola: setiap tabel tenant-scoped mengaktifkan RLS dengan satu policy
-- `tenant_isolation` yang membandingkan tenant_id baris dengan setting
-- sesi `app.tenant_id`. API/worker WAJIB men-set setting ini di awal
-- setiap transaksi tenant, transaction-local:
--
--     SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
--
-- (helper: `withTenant` di @sahabat-kreator/core).
--
-- `nullif(..., '')` membuat konteks yang belum di-set menghasilkan NULL
-- (bukan error cast), sehingga tidak ada baris yang terlihat — fail closed.
-- Baris dengan tenant_id NULL (outbox_events & webhook_inbox tingkat
-- sistem) juga tidak terlihat oleh role tenant.
--
-- CATATAN OPERASIONAL: RLS hanya berlaku untuk role NON-superuser yang
-- BUKAN pemilik tabel. Koneksi aplikasi harus memakai role khusus
-- aplikasi (bukan role migrasi/pemilik), dan koneksi worker sistem yang
-- memang harus lintas tenant memakai role pemilik/BYPASSRLS secara sadar.
-- Tabel global `users` & `plans`, serta `tenants` itu sendiri, TIDAK
-- di-RLS pada fase ini.

ALTER TABLE "tenant_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_members"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "api_keys"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "webhook_inbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_inbox"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "usage_ledger"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
