import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  integrationLog,
  type Database,
  type IntegrationLogRow,
} from "@sahabat-kreator/db";
import { withTenantDb, type DbTx } from "./tx";

/**
 * Log integrasi webhook & pengiriman (Fase 7B.1) — lapisan
 * OBSERVABILITAS di atas `webhook_inbox` (yang tetap menjadi lapisan
 * DEDUP provider sejak Fase 1A dan tidak berubah). Satu baris per hit
 * webhook (direction 'in') atau per percobaan kirim keluar poller
 * (direction 'out'), termasuk hit yang selama ini senyap: tanda tangan
 * salah, akun tak dikenal, akun disconnected, echo, duplikat, dan
 * konfigurasi platform yang belum terpasang.
 *
 * Aturan keras modul ini:
 * - Nilai secret/tanda tangan TIDAK PERNAH ditulis — hanya boolean
 *   `signatureValid`. Payload mentah disimpan DIBATASI ±32KB (di atas
 *   itu objek penanda `{ truncated, originalSize, preview }`).
 * - Penulisan BEST-EFFORT: `recordIntegrationLog` tidak pernah melempar.
 *   Route webhook membungkusnya lagi dalam try/catch; kegagalan menulis
 *   log tidak boleh mengubah respons webhook (200 tetap 200).
 * - RLS berlapis (migrasi 0028): penulisan hanya di bawah flag
 *   transaction-local `app.integration_log = 'ingest'`; bacaan tenant
 *   lewat konteks tenant biasa; baris platform (tenant_id NULL) hanya
 *   lewat flag `app.platform_settings = 'admin'` (pola 0022); prune
 *   hanya di bawah flag `app.integration_log = 'prune'`.
 * - Cakupan arah 'out' v1: HANYA dua poller pengirim provider —
 *   telegram (apps/api poller telegram) dan Meta messenger/instagram/
 *   whatsapp (apps/api poller meta). Flush webchat LEWAT GATEWAY
 *   REALTIME bukan percobaan API provider (serah-terima socket internal;
 *   sudah teraudit `message.sent` di audit_logs) dan SENGAJA di luar
 *   cakupan log ini.
 */

export type IntegrationLogDirection = "in" | "out";

/** Outcome terkendali arah masuk. */
export type IntegrationLogInboundOutcome =
  | "recorded"
  | "duplicate"
  | "ignored_disconnected"
  | "ignored_echo"
  | "ignored_status_only"
  | "rejected_signature"
  | "rejected_unconfigured"
  | "unresolved_account"
  | "error";

/** Outcome terkendali arah keluar. */
export type IntegrationLogOutboundOutcome = "sent" | "failed";

export type IntegrationLogOutcome =
  | IntegrationLogInboundOutcome
  | IntegrationLogOutboundOutcome;

/** Batas ukuran payload terserialisasi (±32KB); di atasnya ditruncate. */
export const INTEGRATION_LOG_PAYLOAD_MAX_CHARS = 32_768;
/** Retensi log integrasi (hari) — worker prune, pola purge Fase 6I. */
export const INTEGRATION_LOG_RETENTION_DAYS = 30;

export interface RecordIntegrationLogInput {
  direction: IntegrationLogDirection;
  /** 'telegram' | 'messenger' | 'instagram' | 'whatsapp' | 'meta' (pra-rute). */
  provider: string;
  tenantId?: string | null;
  channelAccountId?: string | null;
  /** Hanya arah 'out': pesan yang dicoba dikirim. */
  messageId?: string | null;
  /** Hanya arah 'in'; null = tidak berlaku / belum bisa dinilai. */
  signatureValid?: boolean | null;
  outcome: IntegrationLogOutcome;
  errorCode?: string | null;
  /** Ringkasan pendek buatan server (dipotong ke 255 char). */
  summary?: string | null;
  /** Payload mentah (arah 'in'); dibatasi oleh batas di atas. */
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Transaksi ber-flag (pola platform-settings/system_relay)
// ---------------------------------------------------------------------------

async function withIntegrationLogTx<T>(
  db: Database,
  flag: "ingest" | "prune",
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.integration_log', ${flag}, true)`,
    );
    return fn(tx as unknown as DbTx);
  });
}

async function withPlatformLogTx<T>(
  db: Database,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.platform_settings', 'admin', true)`,
    );
    return fn(tx as unknown as DbTx);
  });
}

// ---------------------------------------------------------------------------
// Serialisasi payload terbatas
// ---------------------------------------------------------------------------

/**
 * Menyiapkan payload untuk kolom jsonb: nilai yang terserialisasi
 * melebihi batas disimpan sebagai objek penanda berisi ukuran asli +
 * pratinjau awal, agar baris log tetap informatif tanpa menggelembungkan
 * tabel. Nilai yang tidak bisa diserialisasi (sirkular dsb.) diganti
 * penanda serupa.
 */
export function capIntegrationLogPayload(payload: unknown): unknown {
  if (payload === undefined || payload === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { truncated: true, originalSize: -1, preview: "[unserializable]" };
  }
  if (serialized === undefined) return null;
  if (serialized.length <= INTEGRATION_LOG_PAYLOAD_MAX_CHARS) return payload;
  return {
    truncated: true,
    originalSize: serialized.length,
    preview: serialized.slice(0, 1024),
  };
}

// ---------------------------------------------------------------------------
// Penulisan (best-effort — TIDAK PERNAH melempar)
// ---------------------------------------------------------------------------

/**
 * Menulis satu baris log integrasi. Mengembalikan true bila tersimpan.
 * Kegagalan apa pun (DB, RLS, serialisasi) ditelan dan dilaporkan false:
 * observabilitas tidak boleh menjatuhkan jalur webhook/pengiriman.
 */
export async function recordIntegrationLog(
  db: Database,
  input: RecordIntegrationLogInput,
): Promise<boolean> {
  try {
    await withIntegrationLogTx(db, "ingest", async (tx) => {
      await tx.insert(integrationLog).values({
        direction: input.direction,
        provider: input.provider.slice(0, 32),
        tenantId: input.tenantId ?? null,
        channelAccountId: input.channelAccountId ?? null,
        messageId: input.messageId ?? null,
        signatureValid: input.signatureValid ?? null,
        outcome: input.outcome,
        errorCode: input.errorCode ? input.errorCode.slice(0, 128) : null,
        summary: input.summary ? input.summary.slice(0, 255) : null,
        payload: capIntegrationLogPayload(input.payload),
      });
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bacaan tenant (owner/admin ditegakkan di lapisan API)
// ---------------------------------------------------------------------------

export interface ListIntegrationLogsInput {
  provider?: string;
  direction?: IntegrationLogDirection;
  outcome?: IntegrationLogOutcome;
  channelAccountId?: string;
  /** Kursor opaque dari halaman sebelumnya. */
  cursor?: string;
  /** Default 50, maksimum 100. */
  limit?: number;
}

export interface IntegrationLogPage {
  logs: IntegrationLogRow[];
  nextCursor: string | null;
}

interface LogCursor {
  createdAt: string;
  id: string;
}

function encodeLogCursor(row: IntegrationLogRow): string {
  const raw: LogCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
}

function decodeLogCursor(cursor: string | undefined): LogCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<LogCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Kursor rusak → diperlakukan sebagai halaman pertama (didokumentasikan).
  }
  return null;
}

function clampLogLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return 50;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

async function queryLogPage(
  tx: DbTx,
  input: ListIntegrationLogsInput,
  scope:
    | { kind: "tenant"; tenantId: string }
    | { kind: "platform-unresolved" },
): Promise<IntegrationLogPage> {
  const limit = clampLogLimit(input.limit);
  const conditions = [
    scope.kind === "tenant"
      ? eq(integrationLog.tenantId, scope.tenantId)
      : isNull(integrationLog.tenantId),
  ];
  if (input.provider) conditions.push(eq(integrationLog.provider, input.provider));
  if (input.direction) {
    conditions.push(eq(integrationLog.direction, input.direction));
  }
  if (input.outcome) conditions.push(eq(integrationLog.outcome, input.outcome));
  if (input.channelAccountId) {
    conditions.push(eq(integrationLog.channelAccountId, input.channelAccountId));
  }
  const cursor = decodeLogCursor(input.cursor);
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    conditions.push(
      or(
        lt(integrationLog.createdAt, cursorDate),
        and(
          eq(integrationLog.createdAt, cursorDate),
          lt(integrationLog.id, cursor.id),
        ),
      )!,
    );
  }
  const rows = await tx
    .select()
    .from(integrationLog)
    .where(and(...conditions))
    .orderBy(desc(integrationLog.createdAt), desc(integrationLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    logs: pageRows,
    nextCursor: hasMore
      ? encodeLogCursor(pageRows[pageRows.length - 1])
      : null,
  };
}

/** Daftar log milik satu tenant (konteks RLS tenant; terbaru dulu). */
export async function listIntegrationLogs(
  db: Database,
  tenantId: string,
  input: ListIntegrationLogsInput = {},
): Promise<IntegrationLogPage> {
  return withTenantDb(db, tenantId, (tx) =>
    queryLogPage(tx, input, { kind: "tenant", tenantId }),
  );
}

/** Satu baris log milik tenant (termasuk payload tersimpan); null bila tak ada/bukan miliknya. */
export async function getIntegrationLog(
  db: Database,
  tenantId: string,
  logId: string,
): Promise<IntegrationLogRow | null> {
  return withTenantDb(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationLog)
      .where(
        and(eq(integrationLog.id, logId), eq(integrationLog.tenantId, tenantId)),
      )
      .limit(1);
    return row ?? null;
  });
}

// ---------------------------------------------------------------------------
// Bacaan platform: baris tenant NULL ("unresolved") — admin platform saja
// ---------------------------------------------------------------------------

/** Daftar baris platform (tenant_id NULL) — hanya transaksi ber-flag admin. */
export async function listUnresolvedIntegrationLogs(
  db: Database,
  input: ListIntegrationLogsInput = {},
): Promise<IntegrationLogPage> {
  return withPlatformLogTx(db, (tx) =>
    queryLogPage(tx, input, { kind: "platform-unresolved" }),
  );
}

/** Satu baris platform (tenant_id NULL); null bila tak ada/bertenant. */
export async function getUnresolvedIntegrationLog(
  db: Database,
  logId: string,
): Promise<IntegrationLogRow | null> {
  return withPlatformLogTx(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationLog)
      .where(and(eq(integrationLog.id, logId), isNull(integrationLog.tenantId)))
      .limit(1);
    return row ?? null;
  });
}

// ---------------------------------------------------------------------------
// Retensi (worker)
// ---------------------------------------------------------------------------

/**
 * Menghapus baris log yang lebih tua dari retensi (default 30 hari) di
 * bawah flag prune, per batch agar transaksi tetap pendek. Mengembalikan
 * jumlah baris terhapus. Dipanggil poller worker + skrip run-once
 * (pola purge channel Fase 6I).
 */
const PRUNE_BATCH_SIZE = 5000;

export async function pruneIntegrationLogs(
  db: Database,
  retentionDays: number = INTEGRATION_LOG_RETENTION_DAYS,
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let deleted = 0;
  for (;;) {
    const batch = await withIntegrationLogTx(db, "prune", async (tx) => {
      const rows = await tx
        .delete(integrationLog)
        .where(
          inArray(
            integrationLog.id,
            tx
              .select({ id: integrationLog.id })
              .from(integrationLog)
              .where(lt(integrationLog.createdAt, cutoff))
              .limit(PRUNE_BATCH_SIZE),
          ),
        )
        .returning({ id: integrationLog.id });
      return rows.length;
    });
    deleted += batch;
    if (batch < PRUNE_BATCH_SIZE) break;
  }
  return { deleted };
}
