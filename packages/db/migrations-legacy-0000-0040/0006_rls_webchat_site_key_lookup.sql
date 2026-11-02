-- RLS tambahan Fase 1F: resolusi siteKey webchat publik.
--
-- Kebutuhan: endpoint publik widget webchat menerima siteKey (identitas
-- publik channel, `wc_...`) TANPA mengetahui tenant-nya lebih dulu, lalu
-- harus menemukan baris channel_accounts untuk menentukan tenant. Dengan
-- policy 0005 yang murni berbasis app.tenant_id, lookup itu mustahil
-- (konteks tenant belum ada — chicken-and-egg).
--
-- Solusi (pola yang sama dengan lengan app.user_id pada 0003): policy
-- channel_accounts diperluas satu lengan SELECT — baris juga terlihat bila
-- provider-nya 'webchat' DAN external_id-nya sama dengan setting sesi
-- `app.webchat_site_key` (di-set transaksi publik resolusi siteKey,
-- transaction-local). siteKey memang kredensial publik yang dirancang
-- untuk disebar (tercetak di HTML situs tenant), jadi lengan ini tidak
-- membocorkan apa pun yang tidak publik: yang terlihat hanya baris milik
-- siteKey yang sudah diketahui pemanggil, bukan baris tenant lain.
--
-- WITH CHECK sengaja TIDAK diberi lengan siteKey: penulisan channel tetap
-- hanya dalam konteks tenant yang cocok (app.tenant_id), sama seperti 0005.
DROP POLICY "tenant_isolation" ON "channel_accounts";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_accounts"
  USING (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR (
      "provider" = 'webchat'
      AND "external_id" = nullif(current_setting('app.webchat_site_key', true), '')
    )
  )
  WITH CHECK (
    "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
