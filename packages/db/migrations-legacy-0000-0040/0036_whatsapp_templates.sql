-- Template WhatsApp + Broadcast WA (Fase 10A).
--
-- Bagian 1 (gaya drizzle-kit dari skema):
-- 1. Tabel `whatsapp_templates` — CERMIN lokal template pesan resmi
--    Meta per akun WhatsApp. Baris lahir dari sinkronisasi
--    `GET /{waba-id}/message_templates` atau dari pembuatan lewat
--    dashboard yang diteruskan ke Meta. Sumber kebenaran status
--    (APPROVED/PENDING/REJECTED) tetap Meta; cermin ini yang dibaca
--    formulir broadcast & gerbang core tanpa memanggil Graph setiap
--    kali. Unik (channel_account_id, name, language) meniru kunci
--    alami template di Meta.
-- 2. `broadcasts.whatsapp_template_id` (FK SET NULL) +
--    `broadcasts.template_variable_sources` (jsonb, array sumber nilai
--    per posisi variabel BODY) — broadcast WhatsApp WAJIB memakai
--    template APPROVED; ditegakkan core saat buat/jadwalkan/dispatch,
--    BUKAN di skema, agar provider lain tidak ikut terbebani.
-- 3. `messages.template_payload` (jsonb, nullable) — muatan template
--    per pesan keluar ({name, languageCode, bodyParams[]}): poller
--    Meta memutuskan kirim `type:"template"` dari kolom ini, dan
--    `content_text` baris yang sama menampung render pratinjau BODY
--    berparameter untuk dibaca di inbox.
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"meta_template_id" varchar(255),
	"name" varchar(512) NOT NULL,
	"language" varchar(32) NOT NULL,
	"category" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"components" jsonb DEFAULT '[]' NOT NULL,
	"body_text" text,
	"variable_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "whatsapp_template_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "template_variable_sources" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "template_payload" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_whatsapp_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("whatsapp_template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_account_name_language_unique" ON "whatsapp_templates" USING btree ("channel_account_id","name","language");--> statement-breakpoint
CREATE INDEX "whatsapp_templates_tenant_id_idx" ON "whatsapp_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "whatsapp_templates_channel_account_id_idx" ON "whatsapp_templates" USING btree ("channel_account_id");--> statement-breakpoint
-- Bagian 2 (tulis tangan) — RLS.
-- `whatsapp_templates` hanya diakses dalam konteks tenant biasa
-- (`app.tenant_id`): route API template (daftar/sinkron/buat/hapus),
-- gerbang broadcast di core (buat/jadwalkan/dispatch worker — dispatch
-- memang membawa tenantId job-nya), jadi cukup policy
-- `tenant_isolation` standar; tidak ada lengan sistem. Poller TIDAK
-- membaca tabel ini (muatan template hidup di `messages.template_payload`).
-- Tanpa konteks: 0 baris terbaca, semua tulis ditolak.
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_templates"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
