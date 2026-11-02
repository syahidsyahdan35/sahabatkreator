ALTER TABLE "channel_accounts" ADD COLUMN "public_handle" varchar(255);
--> statement-breakpoint
-- Fase 7A (tulis tangan, pola 0018): lengan pindai pengiriman Meta untuk
-- poller di proses API. Poller harus MENEMUKAN pesan outbound `queued`
-- percakapan messenger/instagram lintas tenant untuk mengirimnya via
-- Graph API. Policy `meta_delivery_scan` (FOR SELECT) pada 4 tabel
-- membuka baris relevan HANYA bila transaksi men-set
-- `app.system_delivery = 'meta'` (transaction-local):
--   - channel_accounts / conversations / channel_identities:
--     hanya provider 'messenger'/'instagram'
--   - messages: hanya outbound berstatus 'queued' (gabungan join di
--     query poller yang membatasi ke percakapan Meta)
-- Resolusi akun webhook Meta TIDAK butuh lengan baru: policy
-- `provider_external_lookup` (0020) sudah generik per
-- (provider, external_id) dan dipakai ulang apa adanya.
-- Baca-saja seperti lengan sistem lain; penandaan sent/failed tetap
-- dalam konteks tenant pemilik.
CREATE POLICY "meta_delivery_scan" ON "channel_accounts"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram')
  );
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "conversations"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram')
  );
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "channel_identities"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram')
  );
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "messages"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "direction" = 'outbound'
    AND "status" = 'queued'
  );