-- Knowledge Base: lampiran berkas (Fase 12C).
--
-- Bagian 1 (gaya drizzle-kit dari skema):
-- 1. Tabel `kb_source_documents` — berkas asli unggahan KB (PDF/TXT/MD):
--    byte mentah disimpan sebagai bytea di DB (pola profile_photos 6D —
--    belum ada konsumen R2 dan berkas dibatasi ≤5MB di lapisan API),
--    nama/mime/ukuran, `chunk_count` hasil impor, dan `created_by`
--    (pengunggah; SET NULL bila user hilang, pola saved_replies).
-- 2. `kb_documents.source_document_id` (uuid, nullable) — entri KB yang
--    lahir dari impor berkas menunjuk berkas asalnya; entri tulis tangan
--    NULL. FK ON DELETE CASCADE dari sisi berkas: menghapus berkas
--    menghapus entri turunannya, yang lalu men-cascade ke `kb_chunks`
--    lewat FK document_id yang sudah ada sejak 3A.
CREATE TABLE "kb_source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"byte_size" integer NOT NULL,
	"data" bytea NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "source_document_id" uuid;
--> statement-breakpoint
ALTER TABLE "kb_source_documents" ADD CONSTRAINT "kb_source_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_source_documents" ADD CONSTRAINT "kb_source_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_source_document_id_kb_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."kb_source_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "kb_source_documents_tenant_id_idx" ON "kb_source_documents" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "kb_documents_source_document_idx" ON "kb_documents" USING btree ("source_document_id");
-- Bagian 2 (tulis tangan) — RLS.
-- `kb_source_documents` diakses dalam konteks tenant biasa
-- (`app.tenant_id`) oleh route API knowledge saja (unggah/daftar/hapus);
-- tidak ada pembaca lintas tenant dan tidak ada lengan sistem. Tanpa
-- konteks: 0 baris terbaca, semua tulis ditolak.
--> statement-breakpoint
ALTER TABLE "kb_source_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kb_source_documents"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
