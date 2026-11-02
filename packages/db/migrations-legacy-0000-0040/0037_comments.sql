-- Comment-to-DM Instagram/Messenger + Moderasi Komentar (Fase 10B).
--
-- Bagian 1 (gaya drizzle-kit dari skema):
-- 1. Enum baru `comment_moderation_status` ('visible' | 'hidden') dan
--    nilai enum baru 'comment' pada `automation_trigger_type` +
--    `automation_kind` — aturan komentar adalah automation biasa
--    (trigger_type='comment', kind='comment') yang trigger_config-nya
--    membawa channelAccountId dan action_config-nya membawa kombinasi
--    aksi {text=DM, sendDm, publicReplyText, hideComment}. PG16
--    mengizinkan ADD VALUE di dalam transaksi selama nilai barunya
--    tidak dipakai di migrasi yang sama — tidak dipakai di sini.
-- 2. Tabel `comments` — buku besar komentar publik IG/Messenger dari
--    webhook Meta (changes field `comments` untuk objek instagram;
--    field `feed` item `comment` untuk objek page). Unik
--    (channel_account_id, provider_comment_id) adalah penjaga dedup:
--    pengiriman ulang webhook / replay log integrasi menabrak index
--    yang sama dan tidak menghasilkan baris atau aksi kedua.
--    `actions` (jsonb) menyimpan jejak evaluasi per aksi;
--    `matched_automation_id` aturan yang cocok. contact_id /
--    conversation_id terisi bila penulis dikenal atau saat aksi DM
--    membuat percakapannya.
-- 3. `messages.provider_comment_id` (varchar, nullable) — alamat kirim
--    DM privat balasan-atas-komentar: poller Meta mengirim pesan
--    berkolom ini dengan `recipient: { comment_id }` (private reply
--    Send API). NULL untuk semua pesan lain.
CREATE TYPE "public"."comment_moderation_status" AS ENUM('visible', 'hidden');--> statement-breakpoint
ALTER TYPE "public"."automation_trigger_type" ADD VALUE 'comment';--> statement-breakpoint
ALTER TYPE "public"."automation_kind" ADD VALUE 'comment';--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_comment_id" varchar(255) NOT NULL,
	"media_id" varchar(255),
	"post_id" varchar(255),
	"parent_id" varchar(255),
	"author_external_id" varchar(255) NOT NULL,
	"author_username" varchar(255),
	"text" text NOT NULL,
	"provider_created_at" timestamp with time zone,
	"moderation_status" "comment_moderation_status" DEFAULT 'visible' NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"matched_automation_id" uuid,
	"actions" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_comment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_matched_automation_id_automations_id_fk" FOREIGN KEY ("matched_automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_tenant_id_idx" ON "comments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "comments_tenant_account_created_idx" ON "comments" USING btree ("tenant_id","channel_account_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_tenant_automation_idx" ON "comments" USING btree ("tenant_id","matched_automation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_account_provider_comment_unique" ON "comments" USING btree ("channel_account_id","provider_comment_id");
-- Bagian 2 (tulis tangan) — RLS.
-- `comments` diakses dalam konteks tenant biasa (`app.tenant_id`) oleh:
-- route API komentar (daftar + moderasi manual), core saat merekam
-- komentar dari webhook (resolusi akun Meta sudah berjalan di bawah
-- konteks tenant pemilik akun — pola yang sama dengan perekaman pesan
-- masuk Meta), dan worker saat mengevaluasi aturan (job membawa
-- tenantId-nya). Jadi cukup policy `tenant_isolation` standar; tidak
-- ada lengan sistem. Tanpa konteks: 0 baris terbaca, semua tulis
-- ditolak.
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "comments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
