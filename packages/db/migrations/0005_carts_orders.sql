CREATE TYPE "public"."cart_status" AS ENUM('open', 'checked_out', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_idr" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_qty_positive" CHECK ("cart_items"."qty" > 0),
	CONSTRAINT "cart_items_unit_price_nonnegative" CHECK ("cart_items"."unit_price_idr" >= 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" "cart_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_idr" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_qty_positive" CHECK ("order_items"."qty" > 0),
	CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("order_items"."unit_price_idr" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"total_idr" bigint NOT NULL,
	"payment_link_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_idr_nonnegative" CHECK ("orders"."total_idr" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_links" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_items_tenant_id_idx" ON "cart_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_product_unique" ON "cart_items" USING btree ("cart_id","product_id");--> statement-breakpoint
CREATE INDEX "carts_tenant_id_idx" ON "carts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carts_contact_idx" ON "carts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_one_open_per_contact" ON "carts" USING btree ("tenant_id","contact_id") WHERE "carts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "order_items_tenant_id_idx" ON "order_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_id_idx" ON "orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_contact_idx" ON "orders" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_links_order_idx" ON "payment_links" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_exactly_one_target" CHECK (("payment_links"."product_id" IS NOT NULL) <> ("payment_links"."order_id" IS NOT NULL));--> statement-breakpoint
-- [K-13F] SQL kustom yang tidak bisa diekspresikan drizzle-kit (pola
-- blok [K-13D] di 0004): Row Level Security untuk 4 tabel baru Fase
-- 13F — tenant_isolation standar. Keranjang & order hanya pernah
-- diakses dalam konteks tenant pemiliknya (flow worker, dashboard,
-- API v1); tautan bayar order me-resolve lewat lengan publik
-- `public_code_lookup` payment_links yang sudah ada (migrasi 0012),
-- jadi tidak ada lengan sempit baru.
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "carts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cart_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);