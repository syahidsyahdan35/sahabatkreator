import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * @sahabat-kreator/queue — abstraksi BullMQ (Fase 2A, RANCANGAN §2 & §4).
 *
 * Satu antrean fisik `sahabat-kreator` menampung semua job aplikasi; nama
 * job membedakan jenisnya:
 *  - `automation.evaluate` — evaluasi satu pesan inbound terhadap automation
 *    tenant (Fase 2A). Job berikutnya (broadcast.send, sequence.step, ...)
 *    ditambahkan sebagai nama job baru di antrean yang sama, bukan antrean
 *    fisik baru.
 *  - `agent.respond` — agent AI menanggapi satu pesan inbound (Fase 3A),
 *    di-enqueue processor automation.evaluate SETELAH evaluasi selesai
 *    tanpa tembakan (keyword dulu, AI kemudian).
 *  - `sequence.step` — satu langkah sequence automation (Fase 2C), job
 *    TERTUNDA yang di-enqueue relay dari event outbox `sequence.step_due`
 *    dengan jobId `seq-<enrollmentId>-<position>`.
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
 * JEMBATAN PENGIRIMAN LINTAS PROSES (penting, Fase 2A → digantikan 6G):
 * Worker TIDAK mengirim pesan ke channel secara langsung untuk webchat.
 * Alur sejak Fase 6G (pub/sub Redis — lihat `./realtime.ts`):
 *   worker/api membuat pesan outbound berstatus `queued` di DB
 *   → penerbit menerbitkan nudge `message.queued` ke Redis setelah commit
 *   → apps/realtime (pemilik socket pengunjung sekarang) mem-flush pesan
 *     `queued` percakapan itu menjadi `sent` dan mendorong nudge ke
 *     widget; widget memuat ulang lewat REST.
 * Pesan untuk pengunjung yang offline tetap `queued` dan ter-flush saat
 * pengunjung reconnect. (Di Fase 2A–6A.2 langkah tengah ini adalah poller
 * DB di proses API + hub WebSocket in-memory; keduanya pensiun di 6G.)
 */

export const MAIN_QUEUE_NAME = "sahabat-kreator";

export const OUTBOX_RELAY_JOB = "outbox.relay";
export const AUTOMATION_EVALUATE_JOB = "automation.evaluate";
export const AGENT_RESPOND_JOB = "agent.respond";
export const SEQUENCE_STEP_JOB = "sequence.step";

export interface AutomationEvaluateJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
  /** Id event outbox `message.received` yang memicu job ini (jejak/idempotensi). */
  outboxEventId: string;
}

/**
 * Job Fase 3A: agent AI menanggapi satu pesan inbound. Di-enqueue oleh
 * processor `automation.evaluate` di worker SETELAH evaluasi automation
 * selesai TANPA tembakan apa pun (urutan pasti: keyword → AI; pesan yang
 * sudah dijawab automation tidak dijawab lagi oleh agent). jobId
 * deterministik dari id PESAN pemicu (`agent-respond-<messageId>`):
 * enqueue ganda untuk pesan yang sama selalu menunjuk job yang sama.
 */
export interface AgentRespondJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

/**
 * Job Fase 2C: jalankan SATU langkah sequence untuk satu enrollment.
 * Di-enqueue oleh relay outbox dari event `sequence.step_due` (yang ditulis
 * core saat enrollment dibuat dan setiap langkah selesai), sebagai job
 * TERTUNDA BullMQ dengan delay = delay_minutes langkah itu. jobId
 * deterministik `seq-<enrollmentId>-<stepPosition>`: relay yang memproses
 * event yang sama dua kali tidak menghasilkan dua job untuk langkah yang
 * sama; eksekusi ganda pun aman karena core menolak posisi basi.
 */
export interface SequenceStepJobData {
  tenantId: string;
  enrollmentId: string;
  stepPosition: number;
}

/** jobId deterministik dari id event outbox — fondasi idempotensi relay. */
export function automationEvaluateJobId(outboxEventId: string): string {
  return `automation-evaluate-${outboxEventId}`;
}

/** jobId deterministik satu langkah sequence: `seq-<enrollmentId>-<position>`. */
export function sequenceStepJobId(
  enrollmentId: string,
  stepPosition: number,
): string {
  return `seq-${enrollmentId}-${stepPosition}`;
}

/** jobId deterministik dari id pesan pemicu agent. */
export function agentRespondJobId(messageId: string): string {
  return `agent-respond-${messageId}`;
}

/**
 * Koneksi Redis untuk BullMQ. `maxRetriesPerRequest: null` adalah syarat
 * BullMQ untuk koneksi blocking (Worker). Buat SATU instance per peran
 * (queue / worker) per proses — jangan berbagi satu instance untuk keduanya.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/** Semua data job yang berjalan di antrean fisik utama. */
export type MainJobData =
  | AutomationEvaluateJobData
  | AgentRespondJobData
  | SequenceStepJobData;

export type MainQueue = Queue<MainJobData>;

export function createMainQueue(connection: Redis): MainQueue {
  return new Queue<MainJobData>(MAIN_QUEUE_NAME, { connection });
}

export type AutomationQueue = MainQueue;

/** Alias kompatibilitas (nama Fase 2A) untuk createMainQueue. */
export const createAutomationQueue = createMainQueue;

/**
 * Meng-enqueue evaluasi automation untuk satu event `message.received`.
 * Mengembalikan id job yang ada bila jobId yang sama sudah pernah
 * di-enqueue (BullMQ dedupe) — pemanggil tidak perlu mengecek duplikasi.
 */
export async function enqueueAutomationEvaluate(
  queue: MainQueue,
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

/**
 * Meng-enqueue respons agent untuk satu pesan inbound. Aman dipanggil
 * berulang: jobId diturunkan dari id pesan, BullMQ mengembalikan job yang
 * sudah ada.
 */
export async function enqueueAgentRespond(
  queue: MainQueue,
  data: AgentRespondJobData,
  options?: JobsOptions,
): Promise<string> {
  const job = await queue.add(AGENT_RESPOND_JOB, data, {
    jobId: agentRespondJobId(data.messageId),
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 1_000,
    ...options,
  });
  return job.id ?? agentRespondJobId(data.messageId);
}

/**
 * Meng-enqueue satu langkah sequence sebagai job TERTUNDA BullMQ.
 * `delayMs` dihitung pemanggil dari delay_minutes langkah (relay menggeser
 * titik mulai delay ke saat event ter-relay, ±2 dtk dari jadwal ideal —
 * toleransi yang terdokumentasi untuk staging). Aman dipanggil berulang:
 * jobId diturunkan dari (enrollmentId, posisi langkah).
 */
export async function enqueueSequenceStep(
  queue: MainQueue,
  data: SequenceStepJobData,
  delayMs: number,
  options?: JobsOptions,
): Promise<string> {
  const job = await queue.add(SEQUENCE_STEP_JOB, data, {
    jobId: sequenceStepJobId(data.enrollmentId, data.stepPosition),
    delay: Math.max(0, Math.floor(delayMs)),
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: 1_000,
    ...options,
  });
  return job.id ?? sequenceStepJobId(data.enrollmentId, data.stepPosition);
}

export {
  createRealtimePublisher,
  realtimeTenantChannel,
  REALTIME_TENANT_CHANNEL_PATTERN,
  REALTIME_TENANT_CHANNEL_PREFIX,
  type RealtimePublisher,
} from "./realtime";
