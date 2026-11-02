-- Saved Replies / macro balasan tersimpan (Fase 9A).
--
-- Tabel `saved_replies`: templat balasan milik workspace untuk pemilih
-- `/` di composer Inbox. Body boleh memuat {name} — diganti KLIEN saat
-- penyisipan (WYSIWYG), bukan oleh pipeline render otomatis core,
-- karena balasan manual dashboard adalah teks harfiah.
--
-- Kepemilikan edit/hapus (pembuat ATAU owner/admin workspace)
-- ditegakkan di core dari `created_by_user_id`; membaca & membuat
-- boleh semua member workspace.
CREATE TABLE "saved_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_replies_tenant_id_idx" ON "saved_replies" USING btree ("tenant_id");--> statement-breakpoint
-- RLS: policy `tenant_isolation` standar — API dashboard selalu
-- berjalan dalam konteks tenant aktif; tanpa konteks: 0 baris.
ALTER TABLE "saved_replies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_replies"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
