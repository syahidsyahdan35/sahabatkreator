ALTER TABLE "channel_accounts" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "channel_accounts_trashed_at_idx" ON "channel_accounts" USING btree ("trashed_at") WHERE "channel_accounts"."trashed_at" IS NOT NULL;--> statement-breakpoint
-- Fase 6I (tulis tangan, pola lengan sempit 0006/0012/0016/0018/0020 +
-- flag system_relay 0008): worker purge harus bisa MEMINDAI akun Sampah
-- yang masa tenggangnya lewat dari SEMUA tenant, tanpa konteks tenant.
-- Policy SELECT ini sangat sempit: transaksi harus men-set
-- `app.system_relay = 'channel_purge'` DAN yang terbuka HANYA baris yang
-- sudah di Sampah (trashed_at NOT NULL) — tidak ada baris aktif yang
-- pernah terlihat lewat lengan ini. Penghapusan permanennya sendiri
-- tetap berjalan per akun di dalam konteks tenant pemiliknya.
CREATE POLICY "system_purge_scan" ON "channel_accounts"
  FOR SELECT
  USING (
    "trashed_at" IS NOT NULL
    AND current_setting('app.system_relay', true) = 'channel_purge'
  );