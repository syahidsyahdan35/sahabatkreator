ALTER TABLE "conversations" ADD COLUMN "provider_chat_id" varchar(255);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_name" varchar(255);--> statement-breakpoint
-- Backfill Fase 6A.1: semua percakapan Telegram yang sudah ada adalah
-- chat privat (cakupan 6A), jadi alamat balasannya memang id user kontak
-- pada akun bot itu — salin dari channel_identities agar poller memakai
-- jalur provider_chat_id yang seragam. Baris non-telegram tidak disentuh.
UPDATE "conversations" AS c
SET "provider_chat_id" = ci."external_user_id"
FROM "channel_identities" AS ci
WHERE c."provider" = 'telegram'
  AND c."provider_chat_id" IS NULL
  AND ci."channel_account_id" = c."channel_account_id"
  AND ci."contact_id" = c."contact_id";
