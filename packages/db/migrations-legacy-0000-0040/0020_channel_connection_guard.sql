-- Hotfix Telegram: penjaga "satu bot = satu koneksi" + fondasi disconnect.
--
-- Bagian 1 — index unik parsial (dibangkitkan drizzle-kit dari skema):
-- (provider, external_id) unik di SEMUA tenant selama akunnya belum
-- 'disconnected'. Satu bot Telegram hanya memiliki SATU webhook, jadi
-- koneksi kedua di workspace mana pun membajak koneksi pertama secara
-- diam-diam — di level data itu kini mustahil. Baris 'disconnected'
-- dikecualikan: bot yang sudah diputuskan boleh dihubungkan lagi.
CREATE UNIQUE INDEX "channel_accounts_provider_external_active_unique" ON "channel_accounts" USING btree ("provider","external_id") WHERE "channel_accounts"."status" <> 'disconnected';
--> statement-breakpoint
-- Bagian 2 — lengan RLS lookup (provider, external_id) lintas tenant
-- (tulis tangan, pola 0006/0012/0016/0018): alur connect harus bisa
-- menjawab "apakah bot ini sudah aktif di workspace MANA PUN?" sebelum
-- membuat baris baru — tanpa konteks tenant. Policy SELECT sempit ini
-- hanya membuka baris yang (provider, external_id)-nya PERSIS sama
-- dengan pasangan yang di-set transaksi lewat `app.channel_provider` +
-- `app.channel_external_id`. Pemanggil hanya bisa menanyakan pasangan
-- yang external_id-nya sudah ia ketahui dari sumber tepercaya (hasil
-- getMe atas token yang diserahkan pemilik workspace); respons API ke
-- pengguna tidak pernah menyebut tenant pemilik baris yang ditemukan.
CREATE POLICY "provider_external_lookup" ON "channel_accounts"
  FOR SELECT
  USING (
    "provider"::text = nullif(current_setting('app.channel_provider', true), '')
    AND "external_id" = nullif(current_setting('app.channel_external_id', true), '')
  );
