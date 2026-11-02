ALTER TABLE "channel_accounts" ADD COLUMN "parent_external_id" varchar(255);
--> statement-breakpoint
-- Fase 7B (tulis tangan, pola 0025): WhatsApp menumpang rel Meta 7A.
-- Dua perubahan:
-- 1. Kolom `parent_external_id` (di atas): untuk WhatsApp menampung
--    WABA ID — external_id akun WhatsApp tetap `phone_number_id`
--    (kunci resolusi webhook + penjaga satu-nomor-satu-koneksi), WABA
--    hanya konteks induk. Provider lain NULL.
-- 2. Lengan pindai pengiriman `meta_delivery_scan` (0026) diperluas:
--    provider 'whatsapp' ikut terbuka di bawah flag yang sama
--    (`app.system_delivery = 'meta'`) karena poller Meta kini juga
--    mengirim pesan queued WhatsApp. Policy di-DROP lalu dibuat ulang
--    dengan nama & flag yang sama — jumlah policy TIDAK berubah (41).
-- Resolusi akun webhook WhatsApp TIDAK butuh lengan baru: policy
-- `provider_external_lookup` (0020) generik per (provider, external_id)
-- dan resolusi memakai phone_number_id dari metadata payload.
DROP POLICY "meta_delivery_scan" ON "channel_accounts";
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "channel_accounts"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram', 'whatsapp')
  );
--> statement-breakpoint
DROP POLICY "meta_delivery_scan" ON "conversations";
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "conversations"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram', 'whatsapp')
  );
--> statement-breakpoint
DROP POLICY "meta_delivery_scan" ON "channel_identities";
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "channel_identities"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "provider" IN ('messenger', 'instagram', 'whatsapp')
  );
--> statement-breakpoint
DROP POLICY "meta_delivery_scan" ON "messages";
--> statement-breakpoint
CREATE POLICY "meta_delivery_scan" ON "messages"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'meta'
    AND "direction" = 'outbound'
    AND "status" = 'queued'
  );
