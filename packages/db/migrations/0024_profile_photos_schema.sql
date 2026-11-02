CREATE TABLE "profile_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" varchar(32) NOT NULL,
	"owner_id" uuid NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"data" "bytea" NOT NULL,
	"etag" varchar(64) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_photos_owner_type_valid" CHECK ("profile_photos"."owner_type" IN ('channel_account', 'contact'))
);
--> statement-breakpoint
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_tenant_owner_unique" ON "profile_photos" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "profile_photos_tenant_id_idx" ON "profile_photos" USING btree ("tenant_id");