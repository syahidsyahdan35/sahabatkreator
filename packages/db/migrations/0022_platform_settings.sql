-- Panel Admin Platform (Fase 6C): tabel platform_settings + audit platform.
--
-- Bagian 1 (dibangkitkan drizzle-kit dari skema): tabel `platform_settings`
-- (nilai provider terenkripsi AES-256-GCM; kunci induk hanya di env server)
-- dan pelonggaran `audit_logs.tenant_id` menjadi NULLABLE agar aksi tingkat
-- platform (tanpa tenant) bisa tercatat di rumah audit yang sama.
CREATE TABLE "platform_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value_encrypted" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Bagian 2 (tulis tangan) — RLS fail-closed untuk data platform.
-- platform_settings BUKAN tenant-scoped: tidak ada policy tenant sama
-- sekali. Satu-satunya policy membuka SEMUA operasi hanya bila transaksi
-- men-set flag transaction-local `app.platform_settings = 'admin'` (pola
-- system_relay migrasi 0008). Flag itu hanya di-set helper core
-- (@sahabat-kreator/core platform-settings) di dalam handler yang sudah
-- lolos gerbang platform-admin di lapisan API (allowlist env
-- PLATFORM_ADMIN_EMAILS). Tanpa flag: SELECT mengembalikan 0 baris dan
-- tulis ditolak — role aplikasi non-superuser tidak punya jalan pintas.
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "platform_settings_admin" ON "platform_settings"
  USING (current_setting('app.platform_settings', true) = 'admin')
  WITH CHECK (current_setting('app.platform_settings', true) = 'admin');
--> statement-breakpoint
-- Audit tingkat platform: baris audit_logs dengan tenant_id NULL hanya
-- terlihat/tertulis dalam transaksi ber-flag yang sama. Policy ini
-- permissive (di-OR-kan dengan tenant_isolation yang sudah ada): baris
-- bertenant tetap tunduk penuh pada tenant_isolation seperti sebelumnya,
-- dan konteks tenant mana pun TIDAK pernah melihat baris platform karena
-- mereka tidak men-set flag ini.
CREATE POLICY "platform_audit" ON "audit_logs"
  USING ("tenant_id" IS NULL AND current_setting('app.platform_settings', true) = 'admin')
  WITH CHECK ("tenant_id" IS NULL AND current_setting('app.platform_settings', true) = 'admin');
