-- Row Level Security Fase 2C: tabel sequence (automation_steps &
-- sequence_enrollments) memakai pola `tenant_isolation` yang sama persis
-- dengan migrasi 0001/0005/0008/0010/0012 (app.tenant_id transaction-local).
-- Kolom baru automations.kind tidak butuh policy tambahan — tabel
-- automations sudah ter-RLS sejak 0008.

ALTER TABLE "automation_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automation_steps"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sequence_enrollments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
