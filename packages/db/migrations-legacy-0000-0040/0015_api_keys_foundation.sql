ALTER TYPE "public"."audit_actor_type" ADD VALUE 'api_key';--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_prefix" varchar(16) DEFAULT '' NOT NULL;