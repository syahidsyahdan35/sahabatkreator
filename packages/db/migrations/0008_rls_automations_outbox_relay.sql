-- Row Level Security Fase 2A: tabel automation + lengan relay outbox.
--
-- 1) automations & automation_runs memakai pola `tenant_isolation` yang sama
--    persis dengan migrasi 0001/0005 (app.tenant_id transaction-local).
--
-- 2) outbox_events mendapat policy KEDUA `system_relay`: worker relay adalah
--    komponen sistem tepercaya yang harus membaca event BELUM ter-publish
--    dari SEMUA tenant (di luar konteks tenant mana pun). Akses itu hanya
--    terbuka bila transaksi men-set `app.system_relay = 'outbox'` secara
--    transaction-local (helper relay di @sahabat-kreator/core). Policy
--    permissive di-OR-kan oleh PostgreSQL: tanpa setting itu, baris tetap
--    tunduk penuh pada `tenant_isolation`. Role aplikasi tetap non-superuser,
--    jadi tidak ada jalan pintas lain.

ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automation_runs"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "system_relay" ON "outbox_events"
  USING (current_setting('app.system_relay', true) = 'outbox')
  WITH CHECK (current_setting('app.system_relay', true) = 'outbox');
