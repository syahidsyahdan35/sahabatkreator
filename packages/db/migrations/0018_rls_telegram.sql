-- Row Level Security Fase 6A: lengan resolusi webhook Telegram +
-- lengan pindai pengiriman sistem (poller Telegram di proses API).
--
-- Kebutuhan 1 — webhook masuk: POST /telegram/webhook/:channelAccountId
-- menerima update TANPA mengetahui tenant lebih dulu. Route memvalidasi
-- format UUID, lalu transaksi resolusi men-set
-- `app.telegram_channel_account_id`; policy `telegram_webhook_lookup`
-- (FOR SELECT) hanya membuka baris telegram yang id-nya sama dengan
-- setting itu. Id akun adalah UUID acak (bukan rahasia, tercetak di URL
-- webhook yang didaftarkan ke Telegram); autentikasi sesungguhnya adalah
-- header secret token yang hash-nya tersimpan di baris itu — membuka
-- baris berdasarkan id saja tidak memberi akses apa pun selain membaca
-- baris yang id-nya sudah diketahui pemanggil (pola yang sama dengan
-- siteKey webchat 0006 & hash API key 0016).
--
-- Kebutuhan 2 — poller pengiriman: balasan untuk percakapan Telegram
-- dibuat sebagai pesan outbound `queued` oleh dashboard/worker (proses
-- dan konteks tenant bermacam-macam); poller di API harus MENEMUKAN
-- antrean itu lintas tenant untuk mengirimnya via Bot API. Policy
-- `system_delivery_scan` (FOR SELECT) pada 4 tabel membuka baris-baris
-- yang relevan HANYA bila transaksi men-set
-- `app.system_delivery = 'telegram'` (transaction-local):
--   - channel_accounts  : hanya provider 'telegram'
--   - conversations     : hanya provider 'telegram'
--   - channel_identities: hanya provider 'telegram'
--   - messages          : hanya outbound berstatus 'queued'
--     (gabungan join di query poller yang membatasi ke percakapan
--     telegram; pesan provider lain tidak pernah terkirim oleh poller ini)
-- Ini lengan sistem ketiga sesudah `system_relay` outbox (0008): hanya
-- kode server kita yang bisa men-set setting ini dari koneksi aplikasi,
-- dan cakupannya baca-saja. Penandaan sent/failed tetap berjalan dalam
-- konteks tenant pemilik (policy tenant_isolation biasa) — lengan ini
-- TIDAK diberi akses tulis.

CREATE POLICY "telegram_webhook_lookup" ON "channel_accounts"
  FOR SELECT
  USING (
    "provider" = 'telegram'
    AND "id" = nullif(current_setting('app.telegram_channel_account_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "system_delivery_scan" ON "channel_accounts"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'telegram'
    AND "provider" = 'telegram'
  );
--> statement-breakpoint
CREATE POLICY "system_delivery_scan" ON "conversations"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'telegram'
    AND "provider" = 'telegram'
  );
--> statement-breakpoint
CREATE POLICY "system_delivery_scan" ON "channel_identities"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'telegram'
    AND "provider" = 'telegram'
  );
--> statement-breakpoint
CREATE POLICY "system_delivery_scan" ON "messages"
  FOR SELECT
  USING (
    current_setting('app.system_delivery', true) = 'telegram'
    AND "direction" = 'outbound'
    AND "status" = 'queued'
  );
