-- Kedalaman Inbox Tim (Fase 9C): catatan internal percakapan, pencabutan
-- undangan tim, dan lengan lookup token undangan.
--
-- 1. Tabel `conversation_notes` — catatan internal per percakapan.
--    Tabel TERPISAH dari `messages` secara sengaja: seluruh jalur keluar
--    (poller Telegram/Meta, flush webchat, broadcast, agent) hanya pernah
--    membaca tabel `messages`, jadi catatan internal TIDAK BISA bocor ke
--    kontak/provider — bukan sekadar difilter, melainkan tidak berada di
--    tabel yang sama. Kolomnya pun tidak punya direction/status antrean.
--    Penulis memakai FK ON DELETE SET NULL (pola saved_replies): catatan
--    tetap ada walau penulisnya keluar dari workspace/user terhapus.
--
-- 2. `invitations.revoked_at` — pencabutan undangan (Fase 9C). Sampai
--    fase ini tabel `invitations` (0000) sudah punya token_hash +
--    expires_at + accepted_at tetapi belum ada cara mencabut dan belum
--    ada API sama sekali; kolom ini melengkapi siklus hidupnya:
--    pending = accepted_at NULL & revoked_at NULL & expires_at > now().
--
-- 3. Policy `invitation_token_lookup` pada `invitations` — pola lengan
--    sempit yang sama dengan siteKey webchat (0006), code bayar (0012),
--    dan API key (0016): penerima undangan BELUM member tenant mana pun,
--    jadi konteks app.tenant_id mustahil ada sebelum token dibaca
--    (chicken-and-egg). Lengan ini FOR SELECT saja dan hanya membuka
--    baris yang token_hash-nya sama persis dengan setting transaksi
--    `app.invitation_token_hash` — menyajikan hash yang cocok berarti
--    membuktikan kepemilikan token mentah di tautan (SHA-256 satu arah,
--    token 32 byte acak). Penulisan (terima/cabut) tetap berjalan dalam
--    konteks app.tenant_id sesudah tenant ter-resolve dari barisnya,
--    dicakup policy tenant_isolation yang sudah ada.
--
-- 4. Index penugasan percakapan untuk filter inbox "milik saya / belum
--    ditugaskan" (kolom assignee_user_id sendiri sudah ada sejak 0004).
CREATE TABLE "conversation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_notes_tenant_id_idx" ON "conversation_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversation_notes_conversation_created_idx" ON "conversation_notes" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- RLS: policy `tenant_isolation` standar — API selalu berjalan dalam
-- konteks tenant aktif; tanpa konteks: 0 baris.
ALTER TABLE "conversation_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_notes"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE POLICY "invitation_token_lookup" ON "invitations"
  FOR SELECT
  USING ("token_hash" = nullif(current_setting('app.invitation_token_hash', true), ''));--> statement-breakpoint
CREATE INDEX "conversations_tenant_assignee_idx" ON "conversations" USING btree ("tenant_id","assignee_user_id");
