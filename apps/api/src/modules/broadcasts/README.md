# Modul `broadcasts`

Campaign broadcast (Fase 7C — Broadcasts v1): CRUD draft, estimasi
audiens, penjadwalan, pembatalan, daftar penerima. Implementasi di
`routes.ts`; logika domain di `@sahabat-kreator/core` (`broadcasts.ts`);
eksekusi dispatch oleh worker (job BullMQ `broadcast.dispatch` dari
event outbox `broadcast.dispatch_due`), pengiriman oleh poller
telegram/meta di proses API.

Keputusan v1:
- Provider: telegram, messenger, instagram. WhatsApp dikecualikan
  (broadcast di luar jendela 24 jam wajib template resmi — manajemen
  template adalah fase tersendiri) dan webchat dikecualikan (tidak ada
  semantik push ke pengunjung anonim); keduanya ditolak
  `422 BROADCAST_CHANNEL_UNSUPPORTED`, bukan disembunyikan.
- Meta: penerima di luar jendela 24 jam sejak pesan masuk terakhirnya
  menjadi `skipped`/`outside_24h_window` saat dispatch.
- Akses: mutasi owner/admin; baca semua member workspace.
