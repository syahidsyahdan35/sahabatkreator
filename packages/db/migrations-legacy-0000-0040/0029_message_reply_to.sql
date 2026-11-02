-- Balas dengan kutipan / reply quote (Fase 7B.5).
--
-- `messages.reply_to_message_id`: tautan pesan ini ke pesan LAIN yang
-- dikutipnya (selalu dalam percakapan yang sama — ditegakkan lapisan
-- core saat menautkan/membuat, bukan oleh FK, karena FK tidak bisa
-- menyatakan "percakapan yang sama"). ID provider pesan target TIDAK
-- disimpan duplikat di mana pun: poller menurunkannya saat kirim dari
-- `provider_message_id` baris target (format majemuk per provider).
--
-- ON DELETE SET NULL disengaja (mengikuti preseden integration_log):
-- purge channel (Fase 6I) menghapus baris-baris pesan satu percakapan —
-- balasan yang mengutip pesan yang terhapus tidak boleh menggagalkan
-- purge dan tidak ikut terhapus; tautan kutipannya saja yang lepas
-- (kolom NULL → serializer melaporkan replyTo null, UI tampil polos).
--
-- Tidak ada policy RLS baru: kolom ini berada di tabel `messages` yang
-- sudah dilindungi policy `tenant_isolation` (0005) — kolom baru
-- otomatis ternaungi policy baris yang sama (dibuktikan di verify [22]).
ALTER TABLE "messages" ADD COLUMN "reply_to_message_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_reply_to_message_id_idx" ON "messages" USING btree ("reply_to_message_id");
