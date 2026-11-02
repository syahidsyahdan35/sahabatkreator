import { Worker } from "bullmq";
import { loadEnv } from "@sahabat-kreator/config";
import { createDb } from "@sahabat-kreator/db";
import { createLlmProvider, type LlmProvider } from "@sahabat-kreator/ai";
import {
  INTEGRATION_LOG_RETENTION_DAYS,
  evaluateInboundMessageForAutomations,
  executeSequenceStep,
  pruneIntegrationLogs,
  purgeExpiredTrashedChannels,
  relayUnpublishedOutboxEvents,
  resolveOpenRouterConfig,
  respondToInboundMessage,
  type PlatformSettingsOptions,
} from "@sahabat-kreator/core";
import {
  AGENT_RESPOND_JOB,
  AUTOMATION_EVALUATE_JOB,
  MAIN_QUEUE_NAME,
  SEQUENCE_STEP_JOB,
  createAutomationQueue,
  createRealtimePublisher,
  createRedisConnection,
  enqueueAgentRespond,
  enqueueAutomationEvaluate,
  enqueueSequenceStep,
  type AgentRespondJobData,
  type AutomationEvaluateJobData,
  type MainJobData,
  type SequenceStepJobData,
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
 * 4. LANGKAH SEQUENCE (Fase 2C): relay juga menerjemahkan event outbox
 *    `sequence.step_due` menjadi job tertunda `sequence.step`
 *    (delay = delay_minutes langkah, jobId `seq-<enrollmentId>-<posisi>`).
 *    Processor-nya menjalankan `executeSequenceStep` di core: kirim satu
 *    langkah sebagai pesan `queued`, majukan enrollment, jadwalkan
 *    langkah berikut (atau selesaikan). Pesan pemicu sequence dihitung
 *    sebagai tembakan automation — tidak diteruskan ke agent.
 *
 * Worker TIDAK mengirim pesan ke pengunjung: sejak Fase 6G socket
 * pengunjung & dashboard milik apps/realtime. Balasan automation/agent/
 * sequence berhenti sebagai pesan `queued`; worker menerbitkan nudge
 * `message.queued` ke Redis pub/sub setelah job selesai, dan
 * apps/realtime mem-flush-nya ke pengunjung webchat yang terhubung
 * (→ `sent`) + mendorong nudge ke dashboard (lihat @sahabat-kreator/queue
 * soal jembatan pub/sub ini). Nudge bersifat fail-soft — Redis mati
 * hanya menurunkan kesegaran ke polling fallback klien.
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
// Penerbit nudge realtime (Fase 6G) — koneksi Redis khusus publish,
// terpisah dari koneksi BullMQ (lihat @sahabat-kreator/queue/realtime).
const realtimePublisher = createRealtimePublisher(env.REDIS_URL);

// Provider LLM agent (Fase 3A; resolusi per job sejak Fase 6C):
// provider TIDAK lagi dibekukan saat boot. Setiap job agent.respond
// me-resolve kunci OpenRouter efektif lewat resolver core Panel Admin —
// panel terenkripsi lebih dulu, env fallback (cache ±60 dtk di core) —
// jadi kunci yang disimpan/diubah pemilik platform di panel berlaku
// tanpa restart worker:
//   - ada kunci efektif → OpenRouterProvider (model: panel → env →
//     default provider);
//   - tidak ada kunci di mana pun → MockProvider (perilaku staging 3A);
//   - LLM_PROVIDER=openrouter eksplisit TANPA kunci di mana pun →
//     createLlmProvider melempar (salah konfigurasi tetap GAGAL KERAS,
//     tidak diam-diam jatuh ke mock — sama seperti fail-fast boot 3A;
//     resolusi awal di bawah menjaga kegagalan itu terlihat saat start).
const platformSettingsOptions: PlatformSettingsOptions = {
  masterSecret: env.PLATFORM_SETTINGS_SECRET,
  env: {
    openrouter_api_key: env.OPENROUTER_API_KEY,
    openrouter_model: env.OPENROUTER_MODEL,
  },
};

async function resolveAgentLlmProvider(): Promise<LlmProvider> {
  const orConfig = await resolveOpenRouterConfig(db, platformSettingsOptions);
  return createLlmProvider({
    provider: orConfig ? "openrouter" : env.LLM_PROVIDER,
    openrouterApiKey: orConfig?.apiKey,
    openrouterModel: orConfig?.model,
  });
}

void resolveAgentLlmProvider()
  .then((provider) => {
    console.log(`[worker] provider LLM agent (resolusi awal): ${provider.name}`);
  })
  .catch((err) => {
    console.error("[worker] resolusi provider LLM gagal saat start:", err);
    process.exit(1);
  });

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
      // Fase 6G: automation yang menembak membuat pesan outbound
      // `queued` — nudge agar apps/realtime mem-flush ke pengunjung
      // webchat & dashboard menyegar (terbit SETELAH core commit).
      if (result.fired.length > 0) {
        await realtimePublisher.publishNudge({
          kind: "message.queued",
          tenantId: data.tenantId,
          conversationId: data.conversationId,
        });
      }
      // Fase 3A — urutan pasti keyword → AI: hanya bila evaluasi berjalan
      // dan TIDAK ada automation yang menembak (dan bukan duplikat dari
      // tembakan sebelumnya), pesan diteruskan ke agent. Agent sendiri
      // memeriksa ulang kelayakannya (agent aktif, ai_enabled, caps).
      // Fase 2C: pendaftaran sequence dihitung sebagai tembakan (fired),
      // jadi pesan pemicu sequence TIDAK pernah diteruskan ke agent.
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
    if (job.name === SEQUENCE_STEP_JOB) {
      // Fase 2C: satu langkah sequence. Eksekusi, aturan berhenti, dan
      // penjadwalan langkah berikutnya (lewat event outbox) ada di core;
      // worker hanya menjalankan dan mencatat hasilnya.
      const data = job.data as SequenceStepJobData;
      const result = await executeSequenceStep(db, {
        tenantId: data.tenantId,
        enrollmentId: data.enrollmentId,
        stepPosition: data.stepPosition,
      });
      // Fase 6G: langkah tereksekusi = pesan `queued` baru → nudge.
      if (result.executed && result.conversationId) {
        await realtimePublisher.publishNudge({
          kind: "message.queued",
          tenantId: data.tenantId,
          conversationId: result.conversationId,
        });
      }
      console.log(
        `[worker] sequence.step enrollment=${data.enrollmentId} position=${data.stepPosition} executed=${result.executed}` +
          (result.reason ? ` reason=${result.reason}` : "") +
          (result.nextStepPosition !== undefined
            ? ` next=${result.nextStepPosition ?? "done"}`
            : ""),
      );
      return result;
    }
    if (job.name === AGENT_RESPOND_JOB) {
      const data = job.data as AgentRespondJobData;
      // Fase 6C: provider di-resolve per job (panel → env; lihat di atas).
      const llmProvider = await resolveAgentLlmProvider();
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
      // Fase 6G: balasan agent (mode auto) = pesan `queued` baru → nudge
      // pengiriman; draf saran (mode suggest) → nudge khusus agar badge
      // persetujuan dashboard menyegar seketika.
      if (result.responded && result.outboundMessageId) {
        await realtimePublisher.publishNudge({
          kind: "message.queued",
          tenantId: data.tenantId,
          conversationId: data.conversationId,
        });
      } else if (result.suggestionId) {
        await realtimePublisher.publishNudge({
          kind: "agent.suggestion",
          tenantId: data.tenantId,
          conversationId: data.conversationId,
        });
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
      if (!event.tenantId) return;
      // Fase 2C: langkah sequence jatuh tempo → job BullMQ TERTUNDA.
      // Titik mulai delay digeser ke saat event ter-relay (±2 dtk dari
      // jadwal ideal di next_run_at) — toleransi terdokumentasi.
      if (event.type === "sequence.step_due") {
        const payload = event.payload as {
          enrollmentId?: unknown;
          stepPosition?: unknown;
          delayMinutes?: unknown;
        };
        if (
          typeof payload.enrollmentId !== "string" ||
          typeof payload.stepPosition !== "number" ||
          typeof payload.delayMinutes !== "number"
        ) {
          console.warn(
            `[worker] event sequence.step_due ${event.id} payload tidak lengkap — ditandai published tanpa job`,
          );
          return;
        }
        await enqueueSequenceStep(
          queue,
          {
            tenantId: event.tenantId,
            enrollmentId: payload.enrollmentId,
            stepPosition: payload.stepPosition,
          },
          payload.delayMinutes * 60_000,
        );
        return;
      }
      if (event.type !== "message.received") return;
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

// ---------------------------------------------------------------------------
// Purge Sampah channel (Fase 6I): akun channel yang dibuang ke Sampah
// lebih dari 30 hari lalu dihapus PERMANEN oleh core
// (purgeExpiredTrashedChannels — satu transaksi per akun, audit
// `channel.purged` dengan hitungan). Pola poller yang sama seperti relay
// outbox: jalan sekali saat boot lalu tiap jam, dengan penjaga anti-
// tumpang-tindih. Tidak memakai job BullMQ terjadwal: tidak ada antrean
// yang perlu diantar — cukup pemindaian berkala yang idempoten. Jalan
// run-once untuk pengujian/operasi: `pnpm purge:channels` (skrip
// scripts/purge-trashed-channels.ts).
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let purgeRunning = false;
async function purgeTick(): Promise<void> {
  if (purgeRunning) return;
  purgeRunning = true;
  try {
    const result = await purgeExpiredTrashedChannels(db);
    for (const p of result.purged) {
      console.log(
        `[worker] channel purge: ${p.channelAccountId} (tenant ${p.tenantId}) terhapus permanen — ${p.counts.conversations} percakapan, ${p.counts.messages} pesan`,
      );
    }
    for (const f of result.failed) {
      console.error(
        `[worker] channel purge GAGAL untuk ${f.channelAccountId} (tenant ${f.tenantId}): ${f.error}`,
      );
    }
  } catch (err) {
    console.error("[worker] channel purge gagal (akan dicoba lagi):", err);
  } finally {
    purgeRunning = false;
  }
}
const purgeTimer = setInterval(() => void purgeTick(), PURGE_INTERVAL_MS);
void purgeTick();

// ---------------------------------------------------------------------------
// Prune log integrasi (Fase 7B.1): baris `integration_log` lebih tua dari
// retensi (30 hari) dihapus oleh core `pruneIntegrationLogs` di bawah
// flag RLS prune. Pola poller yang sama seperti purge Sampah: sekali
// saat boot lalu tiap jam, penjaga anti-tumpang-tindih, tanpa BullMQ.
// Jalan run-once untuk pengujian/operasi: `pnpm prune:logs` (skrip
// scripts/prune-integration-logs.ts).
const LOG_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let logPruneRunning = false;
async function logPruneTick(): Promise<void> {
  if (logPruneRunning) return;
  logPruneRunning = true;
  try {
    const result = await pruneIntegrationLogs(db);
    if (result.deleted > 0) {
      console.log(
        `[worker] integration log prune: ${result.deleted} baris >${INTEGRATION_LOG_RETENTION_DAYS} hari terhapus`,
      );
    }
  } catch (err) {
    console.error("[worker] integration log prune gagal (akan dicoba lagi):", err);
  } finally {
    logPruneRunning = false;
  }
}
const logPruneTimer = setInterval(() => void logPruneTick(), LOG_PRUNE_INTERVAL_MS);
void logPruneTick();

console.log(
  `[worker] Sahabat Kreator worker aktif — antrean "${MAIN_QUEUE_NAME}", relay outbox tiap ${RELAY_INTERVAL_MS}ms`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] menerima ${signal}, berhenti secara anggun...`);
  clearInterval(relayTimer);
  clearInterval(purgeTimer);
  clearInterval(logPruneTimer);
  await bullWorker.close();
  await queue.close();
  realtimePublisher.close();
  queueConnection.disconnect();
  workerConnection.disconnect();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
