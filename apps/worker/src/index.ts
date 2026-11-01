import { Worker } from "bullmq";
import { loadEnv } from "@sahabat-kreator/config";
import { createDb } from "@sahabat-kreator/db";
import { createLlmProvider } from "@sahabat-kreator/ai";
import {
  evaluateInboundMessageForAutomations,
  relayUnpublishedOutboxEvents,
  respondToInboundMessage,
} from "@sahabat-kreator/core";
import {
  AGENT_RESPOND_JOB,
  AUTOMATION_EVALUATE_JOB,
  MAIN_QUEUE_NAME,
  createAutomationQueue,
  createRedisConnection,
  enqueueAgentRespond,
  enqueueAutomationEvaluate,
  type AgentRespondJobData,
  type AutomationEvaluateJobData,
  type MainJobData,
} from "@sahabat-kreator/queue";

/**
 * Worker Sahabat Kreator (Fase 2A) — proses terpisah dari API.
 *
 * Dua tanggung jawab:
 * 1. RELAY OUTBOX (pola polling, interval RELAY_INTERVAL_MS):
 *    mengklaim event `outbox_events` yang belum ter-publish (semua tenant,
 *    lewat policy `system_relay` + klaim FOR UPDATE SKIP LOCKED di core)
 *    dan menerjemahkannya:
 *      - `message.received` → enqueue job `automation.evaluate` dengan
 *        jobId deterministik dari id event (idempoten: event yang sama
 *        tidak pernah menghasilkan dua job).
 *      - tipe lain (mis. `message.queued`) → tidak ada konsumen relay saat
 *        ini; event tetap ditandai published agar antrean relay tidak
 *        menumpuk. (Konsumen `message.queued` adalah poller pengiriman di
 *        proses API yang membaca tabel messages langsung.)
 * 2. EVALUASI AUTOMATION (BullMQ Worker): job `automation.evaluate`
 *    menjalankan `evaluateInboundMessageForAutomations` di core — pencocokan
 *    keyword, pembuatan balasan `queued`, run, dan audit terjadi di sana
 *    dalam konteks RLS tenant.
 * 3. RESPONS AGENT (Fase 3A): bila evaluasi automation selesai TANPA
 *    tembakan, processor yang sama meng-enqueue job `agent.respond`
 *    (jobId deterministik dari id pesan). Job itu menjalankan
 *    `respondToInboundMessage` di core: retrieval KB full-text → provider
 *    LLM (mock default / OpenRouter via env) → eksekusi tool / draf
 *    saran → metering usage_ledger + audit. Balasan agent juga berhenti
 *    sebagai pesan `queued`; poller API yang mengirimnya lewat hub WS.
 *
 * Worker TIDAK mengirim pesan ke pengunjung: hub WebSocket webchat hidup
 * di proses API. Balasan automation berhenti sebagai pesan `queued`;
 * poller di API yang mendorongnya lewat hub (lihat README
 * @sahabat-kreator/queue soal jembatan lintas proses ini).
 */

const RELAY_INTERVAL_MS = 2_000;

const env = loadEnv();
if (!env.DATABASE_URL) {
  throw new Error("[worker] DATABASE_URL wajib diisi");
}
if (!env.REDIS_URL) {
  throw new Error("[worker] REDIS_URL wajib diisi");
}

const { db, pool } = createDb(env.DATABASE_URL);
const queueConnection = createRedisConnection(env.REDIS_URL);
const workerConnection = createRedisConnection(env.REDIS_URL);
const queue = createAutomationQueue(queueConnection);

// Provider LLM agent (Fase 3A): LLM_PROVIDER=mock (default, deterministik)
// atau openrouter (wajib OPENROUTER_API_KEY — fail-fast di createLlmProvider).
const llmProvider = createLlmProvider({
  provider: env.LLM_PROVIDER,
  openrouterApiKey: env.OPENROUTER_API_KEY,
  openrouterModel: env.OPENROUTER_MODEL,
});
console.log(`[worker] provider LLM agent: ${llmProvider.name}`);

const bullWorker = new Worker<MainJobData>(
  MAIN_QUEUE_NAME,
  async (job) => {
    if (job.name === AUTOMATION_EVALUATE_JOB) {
      const data = job.data as AutomationEvaluateJobData;
      const result = await evaluateInboundMessageForAutomations(db, {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        messageId: data.messageId,
      });
      if (result.fired.length > 0 || result.skippedDuplicates > 0) {
        console.log(
          `[worker] automation.evaluate event=${data.outboxEventId} fired=${result.fired.length} duplicates=${result.skippedDuplicates}`,
        );
      }
      // Fase 3A — urutan pasti keyword → AI: hanya bila evaluasi berjalan
      // dan TIDAK ada automation yang menembak (dan bukan duplikat dari
      // tembakan sebelumnya), pesan diteruskan ke agent. Agent sendiri
      // memeriksa ulang kelayakannya (agent aktif, ai_enabled, caps).
      if (
        result.evaluated &&
        result.fired.length === 0 &&
        result.skippedDuplicates === 0
      ) {
        await enqueueAgentRespond(queue, {
          tenantId: data.tenantId,
          conversationId: data.conversationId,
          messageId: data.messageId,
        });
      }
      return result;
    }
    if (job.name === AGENT_RESPOND_JOB) {
      const data = job.data as AgentRespondJobData;
      const result = await respondToInboundMessage(db, llmProvider, {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        messageId: data.messageId,
        // Untuk tool send_payment_link (Fase 4A): URL /pay/:code yang
        // dikirim agent harus absolut, berbasis URL publik aplikasi.
        publicBaseUrl: env.BETTER_AUTH_URL,
      });
      if (result.responded || result.reason) {
        console.log(
          `[worker] agent.respond message=${data.messageId} responded=${result.responded}` +
            (result.reason ? ` reason=${result.reason}` : "") +
            (result.mode ? ` mode=${result.mode}` : ""),
        );
      }
      return result;
    }
    throw new Error(`[worker] job tidak dikenal: ${job.name}`);
  },
  { connection: workerConnection, concurrency: 5 },
);

bullWorker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} gagal:`, err);
});
bullWorker.on("error", (err) => {
  console.error("[worker] bullmq worker error:", err);
});

// ---------------------------------------------------------------------------
// Relay outbox — satu siklus tidak boleh tumpang tindih dengan siklus lain
// di proses yang sama (klaim SKIP LOCKED tetap aman bila kelak ada >1 worker).
// ---------------------------------------------------------------------------
let relayRunning = false;
async function relayTick(): Promise<void> {
  if (relayRunning) return;
  relayRunning = true;
  try {
    const processed = await relayUnpublishedOutboxEvents(db, async (_tx, event) => {
      if (event.type !== "message.received") return;
      if (!event.tenantId) return;
      const payload = event.payload as {
        conversationId?: unknown;
        messageId?: unknown;
      };
      if (
        typeof payload.conversationId !== "string" ||
        typeof payload.messageId !== "string"
      ) {
        console.warn(
          `[worker] event message.received ${event.id} payload tidak lengkap — ditandai published tanpa job`,
        );
        return;
      }
      await enqueueAutomationEvaluate(queue, {
        tenantId: event.tenantId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        outboxEventId: event.id,
      });
    });
    if (processed > 0) {
      console.log(`[worker] outbox relay: ${processed} event ter-publish`);
    }
  } catch (err) {
    // Seluruh siklus rollback di core; event tetap unpublished & dicoba lagi.
    console.error("[worker] outbox relay gagal (akan dicoba lagi):", err);
  } finally {
    relayRunning = false;
  }
}

const relayTimer = setInterval(() => void relayTick(), RELAY_INTERVAL_MS);
void relayTick();

console.log(
  `[worker] Sahabat Kreator worker aktif — antrean "${MAIN_QUEUE_NAME}", relay outbox tiap ${RELAY_INTERVAL_MS}ms`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] menerima ${signal}, berhenti secara anggun...`);
  clearInterval(relayTimer);
  await bullWorker.close();
  await queue.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
