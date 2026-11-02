-- Fase 6A.2: jenis percakapan eksplisit (private | group | channel).
--
-- Bagian 1 — kolom + CHECK (dibangkitkan drizzle-kit dari skema):
-- `kind` menjadi sumber kebenaran tunggal jenis percakapan. Sampai 6A.1
-- jenis disimpulkan dari kehadiran `title` (judul grup); channel Telegram
-- juga berjudul tetapi BUKAN percakapan dua arah, jadi penanda implisit
-- itu tidak lagi cukup.
ALTER TABLE "conversations" ADD COLUMN "kind" varchar(16) DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_valid" CHECK ("conversations"."kind" IN ('private', 'group', 'channel'));--> statement-breakpoint
-- Bagian 2 — backfill (tulis tangan): heuristik warisan 6A.1 — baris yang
-- membawa judul adalah grup Telegram (satu-satunya pengisi `title`
-- sampai fase ini); semua baris lain tetap 'private' dari default kolom,
-- yang memang benar untuk chat privat Telegram & semua webchat. Channel
-- belum ada sebelum fase ini, jadi tidak ada baris 'channel' warisan.
UPDATE "conversations" SET "kind" = 'group' WHERE "title" IS NOT NULL;
