-- Row Level Security Fase 5A: lengan lookup API key publik pada `api_keys`.
--
-- Kebutuhan: middleware API publik /v1 menerima API key (`sk_live_...`)
-- TANPA mengetahui tenant pemiliknya lebih dulu. Ia menghitung SHA-256
-- dari kunci yang disajikan, lalu harus menemukan baris pemilik hash itu
-- untuk menurunkan tenant. Dengan policy 0001 yang murni berbasis
-- app.tenant_id, lookup itu mustahil (konteks tenant belum ada —
-- chicken-and-egg yang sama dengan siteKey webchat 0006 & code bayar 0012).
--
-- Solusi: policy KEDUA `public_key_lookup` (FOR SELECT saja) — baris juga
-- terlihat bila `key_hash`-nya sama persis dengan setting transaksi
-- `app.api_key_hash`. Yang terbuka HANYA baris yang hash-nya sudah
-- diketahui pemanggil: menyajikan hash yang cocok berarti membuktikan
-- kepemilikan kunci mentahnya (SHA-256 satu arah, kunci 32+ karakter acak),
-- jadi lengan ini tidak membocorkan baris tenant lain. Policy bersifat
-- permisif-OR terhadap `tenant_isolation` yang sudah ada (0001) — akses
-- dalam konteks tenant tidak berubah.
--
-- Penulisan TIDAK diberi lengan publik: mutasi (buat/cabut/last_used_at)
-- berjalan dalam konteks `app.tenant_id` sesudah tenant ter-resolve dari
-- baris kunci, dicakup policy tenant_isolation.

CREATE POLICY "public_key_lookup" ON "api_keys"
  FOR SELECT
  USING ("key_hash" = nullif(current_setting('app.api_key_hash', true), ''));
