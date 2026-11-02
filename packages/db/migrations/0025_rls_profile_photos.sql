-- Row Level Security Fase 6D: tabel profile_photos memakai pola
-- `tenant_isolation` yang sama persis dengan migrasi 0001/0005/0014
-- (app.tenant_id transaction-local). Foto profil adalah data tenant:
-- tanpa konteks tenant, role aplikasi tidak melihat satu baris pun;
-- endpoint penyaji avatar selalu berjalan dalam konteks tenant hasil
-- resolusi membership, jadi tidak ada lengan sempit yang dibutuhkan.
ALTER TABLE "profile_photos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "profile_photos"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
