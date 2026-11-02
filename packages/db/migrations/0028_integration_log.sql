-- Log integrasi webhook & pengiriman (Fase 7B.1).
--
-- Bagian 1 (gaya drizzle-kit dari skema): enum arah + tabel
-- `integration_log` — APPEND-ONLY, satu baris per hit webhook (in) atau
-- per percobaan kirim keluar poller (out). Berbeda dari `webhook_inbox`
-- (Fase 1A) yang tetap menjadi lapisan DEDUP provider: tabel ini adalah
-- lapisan OBSERVABILITAS-nya — outcome jujur per titik keluar, validitas
-- tanda tangan sebagai boolean (nilai secret tidak pernah disimpan),
-- payload dibatasi ±32KB oleh penulis di core, retensi 30 hari (worker).
--
-- `tenant_id` NULLABLE: hit yang tidak ter-resolve ke tenant mana pun
-- (akun tak dikenal, tanda tangan buruk pra-resolusi, handshake) tetap
-- tercatat sebagai baris platform. FK akun channel & pesan memakai
-- ON DELETE SET NULL: purge channel/pesan (Fase 6I) tidak menghapus
-- sejarah log — tautannya saja yang lepas, ringkasannya tetap.
CREATE TYPE "public"."integration_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "integration_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" "integration_direction" NOT NULL,
	"provider" varchar(32) NOT NULL,
	"tenant_id" uuid,
	"channel_account_id" uuid,
	"message_id" uuid,
	"signature_valid" boolean,
	"outcome" varchar(32) NOT NULL,
	"error_code" varchar(128),
	"summary" varchar(255),
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_log" ADD CONSTRAINT "integration_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_log" ADD CONSTRAINT "integration_log_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_log" ADD CONSTRAINT "integration_log_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_log_tenant_created_idx" ON "integration_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_log_created_at_idx" ON "integration_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_log_channel_account_idx" ON "integration_log" USING btree ("channel_account_id");--> statement-breakpoint
-- Bagian 2 (tulis tangan) — RLS berlapis untuk log integrasi.
-- Menulis dan membaca log terjadi dari konteks yang sangat berbeda:
-- 1. Pembaca tenant (API daftar/detail log): konteks tenant biasa —
--    policy `tenant_isolation` standar membuka HANYA baris tenant itu.
-- 2. Penulis (route webhook & poller di proses API, prune di worker):
--    hit webhook tiba TANPA konteks tenant (bahkan sering tanpa tenant
--    sama sekali), dan poller bekerja lintas tenant. Semua penulisan
--    lewat satu helper core yang men-set flag transaction-local
--    `app.integration_log = 'ingest'`; policy `integration_log_ingest`
--    (FOR INSERT saja) hanya membuka penulisan di bawah flag itu —
--    pola lengan sistem yang sama seperti system_relay (0008) &
--    platform_settings (0022). Role aplikasi tetap non-superuser.
-- 3. Baris platform (tenant_id NULL): hanya terlihat dalam transaksi
--    ber-flag `app.platform_settings = 'admin'` (pola `platform_audit`
--    0022) lewat policy `platform_integration_log` — sesi platform
--    admin yang sudah lolos gerbang allowlist di lapisan API.
-- 4. Prune retensi worker: policy `integration_log_prune` adalah FOR ALL
--    di bawah flag `app.integration_log = 'prune'`. FOR ALL disengaja:
--    DELETE dengan WHERE/RETURNING di Postgres juga mensyaratkan baris
--    lolos policy SELECT, jadi policy FOR DELETE murni tidak akan pernah
--    melihat baris tenant mana pun (konteks tenant tak terpasang saat
--    prune lintas tenant berjalan). Di bawah flag yang sama baris juga
--    terbaca/tertulis — konteksnya proses worker tepercaya yang sama.
-- Tanpa flag/konteks apa pun: SELECT 0 baris, INSERT/DELETE ditolak.
ALTER TABLE "integration_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "integration_log"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "integration_log_ingest" ON "integration_log"
  FOR INSERT
  WITH CHECK (current_setting('app.integration_log', true) = 'ingest');
--> statement-breakpoint
CREATE POLICY "platform_integration_log" ON "integration_log"
  FOR SELECT
  USING ("tenant_id" IS NULL AND current_setting('app.platform_settings', true) = 'admin');
--> statement-breakpoint
CREATE POLICY "integration_log_prune" ON "integration_log"
  USING (current_setting('app.integration_log', true) = 'prune')
  WITH CHECK (current_setting('app.integration_log', true) = 'prune');
