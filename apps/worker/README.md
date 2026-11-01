# @sahabat-kreator/worker

Proses worker terpisah dari API (Fase 2A — nyata). Dijalankan di staging sebagai unit systemd `sahabat-kreator-worker` (Bun menjalankan `dist/index.js` hasil bundle tsup), env dari `.env.staging` (`DATABASE_URL` role aplikasi + `REDIS_URL` ke container Redis khusus proyek).

Tanggung jawab saat ini:

1. **Relay outbox** — polling `outbox_events` yang belum ter-publish tiap ±2 detik (klaim `FOR UPDATE SKIP LOCKED`, policy RLS `system_relay` migrasi 0008). Event `message.received` diterjemahkan menjadi job BullMQ `automation.evaluate` dengan jobId deterministik dari id event (idempoten).
2. **Evaluasi automation** — BullMQ Worker menjalankan `evaluateInboundMessageForAutomations` (@sahabat-kreator/core): pencocokan keyword, balasan outbound `sender_type='system'` berstatus `queued`, `automation_runs`, dan audit `automation.fired`.

Worker **tidak** mengirim WebSocket ke pengunjung webchat — hub WS hidup di proses API. Pengiriman balasan automation ke pengunjung dijembatani poller pengiriman di API (lihat README `@sahabat-kreator/queue`). Job fase berikutnya (ai-reply, broadcast, sequence) akan ditambahkan sebagai nama job baru pada antrean yang sama.
