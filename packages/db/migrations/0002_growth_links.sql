CREATE TYPE "public"."growth_link_event_kind" AS ENUM('click', 'picker_view', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."growth_link_kind" AS ENUM('single', 'picker');--> statement-breakpoint
CREATE TABLE "growth_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"growth_link_id" uuid NOT NULL,
	"kind" "growth_link_event_kind" NOT NULL,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "growth_link_kind" NOT NULL,
	"label" varchar(128) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"channel_account_id" uuid,
	"picker_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_tag" varchar(64),
	"prefill_text" varchar(1000),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_links_kind_channel_check" CHECK (("growth_links"."kind" = 'single' AND "growth_links"."channel_account_id" IS NOT NULL AND jsonb_array_length("growth_links"."picker_channel_ids") = 0)
        OR ("growth_links"."kind" = 'picker' AND "growth_links"."channel_account_id" IS NULL AND jsonb_array_length("growth_links"."picker_channel_ids") >= 2))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source" varchar(128);--> statement-breakpoint
ALTER TABLE "growth_link_events" ADD CONSTRAINT "growth_link_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_link_events" ADD CONSTRAINT "growth_link_events_growth_link_id_growth_links_id_fk" FOREIGN KEY ("growth_link_id") REFERENCES "public"."growth_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_link_events" ADD CONSTRAINT "growth_link_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_links" ADD CONSTRAINT "growth_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "growth_link_events_tenant_id_idx" ON "growth_link_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "growth_link_events_link_kind_idx" ON "growth_link_events" USING btree ("growth_link_id","kind");--> statement-breakpoint
CREATE INDEX "growth_link_events_contact_id_idx" ON "growth_link_events" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_link_events_conversion_unique" ON "growth_link_events" USING btree ("growth_link_id","contact_id") WHERE "growth_link_events"."kind" = 'conversion' AND "growth_link_events"."contact_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_links_slug_unique" ON "growth_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "growth_links_tenant_id_idx" ON "growth_links" USING btree ("tenant_id");--> statement-breakpoint
-- [K-13B] SQL kustom yang tidak bisa diekspresikan drizzle-kit (pola
-- blok [K2]/[K3] baseline 0000): Row Level Security untuk dua tabel
-- baru Fase 13B. tenant_isolation standar untuk keduanya, plus lengan
-- sempit SELECT-only `growth_link_public_lookup` pada growth_links —
-- resolusi slug publik /go/:slug TANPA konteks tenant (route publik
-- men-set `app.growth_slug` dalam transaksinya; hanya baris slug itu
-- yang terbuka, pola lengan webchat 0006). Event publik sesudahnya
-- ditulis dalam konteks tenant hasil resolusi (tenant_isolation).
ALTER TABLE "growth_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "growth_link_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "growth_links"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "growth_link_public_lookup" ON "growth_links"
  FOR SELECT
  USING ("slug" = nullif(current_setting('app.growth_slug', true), ''));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "growth_link_events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);