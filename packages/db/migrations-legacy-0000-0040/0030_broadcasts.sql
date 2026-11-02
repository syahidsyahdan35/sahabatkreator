-- Broadcasts v1 (Fase 7C).
--
-- Bagian 1 (gaya drizzle-kit dari skema): enum status + tabel
-- `broadcasts` (satu kampanye siaran teks pada SATU akun channel) dan
-- `broadcast_recipients` (baris per penerima; dimaterialisasi worker
-- SAAT dispatch, sumber kebenaran statistik). Provider v1:
-- telegram/messenger/instagram. WhatsApp dikecualikan (broadcast di
-- luar jendela 24 jam wajib template resmi — manajemen template adalah
-- fase tersendiri) dan webchat dikecualikan (tidak ada semantik push
-- ke pengunjung anonim); keduanya ditegakkan di lapisan core/API, bukan
-- di skema, agar pengecualian bisa berubah tanpa migrasi.
--
-- FK `broadcast_recipients.message_id` ON DELETE SET NULL disengaja:
-- cancel broadcast yang sedang `sending` MENGHAPUS pesan `queued` yang
-- belum pernah terkirim (agar poller tidak mengirim pesan hantu),
-- sementara baris penerimanya tetap hidup sebagai `cancelled`.
-- `broadcasts.created_by_user_id` juga SET NULL (informatif saja).
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'sending', 'completed', 'partially_failed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"message_text" varchar(4096) NOT NULL,
	"audience_filter" jsonb DEFAULT '{}' NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" varchar(128),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"status" "broadcast_recipient_status" DEFAULT 'queued' NOT NULL,
	"skip_reason" varchar(64),
	"error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_tenant_id_idx" ON "broadcasts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "broadcasts_tenant_status_idx" ON "broadcasts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "broadcasts_channel_account_id_idx" ON "broadcasts" USING btree ("channel_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_broadcast_contact_unique" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_tenant_id_idx" ON "broadcast_recipients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_status_idx" ON "broadcast_recipients" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_message_id_idx" ON "broadcast_recipients" USING btree ("message_id");--> statement-breakpoint
-- Bagian 2 (tulis tangan) — RLS.
-- Konteks akses kedua tabel:
-- 1. API tenant & job dispatch worker berjalan dalam konteks tenant
--    biasa (`app.tenant_id`) — policy `tenant_isolation` standar pada
--    KEDUA tabel. Dispatch memang membawa tenantId job-nya, jadi tidak
--    butuh lengan istimewa.
-- 2. Penyapu finalisasi worker (sinkron status penerima dari pesan +
--    penutupan broadcast `sending` yang seluruh penerimanya sudah
--    terminal) harus MENEMUKAN broadcast `sending` lintas tenant dulu
--    sebelum bisa membuka konteks per tenant. Untuk itu SATU lengan
--    baca-saja pada `broadcasts`: policy `system_broadcast_scan`
--    (FOR SELECT) di bawah flag transaction-local
--    `app.system_broadcast = 'reconcile'` — pola lengan sistem yang sama
--    seperti system_relay (0008) & system_delivery_scan (6A). Lengan ini
--    TIDAK membuka tulis apa pun; sinkronisasi & finalisasi per tenant
--    tetap terjadi dalam konteks tenant pemiliknya.
-- Tanpa konteks/flag apa pun: 0 baris terbaca, semua tulis ditolak.
ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "broadcasts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "system_broadcast_scan" ON "broadcasts"
  FOR SELECT
  USING (current_setting('app.system_broadcast', true) = 'reconcile');
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "broadcast_recipients"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
