CREATE TABLE "payment_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(32) DEFAULT 'simulation' NOT NULL,
	"environment" varchar(16) DEFAULT 'sandbox' NOT NULL,
	"midtrans_sandbox_server_key_encrypted" text,
	"midtrans_sandbox_client_key_encrypted" text,
	"midtrans_production_server_key_encrypted" text,
	"midtrans_production_client_key_encrypted" text,
	"xendit_sandbox_server_key_encrypted" text,
	"xendit_sandbox_client_key_encrypted" text,
	"xendit_production_server_key_encrypted" text,
	"xendit_production_client_key_encrypted" text,
	"xendit_sandbox_callback_token_encrypted" text,
	"xendit_production_callback_token_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_configs_provider_valid" CHECK ("payment_provider_configs"."provider" IN ('simulation', 'midtrans', 'xendit')),
	CONSTRAINT "payment_provider_configs_environment_valid" CHECK ("payment_provider_configs"."environment" IN ('sandbox', 'production'))
);
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "provider_environment" varchar(16) DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "provider_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payment_provider_configs" ADD CONSTRAINT "payment_provider_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_configs_tenant_unique" ON "payment_provider_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_provider_configs_tenant_id_idx" ON "payment_provider_configs" USING btree ("tenant_id");--> statement-breakpoint
-- [K-14A] SQL kustom yang tidak bisa diekspresikan drizzle-kit (pola
-- blok [K-13G] di 0006): Row Level Security untuk tabel baru Fase 14A
-- payment_provider_configs — tenant_isolation standar. Konfigurasi
-- provider hanya pernah diakses dalam konteks tenant pemiliknya
-- (dashboard Settings, pembuatan tautan, verifikasi webhook sesudah
-- tenant di-resolve dari tautannya); tidak ada lengan publik sempit.
ALTER TABLE "payment_provider_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_provider_configs"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
