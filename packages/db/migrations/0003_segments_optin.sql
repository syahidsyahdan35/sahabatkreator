CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_opt_in_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"opt_in_keywords" jsonb NOT NULL,
	"opt_in_confirmation_text" varchar(1000),
	"opt_out_extra_keywords" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "opt_in_source" varchar(64);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "require_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_opt_in_settings" ADD CONSTRAINT "tenant_opt_in_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_tenant_id_idx" ON "segments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_opt_in_settings_tenant_id_idx" ON "tenant_opt_in_settings" USING btree ("tenant_id");--> statement-breakpoint
-- [K-13C] SQL kustom yang tidak bisa diekspresikan drizzle-kit (pola
-- blok [K2]/[K3] baseline 0000 dan [K-13B] di 0002): Row Level
-- Security untuk dua tabel baru Fase 13C — tenant_isolation standar
-- untuk keduanya. Tidak ada lengan sempit: segmen & pengaturan opt-in
-- hanya pernah diakses dalam konteks tenant pemiliknya.
ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_opt_in_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "segments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_opt_in_settings"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);