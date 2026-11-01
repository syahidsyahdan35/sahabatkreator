import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * @sahabat-kreator/queue — abstraksi BullMQ (Fase 2A, RANCANGAN §2 & §4).
 *
 * Satu antrean fisik `sahabat-kreator` menampung semua job aplikasi; nama
 * job membedakan jenisnya:
 *  - `automation.evaluate` — evaluasi satu pesan inbound terhadap automation
 *    tenant (Fase 2A). Job berikutnya (ai.reply, broadcast.send,
 *    sequence.step, ...) ditambahkan sebagai nama job baru di antrean yang
 *    sama, bukan antrean fisik baru.
 *  - `outbox.relay` — BUKAN job yang di-enqueue siapa pun: relay adalah pola
 *    polling yang dijalankan worker. Worker membaca `outbox_events` yang
 *    belum ter-publish langsung dari Postgres (klaim FOR UPDATE SKIP
 *    LOCKED, lihat `relayUnpublishedOutboxEvents` di @sahabat-kreator/core)
 *    dan menerjemahkan event `message.received` menjadi job
 *    `automation.evaluate`. Konstanta namanya tetap diekspor di sini agar
 *    kosakata job terpusat.
 *
 * Idempotensi adalah kontrak paket ini: jobId untuk `automation.evaluate`
 * DITURUNKAN dari id event outbox (`automation-evaluate-<eventId>`), jadi
 * relay yang crash di tengah jalan dan memproses event yang sama lagi
 * tidak menghasilkan job ganda — BullMQ mengembalikan job yang sudah ada.
 *
 * JEMBATAN PENGIRIMAN LINTAS PROSES (penting, Fase 2A):
 * Worker TIDAK mengirim pesan ke channel secara langsung untuk webchat,
 * karena hub WebSocket pengunjung hidup di proses API. Alurnya:
 *   worker membuat pesan outbound berstatus `queued` di DB
 *   → poller ringan di proses API (±2 dtk) mengambil pesan `queued` untuk
 *     percakapan webchat yang pengunjungnya sedang terhubung
 *   → mendorongnya lewat hub WebSocket dan menandainya `sent`.
 * Pesan untuk pengunjung yang offline tetap `queued` dan ter-flush saat
 * pengunjung reconnect (mekanisme Fase 1F). Jembatan polling DB ini
 * disengaja sederhana dan akan digantikan pub/sub Redis pada fase scale
 * berikutnya, tanpa mengubah kontrak job di paket ini.
 */

export const MAIN_QUEUE_NAME = "sahabat-kreator";

export const OUTBOX_RELAY_JOB = "outbox.relay";
export const AUTOMATION_EVALUATE_JOB = "automation.evaluate";

export interface AutomationEvaluateJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
  /** Id event outbox `message.received` yang memicu job ini (jejak/idempotensi). */
  outboxEventId: string;
}

/** jobId deterministik dari id event outbox — fondasi idempotensi relay. */
export function automationEvaluateJobId(outboxEventId: string): string {
  return `automation-evaluate-${outboxEventId}`;
}

/**
 * Koneksi Redis untuk BullMQ. `maxRetriesPerRequest: null` adalah syarat
 * BullMQ untuk koneksi blocking (Worker). Buat SATU instance per peran
 * (queue / worker) per proses — jangan berbagi satu instance untuk keduanya.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export type AutomationQueue = Queue<AutomationEvaluateJobData>;

export function createAutomationQueue(connection: Redis): AutomationQueue {
  return new Queue<AutomationEvaluateJobData>(MAIN_QUEUE_NAME, { connection });
}

/**
 * Meng-enqueue evaluasi automation untuk satu event `message.received`.
 * Mengembalikan id job yang ada bila jobId yang sama sudah pernah
 * di-enqueue (BullMQ dedupe) — pemanggil tidak perlu mengecek duplikasi.
 */
export async function enqueueAutomationEvaluate(
  queue: AutomationQueue,
  data: AutomationEvaluateJobData,
  options?: JobsOptions,
): Promise<string> {
  const job = await queue.add(AUTOMATION_EVALUATE_JOB, data, {
    jobId: automationEvaluateJobId(data.outboxEventId),
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 1_000,
    ...options,
  });
  return job.id ?? automationEvaluateJobId(data.outboxEventId);
}
