import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./identity";
import { contacts, conversations, messages } from "./inbox";

/**
 * Kelompok Flow (Fase 8A — Flow Engine):
 * - flows          : satu definisi alur otomatisasi berbentuk GRAF
 *                    (jsonb `graph` — format kontrak di
 *                    @sahabat-kreator/contracts: nodes + edges, tepat
 *                    satu node trigger). Status draft|active|archived.
 *                    Graf DRAFT boleh belum sah; validasi menyeluruh
 *                    terjadi di core saat aktivasi (FLOW_GRAPH_INVALID).
 * - flow_runs      : satu eksekusi flow untuk satu (flow, pesan
 *                    pemicu) — unik parsial di DB sebagai idempotensi
 *                    terakhir. Status running|waiting|completed|failed|
 *                    cancelled. `current_node_id` + `next_step_seq`
 *                    adalah penanda resume eksekutor worker; `context`
 *                    jsonb menyimpan konteks eksekusi (teks pesan
 *                    pemicu untuk predikat message_contains).
 * - flow_run_steps : log per langkah (observabilitas yang diadopsi
 *                    dari riset referensi): urutan (seq), node, tipe,
 *                    ringkasan hasil terstruktur, error bila gagal.
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS
 * (migrasi 0031). Eksekutor worker berjalan dalam konteks tenant
 * pemilik run (job membawa tenantId) — tidak ada lengan lintas tenant.
 */

export const flowStatusEnum = pgEnum("flow_status", [
  "draft",
  "active",
  "archived",
]);

export const flowRunStatusEnum = pgEnum("flow_run_status", [
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const flows = pgTable(
  "flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Nama internal flow (tidak dikirim ke kontak). */
    name: varchar("name", { length: 255 }).notNull(),
    status: flowStatusEnum("status").notNull().default("draft"),
    /**
     * Graf flow (kontrak FlowGraph di @sahabat-kreator/contracts):
     * { nodes: [{id, type, config}], edges: [{from, to, branch?}] }.
     * Disimpan apa adanya selama draft; divalidasi kontrak saat buat/
     * edit (bentuk) dan divalidasi semantik penuh saat aktivasi (core).
     */
    graph: jsonb("graph").notNull().default({ nodes: [], edges: [] }),
    /** User pembuat — informasional, SET NULL bila user hilang. */
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flows_tenant_id_idx").on(t.tenantId),
    index("flows_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const flowRuns = pgTable(
  "flow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flowId: uuid("flow_id")
      .notNull()
      .references(() => flows.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Pesan masuk yang memulai run ini (idempotensi: unik per flow). */
    triggerMessageId: uuid("trigger_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: flowRunStatusEnum("status").notNull().default("running"),
    /** Node yang akan dieksekusi langkah berikutnya; null bila terminal. */
    currentNodeId: varchar("current_node_id", { length: 128 }),
    /**
     * Nomor urut langkah BERIKUTNYA (1-based). jobId `flow.step`
     * diturunkan dari (runId, next_step_seq) — enqueue/job ganda untuk
     * resume yang sama selalu menunjuk job yang sama, dan eksekusi
     * menolak seq basi.
     */
    nextStepSeq: integer("next_step_seq").notNull().default(1),
    /** Jumlah langkah yang sudah dieksekusi (penjaga cap langkah). */
    stepCount: integer("step_count").notNull().default(0),
    /**
     * Konteks eksekusi: { triggerText } — teks pesan pemicu (untuk
     * predikat message_contains) + fakta langkah yang perlu bertahan
     * lintas resume (mis. outboundMessageId terakhir).
     */
    context: jsonb("context").notNull().default({}),
    /** Alasan terminal non-sukses: step_cap_exceeded, contact_opted_out, dst. */
    errorCode: varchar("error_code", { length: 128 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flow_runs_tenant_id_idx").on(t.tenantId),
    index("flow_runs_flow_id_idx").on(t.flowId),
    index("flow_runs_conversation_id_idx").on(t.conversationId),
    index("flow_runs_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("flow_runs_flow_trigger_message_unique")
      .on(t.flowId, t.triggerMessageId)
      .where(sql`${t.triggerMessageId} IS NOT NULL`),
  ],
);

export const flowRunSteps = pgTable(
  "flow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => flowRuns.id, { onDelete: "cascade" }),
    /** Nomor urut langkah dalam run (1-based, unik per run). */
    seq: integer("seq").notNull(),
    /** Id node di graf yang dieksekusi langkah ini. */
    nodeId: varchar("node_id", { length: 128 }).notNull(),
    /** Tipe node saat eksekusi (denormalisasi dari graf). */
    nodeType: varchar("node_type", { length: 64 }).notNull(),
    /** Ringkasan hasil terstruktur (branch terpilih, pesan terkirim, dst). */
    detail: jsonb("detail").notNull().default({}),
    /** Pesan error bila langkah gagal (run ikut failed); null bila sukses. */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flow_run_steps_tenant_id_idx").on(t.tenantId),
    index("flow_run_steps_run_id_idx").on(t.runId),
    uniqueIndex("flow_run_steps_run_seq_unique").on(t.runId, t.seq),
  ],
);

export type Flow = typeof flows.$inferSelect;
export type NewFlow = typeof flows.$inferInsert;
export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;
export type FlowRunStep = typeof flowRunSteps.$inferSelect;
export type NewFlowRunStep = typeof flowRunSteps.$inferInsert;
