-- Fase 11A — Normalisasi skema (audit lengkap: docs/DB-NORMALIZATION-11A.md).
-- Perubahan yang diterapkan hanya yang terbukti aman:
--  1. Jatuhkan dua kolom warisan yang TIDAK PERNAH dipakai kode maupun
--     terisi data (staging membuktikan 0 baris non-NULL untuk keduanya):
--     - contacts.avatar_url — warisan sebelum Fase 6D; avatar kontak kini
--       dari tabel profile_photos (endpoint avatar), kolom ini tidak
--       pernah terisi sejak dibuat.
--     - messages.provider_cost — sisa komentar desain lama (§12.5);
--       biaya provider yang nyata dicatat di usage_ledger (9B/12D).
--  2. Tambah index pada kolom FK yang nyata difilter/di-join kode tetapi
--     belum punya index dengan kolom pertama yang terpakai (Postgres tidak
--     mengindeks FK otomatis): pola merge kontak 9B me-rewrite contact_id
--     pada automation_runs/flow_runs/agent_suggestions/payment_links/
--     sequence_enrollments/broadcast_recipients; join kontak di flows &
--     products; tautan komentar & penerima broadcast ke percakapan.
-- Tipe ID, RLS, dan JSONB sengaja TIDAK diubah — alasannya per temuan ada
-- di docs/DB-NORMALIZATION-11A.md.
ALTER TABLE "contacts" DROP COLUMN "avatar_url";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "provider_cost";--> statement-breakpoint
CREATE INDEX "agent_suggestions_agent_id_idx" ON "agent_suggestions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_suggestions_contact_id_idx" ON "agent_suggestions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "automation_runs_contact_id_idx" ON "automation_runs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "automation_runs_conversation_id_idx" ON "automation_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_contact_id_idx" ON "broadcast_recipients" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "broadcast_recipients_conversation_id_idx" ON "broadcast_recipients" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "comments_contact_id_idx" ON "comments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "comments_conversation_id_idx" ON "comments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "flow_runs_contact_id_idx" ON "flow_runs" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "payment_links_contact_id_idx" ON "payment_links" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "payment_links_conversation_id_idx" ON "payment_links" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_contact_id_idx" ON "sequence_enrollments" USING btree ("contact_id");
