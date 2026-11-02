-- Row Level Security Fase 4A: tabel Produk & Tautan Bayar.
-- Pola `tenant_isolation` yang sama persis dengan migrasi 0001/0005/0008/0010
-- (app.tenant_id transaction-local, fail-closed lewat nullif) untuk products.
--
-- payment_links mendapat DUA policy:
-- 1. `tenant_isolation` — akses penuh dalam konteks tenant pemilik.
-- 2. `public_code_lookup` (FOR SELECT saja) — lengan sempit meniru pola
--    siteKey webchat (0006): halaman bayar publik menerima `code` TANPA
--    mengetahui tenant-nya lebih dulu. Transaksi resolusi men-set
--    `app.payment_code` (transaction-local); yang terlihat HANYA baris
--    yang code-nya sama persis dengan yang sudah diketahui pemanggil —
--    code memang kredensial publik yang dirancang untuk disebar ke
--    pembeli, jadi lengan ini tidak membocorkan baris tenant lain.
--    Penulisan (INSERT/UPDATE/DELETE) TIDAK diberi lengan publik: semua
--    mutasi — termasuk simulate-pay — berjalan sesudah tenant ter-resolve,
--    dalam konteks `app.tenant_id`, dicakup policy tenant_isolation.

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "payment_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_links"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "public_code_lookup" ON "payment_links"
  FOR SELECT
  USING ("code" = nullif(current_setting('app.payment_code', true), ''));
