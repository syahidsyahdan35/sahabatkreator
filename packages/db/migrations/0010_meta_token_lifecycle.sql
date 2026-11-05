CREATE TYPE "public"."channel_token_health" AS ENUM('ok', 'expiring', 'expired', 'refresh_failed');--> statement-breakpoint
CREATE TYPE "public"."channel_token_type" AS ENUM('page_access_token', 'system_user_token', 'business_token');--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "token_type" "channel_token_type";--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "token_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "token_health" "channel_token_health";--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "error_code" varchar(128);--> statement-breakpoint
CREATE INDEX "channel_accounts_token_expires_at_idx" ON "channel_accounts" USING btree ("token_expires_at") WHERE "channel_accounts"."token_expires_at" IS NOT NULL;--> statement-breakpoint
-- Backfill varian token (lifecycle 0010): akun Messenger klasik selalu
-- memakai Page Access Token dari Facebook Login (tanpa expiry tercatat).
-- Instagram & WhatsApp: varian tidak bisa ditebak dari data lama (IG
-- bisa Page token MAUPUN SUAT) — dibiarkan NULL; poller probe `/me`
-- pertama menulis balik varian yang terbaca.
UPDATE "channel_accounts" SET "token_type" = 'page_access_token'
  WHERE "provider" = 'messenger';--> statement-breakpoint
-- Lengan RLS pemindaian lifecycle token: worker harian membaca akun
-- Meta AKTIF lintas-tenant yang tokennya ber-jadwal kedaluwarsa (baca
-- saja; penulisan hasilnya lewat konteks tenant masing-masing). Pola
-- "system_purge_scan" (0000) — nilai lengan berbeda, fitur berbeda.
CREATE POLICY "meta_token_lifecycle_scan" ON "channel_accounts"
  FOR SELECT
  USING (
    current_setting('app.system_relay', true) = 'meta_token_lifecycle'
    AND "provider" IN ('messenger', 'instagram', 'whatsapp')
    AND "status" = 'connected'
  );