import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { findFlowTemplate } from "@sahabat-kreator/contracts";
import {
  auditLogs,
  automationRuns,
  automationSteps,
  automations,
  contacts,
  conversations,
  flowExperimentAssignments,
  flowRunSteps,
  flowRuns,
  flows,
  messages,
  outboxEvents,
  products,
  sequenceEnrollments,
  type Contact,
  type Conversation,
  type Database,
  type Flow,
  type FlowRun,
  type FlowRunStep,
} from "@sahabat-kreator/db";
import type { EmbeddingProvider, LlmProvider } from "@sahabat-kreator/ai";
import { withTenantDb, type DbTx } from "./tx";
import {
  experimentBucket,
  flowBranchForBucket,
  flowExperimentKey,
} from "./experiments";
import { renderMessageText } from "./render-text";
import { respondToInboundMessage } from "./agent-runtime";
import { buildPaymentUrl, createPaymentLink } from "./products";

/**
 * Flow Engine (Fase 8A) — eksekutor graf node di worker.
 *
 * FORMAT GRAF adalah kontrak di @sahabat-kreator/contracts (`FlowGraph`):
 * { nodes: [{id, type, config}], edges: [{from, to, branch?}] }, tepat
 * satu node `trigger`. Modul ini punya tiga sisi:
 *
 * 1. MANAJEMEN (API dashboard): CRUD flow + aktivasi dengan validasi
 *    graf menyeluruh (`validateFlowGraph`). Graf draft boleh belum sah;
 *    yang ditegakkan di sini: edit hanya saat draft, transisi status
 *    yang sah, dan aktivasi menolak graf rusak dengan daftar masalah
 *    terstruktur (kode FLOW_GRAPH_INVALID di lapisan API).
 * 2. PEMICU (dipanggil evaluasi pesan masuk di automations.ts SETELAH
 *    pencocokan automation keyword/sequence): flow AKTIF yang
 *    trigger-nya cocok memulai satu run. Idempotensi berlapis: cek run
 *    yang sudah ada + index unik parsial (flow_id, trigger_message_id).
 *    Pesan dari kontak opt-out tidak memulai run baru dan MEMBATALKAN
 *    run `waiting` di percakapan itu (konsisten aturan opt-out
 *    sequence; audit `flow.run_cancelled`).
 * 3. EKSEKUSI (worker, job `flow.step`): `executeFlowStep` menjalankan
 *    node demi node — satu transaksi tenant per node — sampai run
 *    menunggu (node `delay`: status `waiting` + event outbox
 *    `flow.step_due` yang diterjemahkan relay menjadi job tertunda
 *    dengan jobId `flow-<runId>-<seq>`) atau terminal. Setiap node
 *    menulis satu baris `flow_run_steps` (log per langkah). Cap
 *    FLOW_MAX_STEPS langkah per run menahan graf melingkar: run
 *    `failed` beralasan `step_cap_exceeded`, worker tetap sehat.
 *
 * KEPUTUSAN DESAIN v1 (terdokumentasi di DEPLOY-STAGING.md):
 * - Balasan kontak biasa TIDAK membatalkan run flow (berbeda dengan
 *   sequence 2C yang berhenti saat kontak membalas): flow adalah alur
 *   percakapan yang memang mengharapkan balasan di tengah jalan
 *   (mis. sesudah node ai_response). Yang membatalkan run: opt-out
 *   kontak dan cap langkah.
 * - Menonaktifkan/mengarsipkan flow TIDAK membatalkan run yang sedang
 *   berjalan (konsisten sequence: is_active hanya memblokir pemicu
 *   baru) — run menyelesaikan graf versi SAAT RUN DIMULAI? Tidak:
 *   eksekutor membaca graf flow saat ini. Mengedit graf flow aktif
 *   memang dicegah (edit hanya draft), jadi graf tidak berubah di
 *   bawah run yang hidup kecuali lewat nonaktifkan→edit→aktifkan;
 *   risiko itu diterima v1 dan dicatat.
 * - Node `ai_response` memanggil jalur agent.respond yang ADA
 *   (`respondToInboundMessage`) untuk pesan pemicu run: mode auto →
 *   balasan terkirim; suggest → saran tercatat; agent tak ada/
 *   nonaktif untuk percakapan → langkah `skipped` beralasan, run
 *   lanjut (BUKAN crash).
 *
 * FASE 12A — enam tipe node baru (kontrak didokumentasikan penuh di
 * packages/contracts): set_field, http_request, goto_flow, ab_split,
 * send_payment_link, wait_reply. Keputusan desain yang mengikat:
 * - http_request TIDAK PERNAH menggagalkan run: kegagalan jaringan/
 *   non-2xx tercatat di detail langkah (`http_error`) dan run lanjut
 *   ke node berikutnya. Timeout 10 detik; substitusi variabel sempit
 *   ({name} + {{field:<key>}}, tanpa spintax).
 * - goto_flow memulai run BARU (trigger_message_id NULL — migrasi
 *   0038) dan menyelesaikan run asal; kedalaman rantai di context
 *   (`gotoDepth`, maks FLOW_GOTO_MAX_DEPTH) menahan siklus A→B→A.
 * - wait_reply parkir PADA nodenya (context.wait {nodeId, deadline,
 *   parkedAt}): balasan kontak melanjutkannya lewat branch "replied"
 *   dari jalur evaluasi pesan masuk (pesan yang sama TETAP diproses
 *   pemicu lain seperti biasa), tenggat lewat → job resume yang sama
 *   menjalankan branch "timeout". Opt-out membatalkan seperti delay.
 */

export const FLOW_MAX_STEPS = 100;

/** Kedalaman rantai goto_flow maksimum (context.gotoDepth run baru). */
export const FLOW_GOTO_MAX_DEPTH = 5;

/** Timeout permintaan node http_request (milidetik). */
export const FLOW_HTTP_TIMEOUT_MS = 10_000;

export type FlowStatus = Flow["status"];
export type FlowRunStatus = FlowRun["status"];

export interface FlowGraphNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  /**
   * Posisi canvas builder (Fase 8B) — metadata tampilan yang dibawa apa
   * adanya oleh normalisasi agar round-trip API utuh; eksekutor tidak
   * pernah membacanya.
   */
  position?: { x: number; y: number };
}

/** Cabang edge — selaras FlowEdgeBranchSchema di kontrak. */
export type FlowBranch = "yes" | "no" | "a" | "b" | "replied" | "timeout";

export interface FlowGraphEdge {
  from: string;
  to: string;
  branch?: FlowBranch;
}

export interface FlowGraphData {
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
}

const NODE_TYPES = new Set([
  "trigger",
  "send_message",
  "condition",
  "delay",
  "add_tag",
  "remove_tag",
  "set_stage",
  "enroll_sequence",
  "ai_response",
  "handoff",
  "end",
  // Fase 12A
  "set_field",
  "http_request",
  "goto_flow",
  "ab_split",
  "send_payment_link",
  "wait_reply",
]);

const FLOW_BRANCHES: readonly FlowBranch[] = [
  "yes",
  "no",
  "a",
  "b",
  "replied",
  "timeout",
];

function isValidFlowPosition(
  value: unknown,
): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false;
  const p = value as { x?: unknown; y?: unknown };
  return (
    typeof p.x === "number" &&
    Number.isFinite(p.x) &&
    typeof p.y === "number" &&
    Number.isFinite(p.y)
  );
}

/** Normalisasi jsonb graf menjadi bentuk kerja (defensif terhadap data lama). */
export function normalizeFlowGraph(raw: unknown): FlowGraphData {
  const graph = (raw ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodes: FlowGraphNode[] = Array.isArray(graph.nodes)
    ? graph.nodes
        .filter(
          (n): n is FlowGraphNode =>
            typeof n === "object" &&
            n !== null &&
            typeof (n as FlowGraphNode).id === "string" &&
            typeof (n as FlowGraphNode).type === "string",
        )
        .map((n) => ({
          id: n.id,
          type: n.type,
          config:
            typeof n.config === "object" && n.config !== null
              ? (n.config as Record<string, unknown>)
              : {},
          // `position` builder (8B) dipertahankan hanya bila bentuknya
          // sah (dua angka finite); selain itu dibuang diam-diam —
          // normalisasi memang defensif terhadap data lama/rusak.
          ...(isValidFlowPosition(n.position)
            ? { position: { x: n.position.x, y: n.position.y } }
            : {}),
        }))
    : [];
  const edges: FlowGraphEdge[] = Array.isArray(graph.edges)
    ? graph.edges
        .filter(
          (e): e is FlowGraphEdge =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as FlowGraphEdge).from === "string" &&
            typeof (e as FlowGraphEdge).to === "string",
        )
        .map((e) => ({
          from: e.from,
          to: e.to,
          branch:
            typeof e.branch === "string" &&
            (FLOW_BRANCHES as readonly string[]).includes(e.branch)
              ? (e.branch as FlowBranch)
              : undefined,
        }))
    : [];
  return { nodes, edges };
}

function triggerOf(graph: FlowGraphData): FlowGraphNode | null {
  return graph.nodes.find((n) => n.type === "trigger") ?? null;
}

/** Node pertama sesudah trigger (edge keluar trigger tanpa branch). */
function firstNodeAfterTrigger(graph: FlowGraphData): string | null {
  const trigger = triggerOf(graph);
  if (!trigger) return null;
  const edge = graph.edges.find((e) => e.from === trigger.id);
  return edge ? edge.to : null;
}

/** Node lanjutan: untuk node bercabang wajib menyebut branch; selain itu edge pertama. */
function nextNodeId(
  graph: FlowGraphData,
  nodeId: string,
  branch?: FlowBranch,
): string | null {
  const out = graph.edges.filter((e) => e.from === nodeId);
  if (branch) {
    const picked = out.find((e) => e.branch === branch);
    return picked ? picked.to : null;
  }
  const picked = out.find((e) => e.branch === undefined) ?? out[0];
  return picked ? picked.to : null;
}

/** Bentuk `flow_runs.context` yang dibaca eksekutor (defensif). */
export interface FlowRunContextData {
  triggerText?: string;
  /** Kedalaman rantai goto_flow (0/absen = run dari pesan masuk). */
  gotoDepth?: number;
  /** Pesan pemicu run akar — untuk run yang lahir dari goto_flow. */
  rootTriggerMessageId?: string;
  /** Parkir wait_reply: node yang menunggu + tenggatnya. */
  wait?: { nodeId: string; deadline: string; parkedAt: string };
  [key: string]: unknown;
}

function runContextOf(run: FlowRun): FlowRunContextData {
  const raw = (run.context ?? {}) as Record<string, unknown>;
  const out: FlowRunContextData = { ...raw };
  if (typeof raw.triggerText !== "string") delete out.triggerText;
  if (typeof raw.gotoDepth !== "number") delete out.gotoDepth;
  if (typeof raw.rootTriggerMessageId !== "string") {
    delete out.rootTriggerMessageId;
  }
  const w = raw.wait as
    | { nodeId?: unknown; deadline?: unknown; parkedAt?: unknown }
    | undefined;
  if (
    typeof w !== "object" ||
    w === null ||
    typeof w.nodeId !== "string" ||
    typeof w.deadline !== "string"
  ) {
    delete out.wait;
  } else {
    out.wait = {
      nodeId: w.nodeId,
      deadline: w.deadline,
      parkedAt: typeof w.parkedAt === "string" ? w.parkedAt : w.deadline,
    };
  }
  return out;
}

/** Id pesan pemicu efektif run (langsung, atau akar rantai goto). */
function effectiveTriggerMessageId(run: FlowRun): string | null {
  if (run.triggerMessageId) return run.triggerMessageId;
  const ctx = runContextOf(run);
  return ctx.rootTriggerMessageId ?? null;
}

/**
 * Substitusi variabel node http_request (Fase 12A) — SENGAJA SEMPIT,
 * selaras kontrak: `{name}` → nama kontak; `{{field:<key>}}` → nilai
 * contacts.custom_fields[key] (string apa adanya; nilai non-string
 * di-JSON-kan; kunci hilang/null → string kosong). TANPA spintax —
 * payload HTTP harus deterministik. Urutan: field dulu, lalu {name}.
 */
export function renderFlowHttpTemplate(
  template: string,
  contact: Contact | null,
): string {
  const custom = (contact?.customFields ?? {}) as Record<string, unknown>;
  const withFields = template.replace(
    /\{\{field:([^}]+)\}\}/g,
    (_match, key: string) => {
      const value = custom[key.trim()];
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  );
  return withFields.replaceAll("{name}", contact?.name ?? "");
}

// ---------------------------------------------------------------------------
// Validasi graf (aktivasi)
// ---------------------------------------------------------------------------

export interface FlowGraphIssue {
  code: string;
  severity: "error" | "warning";
  nodeId: string | null;
  message: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const UUID_LIKE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id rujukan yang bukan UUID pasti tidak ditemukan (menghindari error PG). */
function isUuidLike(v: string): boolean {
  return UUID_LIKE_RE.test(v);
}

/**
 * Validasi bentuk config satu node (tanpa konteks DB). Mengembalikan
 * daftar masalah; kosong = sah. Dipakai validasi aktivasi penuh.
 */
export function validateFlowNodeConfig(node: FlowGraphNode): FlowGraphIssue[] {
  const issues: FlowGraphIssue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ code, severity: "error", nodeId: node.id, message });
  const c = node.config;
  switch (node.type) {
    case "trigger": {
      if (c.kind === "keyword") {
        if (
          !Array.isArray(c.keywords) ||
          c.keywords.length === 0 ||
          !c.keywords.every(isNonEmptyString)
        ) {
          err("TRIGGER_KEYWORDS_REQUIRED", "Trigger keyword membutuhkan minimal satu keyword non-kosong");
        }
        if (c.match !== "exact" && c.match !== "contains") {
          err("TRIGGER_MATCH_INVALID", "Trigger keyword membutuhkan match 'exact' atau 'contains'");
        }
      } else if (c.kind !== "any_message") {
        err("TRIGGER_KIND_INVALID", "Trigger membutuhkan kind 'keyword' atau 'any_message'");
      }
      break;
    }
    case "send_message":
      if (!isNonEmptyString(c.text)) {
        err("SEND_TEXT_REQUIRED", "Node send_message membutuhkan config.text non-kosong");
      }
      break;
    case "condition": {
      if (c.predicate === "has_tag") {
        if (!isNonEmptyString(c.tag)) err("CONDITION_TAG_REQUIRED", "Predikat has_tag membutuhkan config.tag");
      } else if (c.predicate === "stage_equals") {
        if (!isNonEmptyString(c.stage)) err("CONDITION_STAGE_REQUIRED", "Predikat stage_equals membutuhkan config.stage");
      } else if (c.predicate === "field_equals") {
        if (c.field !== "name" && c.field !== "phone" && c.field !== "email") {
          err("CONDITION_FIELD_INVALID", "Predikat field_equals membutuhkan field 'name'|'phone'|'email'");
        }
        if (!isNonEmptyString(c.value)) err("CONDITION_VALUE_REQUIRED", "Predikat field_equals membutuhkan config.value");
      } else if (c.predicate === "message_contains") {
        if (!isNonEmptyString(c.text)) err("CONDITION_TEXT_REQUIRED", "Predikat message_contains membutuhkan config.text");
      } else {
        err("CONDITION_PREDICATE_INVALID", "Node condition membutuhkan predicate yang dikenal");
      }
      break;
    }
    case "delay": {
      const amount = c.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
        err("DELAY_AMOUNT_INVALID", "Node delay membutuhkan config.amount bilangan bulat ≥ 0");
      }
      if (c.unit !== "seconds" && c.unit !== "minutes" && c.unit !== "hours") {
        err("DELAY_UNIT_INVALID", "Node delay membutuhkan unit 'seconds'|'minutes'|'hours'");
      }
      // Smart Delay (Fase 9A): random opsional {min, max} dalam satuan
      // node yang sama — keduanya bilangan bulat positif, min ≤ max,
      // dalam batas yang sama seperti amount. Rentang rusak = error
      // aktivasi, bukan kejutan saat eksekusi.
      if (c.random !== undefined) {
        const r = c.random as { min?: unknown; max?: unknown } | null;
        const valid =
          typeof r === "object" &&
          r !== null &&
          typeof r.min === "number" &&
          Number.isInteger(r.min) &&
          typeof r.max === "number" &&
          Number.isInteger(r.max) &&
          r.min >= 1 &&
          r.max >= r.min &&
          r.max <= 100_000;
        if (!valid) {
          err(
            "DELAY_RANDOM_INVALID",
            "Smart Delay membutuhkan config.random {min, max} bilangan bulat dengan 1 ≤ min ≤ max",
          );
        }
      }
      break;
    }
    case "add_tag":
    case "remove_tag":
      if (!isNonEmptyString(c.tag)) err("TAG_REQUIRED", `Node ${node.type} membutuhkan config.tag`);
      break;
    case "set_stage":
      if (!isNonEmptyString(c.stage)) err("STAGE_REQUIRED", "Node set_stage membutuhkan config.stage");
      break;
    case "enroll_sequence":
      if (!isNonEmptyString(c.automationId)) {
        err("SEQUENCE_ID_REQUIRED", "Node enroll_sequence membutuhkan config.automationId");
      }
      break;
    case "set_field": {
      const field = c.field;
      const customKey =
        typeof field === "string" && field.startsWith("custom:")
          ? field.slice("custom:".length)
          : null;
      const fieldOk =
        field === "name" ||
        field === "phone" ||
        field === "email" ||
        (customKey !== null &&
          customKey.trim().length > 0 &&
          (field as string).length <= 128);
      if (!fieldOk) {
        err(
          "SET_FIELD_FIELD_INVALID",
          "Node set_field membutuhkan field 'name'|'phone'|'email'|'custom:<key>'",
        );
      }
      if (typeof c.value !== "string") {
        err(
          "SET_FIELD_VALUE_INVALID",
          "Node set_field membutuhkan config.value string (boleh kosong — membersihkan field)",
        );
      }
      break;
    }
    case "http_request": {
      if (
        c.method !== "GET" &&
        c.method !== "POST" &&
        c.method !== "PUT" &&
        c.method !== "PATCH" &&
        c.method !== "DELETE"
      ) {
        err(
          "HTTP_METHOD_INVALID",
          "Node http_request membutuhkan method GET|POST|PUT|PATCH|DELETE",
        );
      }
      if (!isNonEmptyString(c.url) || !/^https?:\/\//i.test(c.url)) {
        err(
          "HTTP_URL_INVALID",
          "Node http_request membutuhkan config.url http(s) non-kosong",
        );
      }
      if (c.headers !== undefined) {
        const h = c.headers;
        const headersOk =
          typeof h === "object" &&
          h !== null &&
          !Array.isArray(h) &&
          Object.values(h as Record<string, unknown>).every(
            (v) => typeof v === "string",
          );
        if (!headersOk) {
          err(
            "HTTP_HEADERS_INVALID",
            "Node http_request membutuhkan config.headers objek nama→string",
          );
        }
      }
      if (c.body !== undefined && typeof c.body !== "string") {
        err("HTTP_BODY_INVALID", "Node http_request membutuhkan config.body string");
      }
      if (c.saveToField !== undefined) {
        const f = c.saveToField;
        const ok =
          typeof f === "string" &&
          f.startsWith("custom:") &&
          f.slice("custom:".length).trim().length > 0;
        if (!ok) {
          err(
            "HTTP_SAVE_FIELD_INVALID",
            "Node http_request membutuhkan saveToField 'custom:<key>'",
          );
        }
      }
      break;
    }
    case "goto_flow":
      if (!isNonEmptyString(c.flowId)) {
        err("GOTO_FLOW_ID_REQUIRED", "Node goto_flow membutuhkan config.flowId");
      }
      break;
    case "ab_split": {
      const p = c.percentA;
      if (
        typeof p !== "number" ||
        !Number.isInteger(p) ||
        p < 1 ||
        p > 99
      ) {
        err(
          "AB_PERCENT_INVALID",
          "Node ab_split membutuhkan config.percentA bilangan bulat 1..99",
        );
      }
      // Fase 13D — mode eksperimen: flag harus boolean bila diisi;
      // label string pendek; conversionNodeId string id node (rujukan
      // ke node yang ADA di graf yang sama diperiksa validateFlowGraph
      // yang punya konteks graf utuh).
      if (c.experiment !== undefined && typeof c.experiment !== "boolean") {
        err(
          "AB_EXPERIMENT_INVALID",
          "Node ab_split membutuhkan config.experiment boolean bila diisi",
        );
      }
      if (
        c.experimentLabel !== undefined &&
        (typeof c.experimentLabel !== "string" ||
          c.experimentLabel.length > 128)
      ) {
        err(
          "AB_EXPERIMENT_LABEL_INVALID",
          "Label eksperimen ab_split harus string ≤ 128 karakter",
        );
      }
      if (
        c.conversionNodeId !== undefined &&
        !isNonEmptyString(c.conversionNodeId)
      ) {
        err(
          "AB_CONVERSION_NODE_INVALID",
          "Node ab_split membutuhkan config.conversionNodeId id node non-kosong bila diisi",
        );
      }
      break;
    }
    case "send_payment_link":
      if (!isNonEmptyString(c.productId)) {
        err(
          "PAYMENT_PRODUCT_ID_REQUIRED",
          "Node send_payment_link membutuhkan config.productId",
        );
      }
      break;
    case "wait_reply": {
      const amount = c.amount;
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 0
      ) {
        err(
          "WAIT_AMOUNT_INVALID",
          "Node wait_reply membutuhkan config.amount bilangan bulat ≥ 0",
        );
      }
      if (c.unit !== "seconds" && c.unit !== "minutes" && c.unit !== "hours") {
        err(
          "WAIT_UNIT_INVALID",
          "Node wait_reply membutuhkan unit 'seconds'|'minutes'|'hours'",
        );
      }
      break;
    }
    case "ai_response":
    case "handoff":
    case "end":
      break;
    default:
      err("NODE_TYPE_UNKNOWN", `Tipe node tidak dikenal: ${node.type}`);
  }
  return issues;
}

/**
 * Validasi graf MENYELURUH untuk aktivasi. ERROR memblokir aktivasi;
 * WARNING (node tak terjangkau dari trigger) tidak memblokir tetapi
 * selalu dikembalikan agar pemanggil bisa menampilkannya.
 * Pemeriksaan referensi sequence butuh DB: automationId harus menunjuk
 * automation kind='sequence' yang AKTIF milik tenant yang sama.
 */
export async function validateFlowGraph(
  db: Database,
  tenantId: string,
  graph: FlowGraphData,
  options: {
    /**
     * Id flow yang sedang divalidasi (saat aktivasi/endpoint validate).
     * Node goto_flow yang menunjuk flow ITU SENDIRI sah: pada saat
     * aktivasi berhasil flow menjadi active, jadi targetnya terpenuhi.
     */
    selfFlowId?: string;
  } = {},
): Promise<FlowGraphIssue[]> {
  const issues: FlowGraphIssue[] = [];
  const err = (code: string, nodeId: string | null, message: string) =>
    issues.push({ code, severity: "error", nodeId, message });
  const warn = (code: string, nodeId: string | null, message: string) =>
    issues.push({ code, severity: "warning", nodeId, message });

  if (graph.nodes.length === 0) {
    err("GRAPH_EMPTY", null, "Graf tidak memiliki node apa pun");
    return issues;
  }
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      err("NODE_ID_DUPLICATE", node.id, `Id node ganda: ${node.id}`);
    }
    ids.add(node.id);
    if (!NODE_TYPES.has(node.type)) {
      err("NODE_TYPE_UNKNOWN", node.id, `Tipe node tidak dikenal: ${node.type}`);
    }
  }
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    err("TRIGGER_MISSING", null, "Graf membutuhkan tepat satu node trigger");
  } else if (triggers.length > 1) {
    for (const t of triggers.slice(1)) {
      err("TRIGGER_MULTIPLE", t.id, "Graf memiliki lebih dari satu node trigger");
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) {
      err("EDGE_FROM_UNKNOWN", null, `Edge berasal dari node yang tidak ada: ${edge.from}`);
    }
    if (!ids.has(edge.to)) {
      err("EDGE_TO_UNKNOWN", edge.from, `Edge menuju node yang tidak ada: ${edge.to}`);
    }
  }
  // Aturan branch per tipe node bercabang (Fase 12A menggeneralisasi
  // aturan condition 8A): himpunan branch wajib lengkap, branch di
  // luar himpunan = EDGE_BRANCH_MISPLACED, dan node non-bercabang
  // tidak boleh membawa branch sama sekali.
  const BRANCH_RULES: Record<
    string,
    { required: { branch: FlowBranch; code: string; label: string }[] }
  > = {
    condition: {
      required: [
        { branch: "yes", code: "CONDITION_BRANCH_YES_MISSING", label: "Node condition membutuhkan edge branch 'yes'" },
        { branch: "no", code: "CONDITION_BRANCH_NO_MISSING", label: "Node condition membutuhkan edge branch 'no'" },
      ],
    },
    ab_split: {
      required: [
        { branch: "a", code: "AB_BRANCH_A_MISSING", label: "Node ab_split membutuhkan edge branch 'a'" },
        { branch: "b", code: "AB_BRANCH_B_MISSING", label: "Node ab_split membutuhkan edge branch 'b'" },
      ],
    },
    wait_reply: {
      required: [
        { branch: "replied", code: "WAIT_BRANCH_REPLIED_MISSING", label: "Node wait_reply membutuhkan edge branch 'replied'" },
        { branch: "timeout", code: "WAIT_BRANCH_TIMEOUT_MISSING", label: "Node wait_reply membutuhkan edge branch 'timeout'" },
      ],
    },
  };
  for (const node of graph.nodes) {
    issues.push(...validateFlowNodeConfig(node));
    const out = graph.edges.filter((e) => e.from === node.id);
    const rule = BRANCH_RULES[node.type];
    if (rule) {
      const allowed = new Set(rule.required.map((r) => r.branch));
      for (const req of rule.required) {
        if (!out.some((e) => e.branch === req.branch)) {
          err(req.code, node.id, req.label);
        }
      }
      for (const e of out) {
        if (e.branch === undefined || !allowed.has(e.branch)) {
          err(
            "EDGE_BRANCH_MISPLACED",
            node.id,
            `Branch edge keluar node ${node.type} harus salah satu dari: ${[...allowed].join(", ")}`,
          );
        }
      }
    } else {
      for (const e of out) {
        if (e.branch !== undefined) {
          err("EDGE_BRANCH_MISPLACED", node.id, "Branch hanya sah pada edge keluar node condition, ab_split, atau wait_reply");
        }
      }
    }
    if (node.type === "trigger" && out.length === 0) {
      warn("TRIGGER_NO_NEXT", node.id, "Trigger tidak punya node lanjutan — run akan langsung selesai");
    }
  }

  // Fase 13D: titik konversi eksperimen ab_split harus menunjuk node
  // LAIN yang ada di graf yang sama (menunjuk diri sendiri = konversi
  // selalu/ tak pernah bermakna — ditolak di sini, bukan ditebak).
  for (const node of graph.nodes) {
    if (node.type !== "ab_split" || node.config.experiment !== true) {
      continue;
    }
    const conv = node.config.conversionNodeId;
    if (conv === undefined) continue;
    if (
      typeof conv !== "string" ||
      conv === node.id ||
      !ids.has(conv)
    ) {
      err(
        "AB_CONVERSION_NODE_INVALID",
        node.id,
        "Titik konversi eksperimen ab_split harus menunjuk node lain yang ada di graf ini",
      );
    }
  }

  // Referensi sequence (butuh DB, konteks tenant).
  const sequenceRefs = graph.nodes.filter(
    (n) => n.type === "enroll_sequence" && isNonEmptyString(n.config.automationId),
  );
  if (sequenceRefs.length > 0) {
    await withTenantDb(db, tenantId, async (tx) => {
      for (const node of sequenceRefs) {
        const automationId = node.config.automationId as string;
        const [target] = await tx
          .select({
            id: automations.id,
            kind: automations.kind,
            isActive: automations.isActive,
          })
          .from(automations)
          .where(
            and(
              eq(automations.tenantId, tenantId),
              eq(automations.id, automationId),
            ),
          )
          .limit(1);
        if (!target) {
          err("SEQUENCE_NOT_FOUND", node.id, "Sequence rujukan tidak ada di workspace ini");
        } else if (target.kind !== "sequence") {
          err("SEQUENCE_WRONG_KIND", node.id, "Automation rujukan bukan sequence");
        } else if (!target.isActive) {
          err("SEQUENCE_INACTIVE", node.id, "Sequence rujukan tidak aktif");
        }
      }
    });
  }

  // Referensi goto_flow & send_payment_link (Fase 12A, butuh DB):
  // flow tujuan harus ada di tenant yang sama dan ACTIVE (flow itu
  // sendiri dikecualikan — aktivasi membuatnya active); produk harus
  // ada dan tidak diarsipkan (is_active).
  const gotoRefs = graph.nodes.filter(
    (n) => n.type === "goto_flow" && isNonEmptyString(n.config.flowId),
  );
  const productRefs = graph.nodes.filter(
    (n) => n.type === "send_payment_link" && isNonEmptyString(n.config.productId),
  );
  if (gotoRefs.length > 0 || productRefs.length > 0) {
    await withTenantDb(db, tenantId, async (tx) => {
      for (const node of gotoRefs) {
        const flowId = node.config.flowId as string;
        if (options.selfFlowId && flowId === options.selfFlowId) continue;
        if (!isUuidLike(flowId)) {
          err("GOTO_FLOW_NOT_FOUND", node.id, "Flow tujuan goto tidak ada di workspace ini");
          continue;
        }
        const [target] = await tx
          .select({ id: flows.id, status: flows.status })
          .from(flows)
          .where(and(eq(flows.tenantId, tenantId), eq(flows.id, flowId)))
          .limit(1);
        if (!target) {
          err("GOTO_FLOW_NOT_FOUND", node.id, "Flow tujuan goto tidak ada di workspace ini");
        } else if (target.status !== "active") {
          err("GOTO_FLOW_INACTIVE", node.id, "Flow tujuan goto harus berstatus aktif");
        }
      }
      for (const node of productRefs) {
        const productId = node.config.productId as string;
        if (!isUuidLike(productId)) {
          err("PAYMENT_PRODUCT_NOT_FOUND", node.id, "Produk rujukan tidak ada di workspace ini");
          continue;
        }
        const [target] = await tx
          .select({ id: products.id, isActive: products.isActive })
          .from(products)
          .where(
            and(eq(products.tenantId, tenantId), eq(products.id, productId)),
          )
          .limit(1);
        if (!target) {
          err("PAYMENT_PRODUCT_NOT_FOUND", node.id, "Produk rujukan tidak ada di workspace ini");
        } else if (!target.isActive) {
          err("PAYMENT_PRODUCT_INACTIVE", node.id, "Produk rujukan tidak aktif (diarsipkan)");
        }
      }
    });
  }

  // Keterjangkauan dari trigger → warning saja.
  const trigger = triggers[0];
  if (trigger) {
    const reachable = new Set<string>([trigger.id]);
    const queue = [trigger.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of graph.edges.filter((x) => x.from === current)) {
        if (!reachable.has(e.to)) {
          reachable.add(e.to);
          queue.push(e.to);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        warn("NODE_UNREACHABLE", node.id, `Node tidak terjangkau dari trigger: ${node.id}`);
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Util kursor (pola broadcasts 7C — base64url {createdAt, id})
// ---------------------------------------------------------------------------

interface PageCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  const raw: PageCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): PageCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<PageCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Kursor rusak → halaman pertama (pola terdokumentasi).
  }
  return null;
}

function clampLimit(limit: number | undefined, fallback = 50, max = 100): number {
  if (!limit || Number.isNaN(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function cursorCondition(
  cursor: PageCursor | null,
  createdAtCol: unknown,
  idCol: unknown,
) {
  if (!cursor) return undefined;
  // Kolom (created_at, id) dari tabel mana pun (flows / flow_runs) —
  // bentuk kursornya identik; casting lokal agar helper bisa dipakai
  // ulang tanpa duplikasi.
  const createdAt = createdAtCol as typeof flows.createdAt;
  const id = idCol as typeof flows.id;
  const cursorDate = new Date(cursor.createdAt);
  return or(
    lt(createdAt, cursorDate),
    and(eq(createdAt, cursorDate), lt(id, cursor.id)),
  );
}

// ---------------------------------------------------------------------------
// Manajemen flow (sisi API)
// ---------------------------------------------------------------------------

export type FlowWithRunCount = Flow & { runCount: number };

async function flowAudit(
  tx: DbTx,
  tenantId: string,
  input: {
    actorType: "user" | "system";
    actorId: string;
    action: string;
    flowId: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    meta: { flowId: input.flowId, ...(input.meta ?? {}) },
  });
}

/**
 * Fase 13D: audit nyala/mati mode eksperimen per node ab_split —
 * bandingkan flag `experiment` per id node antara graf lama (null =
 * belum ada) dan graf baru; setiap perubahan arah menulis satu baris
 * `flow.experiment_enabled` / `flow.experiment_disabled`. Perubahan
 * persen/label saja tidak diaudit di sini (tercakup flow.updated).
 */
async function auditExperimentToggles(
  tx: DbTx,
  tenantId: string,
  input: {
    userId: string;
    flowId: string;
    oldGraph: FlowGraphData | null;
    newGraph: FlowGraphData;
  },
): Promise<void> {
  const oldSplits = new Map(
    (input.oldGraph?.nodes ?? [])
      .filter((n) => n.type === "ab_split")
      .map((n) => [n.id, n.config.experiment === true] as const),
  );
  for (const node of input.newGraph.nodes) {
    if (node.type !== "ab_split") continue;
    const was = oldSplits.get(node.id) ?? false;
    const is = node.config.experiment === true;
    if (was === is) continue;
    await flowAudit(tx, tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: is ? "flow.experiment_enabled" : "flow.experiment_disabled",
      flowId: input.flowId,
      meta: {
        nodeId: node.id,
        label:
          typeof node.config.experimentLabel === "string"
            ? node.config.experimentLabel
            : null,
        percentA:
          typeof node.config.percentA === "number"
            ? node.config.percentA
            : null,
      },
    });
  }
}

export async function createFlow(
  db: Database,
  input: {
    tenantId: string;
    userId: string;
    name: string;
    graph?: FlowGraphData;
  },
): Promise<{ kind: "created"; flow: FlowWithRunCount }> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(flows)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        status: "draft",
        graph: input.graph ?? { nodes: [], edges: [] },
        createdByUserId: input.userId,
      })
      .returning();
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.created",
      flowId: row.id,
      meta: { name: row.name },
    });
    if (input.graph) {
      await auditExperimentToggles(tx, input.tenantId, {
        userId: input.userId,
        flowId: row.id,
        oldGraph: null,
        newGraph: input.graph,
      });
    }
    return { kind: "created" as const, flow: { ...row, runCount: 0 } };
  });
}

export type InstantiateFlowTemplateResult =
  | { kind: "created"; flow: FlowWithRunCount }
  | { kind: "template_not_found" };

/**
 * Membuat flow DRAFT dari template katalog (Fase 12B — definisi
 * template hidup di kontrak, `FLOW_TEMPLATES`). Graf template disalin
 * DALAM (JSON round-trip: definisi statis tidak boleh berubah karena
 * flow hasil instantiate diedit) dan id setiap node diregenerasi
 * dengan pola id acak core (`n_<base64url>`) agar dua hasil
 * instantiate dari template yang sama tidak pernah berbagi id node —
 * rujukan silang seperti goto_flow selalu menunjuk flow, bukan node,
 * jadi regenerasi aman. Nama bawaan = `input.name` atau
 * `template.defaultName`. Audit: `flow.created` (konsisten buat
 * manual) + `flow.template_instantiated` bermeta slug.
 */
export async function instantiateFlowTemplate(
  db: Database,
  input: { tenantId: string; userId: string; slug: string; name?: string },
): Promise<InstantiateFlowTemplateResult> {
  const template = findFlowTemplate(input.slug);
  if (!template) return { kind: "template_not_found" as const };
  const idMap = new Map<string, string>();
  for (const node of template.graph.nodes) {
    idMap.set(node.id, `n_${randomBytes(9).toString("base64url")}`);
  }
  const copy = JSON.parse(JSON.stringify(template.graph)) as {
    nodes: FlowGraphNode[];
    edges: FlowGraphEdge[];
  };
  const graph: FlowGraphData = {
    nodes: copy.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id) ?? n.id,
    })),
    edges: copy.edges.map((e) => ({
      ...e,
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    })),
  };
  const name = input.name?.trim() ? input.name.trim() : template.defaultName;
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [row] = await tx
      .insert(flows)
      .values({
        tenantId: input.tenantId,
        name,
        status: "draft",
        graph,
        createdByUserId: input.userId,
      })
      .returning();
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.created",
      flowId: row.id,
      meta: { name: row.name },
    });
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.template_instantiated",
      flowId: row.id,
      meta: { templateSlug: template.slug, name: row.name },
    });
    return {
      kind: "created" as const,
      flow: { ...row, runCount: 0 },
    };
  });
}

export async function listFlows(
  db: Database,
  input: {
    tenantId: string;
    status?: FlowStatus;
    cursor?: string;
    limit?: number;
  },
): Promise<{ flows: FlowWithRunCount[]; nextCursor: string | null }> {
  const limit = clampLimit(input.limit);
  return withTenantDb(db, input.tenantId, async (tx) => {
    const conditions = [eq(flows.tenantId, input.tenantId)];
    if (input.status) conditions.push(eq(flows.status, input.status));
    const cc = cursorCondition(decodeCursor(input.cursor), flows.createdAt, flows.id);
    if (cc) conditions.push(cc);
    const rows = await tx
      .select({
        flow: flows,
        runCount: sql<number>`count(${flowRuns.id})::int`,
      })
      .from(flows)
      .leftJoin(flowRuns, eq(flowRuns.flowId, flows.id))
      .where(and(...conditions))
      .groupBy(flows.id)
      .orderBy(desc(flows.createdAt), desc(flows.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      flows: page.map((r) => ({ ...r.flow, runCount: r.runCount })),
      nextCursor: hasMore
        ? encodeCursor(page[page.length - 1].flow)
        : null,
    };
  });
}

/** Null bila flow tidak ada DI tenant ini. */
export async function getFlow(
  db: Database,
  input: { tenantId: string; flowId: string },
): Promise<FlowWithRunCount | null> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        flow: flows,
        runCount: sql<number>`count(${flowRuns.id})::int`,
      })
      .from(flows)
      .leftJoin(flowRuns, eq(flowRuns.flowId, flows.id))
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .groupBy(flows.id)
      .limit(1);
    return row ? { ...row.flow, runCount: row.runCount } : null;
  });
}

export type UpdateFlowResult =
  | { kind: "updated"; flow: Flow }
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: FlowStatus };

/** Edit nama/graf — hanya saat draft (graf flow aktif tidak boleh berubah di bawah run hidup). */
export async function updateFlow(
  db: Database,
  input: {
    tenantId: string;
    flowId: string;
    userId: string;
    patch: { name?: string; graph?: FlowGraphData };
  },
): Promise<UpdateFlowResult> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(flows)
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .limit(1);
    if (!existing) return { kind: "not_found" as const };
    if (existing.status !== "draft") {
      return { kind: "invalid_state" as const, status: existing.status };
    }
    const patch: Partial<Flow> = { updatedAt: new Date() };
    if (input.patch.name !== undefined) patch.name = input.patch.name;
    if (input.patch.graph !== undefined) patch.graph = input.patch.graph;
    const [row] = await tx
      .update(flows)
      .set(patch)
      .where(eq(flows.id, input.flowId))
      .returning();
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.updated",
      flowId: row.id,
      meta: {
        name: input.patch.name !== undefined,
        graph: input.patch.graph !== undefined,
      },
    });
    // Fase 13D: nyala/mati mode eksperimen per node ab_split diaudit
    // tersendiri (mengubah cara kontak ditugaskan) — lihat
    // auditExperimentToggles.
    if (input.patch.graph !== undefined) {
      await auditExperimentToggles(tx, input.tenantId, {
        userId: input.userId,
        flowId: row.id,
        oldGraph: normalizeFlowGraph(existing.graph),
        newGraph: input.patch.graph,
      });
    }
    return { kind: "updated" as const, flow: row };
  });
}

export type ActivateFlowResult =
  | { kind: "activated"; flow: Flow; warnings: FlowGraphIssue[] }
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: FlowStatus }
  | { kind: "invalid"; issues: FlowGraphIssue[] };

/**
 * Aktivasi: validasi graf menyeluruh dulu (di luar transaksi tulis).
 * Ada ERROR → ditolak utuh dengan daftar masalah; WARNING diteruskan
 * ke pemanggil bersama hasil sukses.
 */
export async function activateFlow(
  db: Database,
  input: { tenantId: string; flowId: string; userId: string },
): Promise<ActivateFlowResult> {
  const existing = await getFlow(db, input);
  if (!existing) return { kind: "not_found" };
  if (existing.status !== "draft") {
    return { kind: "invalid_state", status: existing.status };
  }
  const graph = normalizeFlowGraph(existing.graph);
  const issues = await validateFlowGraph(db, input.tenantId, graph, {
    selfFlowId: input.flowId,
  });
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return { kind: "invalid", issues };
  const warnings = issues.filter((i) => i.severity === "warning");
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [row] = await tx
      .update(flows)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(flows.id, input.flowId),
          eq(flows.status, "draft"),
        ),
      )
      .returning();
    if (!row) return { kind: "invalid_state" as const, status: existing.status };
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.activated",
      flowId: row.id,
      meta: { warnings: warnings.map((w) => w.code) },
    });
    return { kind: "activated" as const, flow: row, warnings };
  });
}

export type FlowStatusActionResult =
  | { kind: "ok"; flow: Flow }
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: FlowStatus };

/** Nonaktifkan: active → draft (pemicu baru berhenti; run hidup tidak dibatalkan). */
export async function deactivateFlow(
  db: Database,
  input: { tenantId: string; flowId: string; userId: string },
): Promise<FlowStatusActionResult> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(flows)
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .limit(1);
    if (!existing) return { kind: "not_found" as const };
    if (existing.status !== "active") {
      return { kind: "invalid_state" as const, status: existing.status };
    }
    const [row] = await tx
      .update(flows)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(flows.id, input.flowId))
      .returning();
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.deactivated",
      flowId: row.id,
    });
    return { kind: "ok" as const, flow: row };
  });
}

/** Arsip: draft|active → archived. Keluar arsip: archived → draft. */
export async function setFlowArchived(
  db: Database,
  input: { tenantId: string; flowId: string; userId: string; archived: boolean },
): Promise<FlowStatusActionResult> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(flows)
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .limit(1);
    if (!existing) return { kind: "not_found" as const };
    if (input.archived && existing.status === "archived") {
      return { kind: "invalid_state" as const, status: existing.status };
    }
    if (!input.archived && existing.status !== "archived") {
      return { kind: "invalid_state" as const, status: existing.status };
    }
    const [row] = await tx
      .update(flows)
      .set({
        status: input.archived ? "archived" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(flows.id, input.flowId))
      .returning();
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.updated",
      flowId: row.id,
      meta: { archived: input.archived },
    });
    return { kind: "ok" as const, flow: row };
  });
}

export type DeleteFlowResult =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "invalid_state"; status: FlowStatus };

/** Hapus — hanya draft (run & langkah ikut terhapus lewat FK cascade). */
export async function deleteFlow(
  db: Database,
  input: { tenantId: string; flowId: string; userId: string },
): Promise<DeleteFlowResult> {
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(flows)
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .limit(1);
    if (!existing) return { kind: "not_found" as const };
    if (existing.status !== "draft") {
      return { kind: "invalid_state" as const, status: existing.status };
    }
    await tx.delete(flows).where(eq(flows.id, input.flowId));
    await flowAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.userId,
      action: "flow.updated",
      flowId: input.flowId,
      meta: { deleted: true, name: existing.name },
    });
    return { kind: "deleted" as const };
  });
}

// ---------------------------------------------------------------------------
// Baca run & langkah (untuk 8B / debugging)
// ---------------------------------------------------------------------------

export type FlowRunWithContact = FlowRun & { contactName: string };

export async function listFlowRuns(
  db: Database,
  input: {
    tenantId: string;
    flowId: string;
    status?: FlowRunStatus;
    cursor?: string;
    limit?: number;
  },
): Promise<
  | { kind: "ok"; runs: FlowRunWithContact[]; nextCursor: string | null }
  | { kind: "not_found" }
> {
  const limit = clampLimit(input.limit);
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [owner] = await tx
      .select({ id: flows.id })
      .from(flows)
      .where(
        and(eq(flows.tenantId, input.tenantId), eq(flows.id, input.flowId)),
      )
      .limit(1);
    if (!owner) return { kind: "not_found" as const };
    const conditions = [
      eq(flowRuns.tenantId, input.tenantId),
      eq(flowRuns.flowId, input.flowId),
    ];
    if (input.status) conditions.push(eq(flowRuns.status, input.status));
    const cc = cursorCondition(
      decodeCursor(input.cursor),
      flowRuns.createdAt,
      flowRuns.id,
    );
    if (cc) conditions.push(cc);
    const rows = await tx
      .select({ run: flowRuns, contactName: contacts.name })
      .from(flowRuns)
      .innerJoin(contacts, eq(flowRuns.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(flowRuns.createdAt), desc(flowRuns.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      kind: "ok" as const,
      runs: page.map((r) => ({ ...r.run, contactName: r.contactName })),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1].run) : null,
    };
  });
}

export async function listFlowRunSteps(
  db: Database,
  input: {
    tenantId: string;
    runId: string;
    cursor?: string;
    limit?: number;
  },
): Promise<
  | { kind: "ok"; steps: FlowRunStep[]; nextCursor: string | null }
  | { kind: "not_found" }
> {
  const limit = clampLimit(input.limit, 100, 200);
  return withTenantDb(db, input.tenantId, async (tx) => {
    const [run] = await tx
      .select({ id: flowRuns.id })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.tenantId, input.tenantId),
          eq(flowRuns.id, input.runId),
        ),
      )
      .limit(1);
    if (!run) return { kind: "not_found" as const };
    // Paginasi langkah memakai seq menaik (kursor = seq terakhir).
    let afterSeq = 0;
    const cursor = decodeCursor(input.cursor);
    if (cursor) {
      const parsed = Number.parseInt(cursor.id, 10);
      if (!Number.isNaN(parsed)) afterSeq = parsed;
    }
    const rows = await tx
      .select()
      .from(flowRunSteps)
      .where(
        and(
          eq(flowRunSteps.tenantId, input.tenantId),
          eq(flowRunSteps.runId, input.runId),
          sql`${flowRunSteps.seq} > ${afterSeq}`,
        ),
      )
      .orderBy(asc(flowRunSteps.seq))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      kind: "ok" as const,
      steps: page,
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              createdAt: page[page.length - 1].createdAt.toISOString(),
              id: String(page[page.length - 1].seq),
            }),
            "utf8",
          ).toString("base64url")
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Pemicu: evaluasi flow untuk satu pesan masuk (dipanggil automations.ts)
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Salinan lokal pencocok keyword automation (menghindari impor melingkar). */
function flowKeywordMatches(
  messageText: string,
  keyword: string,
  match: "exact" | "contains",
): boolean {
  const text = normalizeText(messageText);
  const kw = normalizeText(keyword);
  if (!kw) return false;
  return match === "exact" ? text === kw : text.includes(kw);
}

function flowTriggerMatches(
  node: FlowGraphNode,
  messageText: string,
): boolean {
  const c = node.config;
  if (c.kind === "any_message") return true;
  if (c.kind === "keyword") {
    const keywords = Array.isArray(c.keywords)
      ? c.keywords.filter(isNonEmptyString)
      : [];
    const match = c.match === "exact" ? "exact" : "contains";
    return keywords.some((kw) => flowKeywordMatches(messageText, kw, match));
  }
  return false;
}

export interface FlowEvaluationOutcome {
  /** Run yang BARU dimulai oleh pesan ini. */
  startedRunIds: string[];
  /** Flow cocok yang tidak memulai run baru (run untuk pesan ini sudah ada). */
  duplicateStarts: number;
  /** Run waiting yang dibatalkan karena kontak opt-out. */
  cancelledRunIds: string[];
  /** Run wait_reply parkir yang dilanjutkan pesan ini (branch replied). */
  resumedRunIds: string[];
}

/**
 * Menyelesaikan parkir wait_reply satu run DALAM transaksi berjalan:
 * menulis baris langkah resolusi (outcome = branch), membersihkan
 * context.wait, dan memajukan run ke node cabang — atau menyelesaikan
 * run bila cabang tidak punya node lanjutan. `run` harus keadaan
 * segar yang dibaca dalam transaksi ini. Dipakai dua jalur: balasan
 * kontak (jalur evaluasi pesan masuk) dan tenggat lewat (eksekutor).
 */
async function resolveParkedWaitReply(
  tx: DbTx,
  tenantId: string,
  run: FlowRun,
  graph: FlowGraphData,
  node: FlowGraphNode,
  resolution: { branch: "replied" | "timeout"; extraDetail: Record<string, unknown> },
): Promise<{ status: FlowRunStatus; nextStepSeq: number }> {
  const now = new Date();
  const seq = run.nextStepSeq;
  await tx.insert(flowRunSteps).values({
    tenantId,
    runId: run.id,
    seq,
    nodeId: node.id,
    nodeType: "wait_reply",
    detail: { outcome: resolution.branch, ...resolution.extraDetail },
  });
  const nextId = nextNodeId(graph, node.id, resolution.branch);
  const context = { ...runContextOf(run) };
  delete context.wait;
  const patch: Partial<FlowRun> = {
    stepCount: run.stepCount + 1,
    nextStepSeq: seq + 1,
    context,
    updatedAt: now,
  };
  if (nextId === null) {
    patch.status = "completed";
    patch.currentNodeId = null;
    patch.completedAt = now;
    await tx.update(flowRuns).set(patch).where(eq(flowRuns.id, run.id));
    await flowAudit(tx, tenantId, {
      actorType: "system",
      actorId: `flow:${run.flowId}`,
      action: "flow.run_completed",
      flowId: run.flowId,
      meta: {
        flowRunId: run.id,
        conversationId: run.conversationId,
        stepCount: run.stepCount + 1,
        reason: `wait_reply_${resolution.branch}`,
      },
    });
    return { status: "completed", nextStepSeq: seq + 1 };
  }
  patch.status = "running";
  patch.currentNodeId = nextId;
  await tx.update(flowRuns).set(patch).where(eq(flowRuns.id, run.id));
  return { status: "running", nextStepSeq: seq + 1 };
}

/**
 * Melanjutkan SEMUA run wait_reply yang parkir di percakapan ini
 * dengan pesan masuk yang baru tiba (branch "replied"), lalu
 * mengantrekan langkah lanjutan tiap run lewat outbox. Run waiting
 * biasa (delay) tidak disentuh — penanda parkirnya adalah
 * context.wait yang nodeId-nya sama dengan currentNodeId.
 */
async function resumeParkedWaitReplyRuns(
  tx: DbTx,
  tenantId: string,
  input: { conversationId: string; messageId: string },
): Promise<string[]> {
  const waiting = await tx
    .select()
    .from(flowRuns)
    .where(
      and(
        eq(flowRuns.tenantId, tenantId),
        eq(flowRuns.conversationId, input.conversationId),
        eq(flowRuns.status, "waiting"),
      ),
    );
  const resumed: string[] = [];
  for (const run of waiting) {
    const ctx = runContextOf(run);
    if (!ctx.wait || run.currentNodeId !== ctx.wait.nodeId) continue;
    const [flow] = await tx
      .select()
      .from(flows)
      .where(and(eq(flows.tenantId, tenantId), eq(flows.id, run.flowId)))
      .limit(1);
    if (!flow) continue;
    const graph = normalizeFlowGraph(flow.graph);
    const node = graph.nodes.find((n) => n.id === ctx.wait!.nodeId);
    if (!node || node.type !== "wait_reply") continue;
    const result = await resolveParkedWaitReply(tx, tenantId, run, graph, node, {
      branch: "replied",
      extraDetail: { messageId: input.messageId, deadline: ctx.wait.deadline },
    });
    if (result.status === "running") {
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "flow.step_due",
        payload: {
          runId: run.id,
          stepSeq: result.nextStepSeq,
          resumeAt: new Date().toISOString(),
        },
      });
    }
    resumed.push(run.id);
  }
  return resumed;
}

/**
 * Membatalkan run `waiting` pada percakapan (aturan opt-out). Dipakai
 * jalur evaluasi saat pesan masuk berasal dari kontak yang sudah
 * opt-out. Mengembalikan id run yang dibatalkan.
 */
async function cancelWaitingFlowRuns(
  tx: DbTx,
  tenantId: string,
  conversationId: string,
  reason: string,
): Promise<string[]> {
  const waiting = await tx
    .select()
    .from(flowRuns)
    .where(
      and(
        eq(flowRuns.tenantId, tenantId),
        eq(flowRuns.conversationId, conversationId),
        eq(flowRuns.status, "waiting"),
      ),
    );
  const cancelled: string[] = [];
  const now = new Date();
  for (const run of waiting) {
    const [updated] = await tx
      .update(flowRuns)
      .set({
        status: "cancelled",
        errorCode: reason,
        currentNodeId: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(flowRuns.id, run.id), eq(flowRuns.status, "waiting")),
      )
      .returning();
    if (!updated) continue;
    await flowAudit(tx, tenantId, {
      actorType: "system",
      actorId: `flow:${run.flowId}`,
      action: "flow.run_cancelled",
      flowId: run.flowId,
      meta: { flowRunId: run.id, conversationId, reason },
    });
    cancelled.push(run.id);
  }
  return cancelled;
}

/**
 * Memulai run untuk semua flow AKTIF yang trigger-nya cocok dengan
 * pesan masuk ini. Dipanggil `evaluateInboundMessageForAutomations`
 * SETELAH pencocokan automation (keyword → flow → agent). Satu
 * transaksi per flow agar kegagalan satu flow tidak menggagalkan yang
 * lain; pelanggaran unik (run sudah ada untuk pesan ini) diperlakukan
 * sebagai duplikat, BUKAN kegagalan.
 */
export async function startFlowRunsForInboundMessage(
  db: Database,
  input: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    messageText: string;
    contact: Contact | null;
    conversation: Conversation;
  },
): Promise<FlowEvaluationOutcome> {
  const { tenantId, conversationId, messageId } = input;
  const outcome: FlowEvaluationOutcome = {
    startedRunIds: [],
    duplicateStarts: 0,
    cancelledRunIds: [],
    resumedRunIds: [],
  };
  if (!input.contact) return outcome;

  // Kontak opt-out: tidak ada run baru; run waiting di percakapan ini
  // dibatalkan (aturan berhenti opt-out — konsisten sequence 2C).
  if (input.contact.optInStatus === "opted_out") {
    outcome.cancelledRunIds = await withTenantDb(db, tenantId, (tx) =>
      cancelWaitingFlowRuns(tx, tenantId, conversationId, "contact_opted_out"),
    );
    return outcome;
  }

  // Fase 12A: pesan ini adalah BALASAN bagi run wait_reply yang parkir
  // di percakapan ini — lanjutkan semuanya lewat branch "replied"
  // SEBELUM pemicu flow biasa dievaluasi. Pesan yang sama tetap
  // diproses pemicu lain seperti biasa (keputusan desain terdokumentasi
  // di kontrak): melanjutkan wait_reply tidak menekan trigger lain.
  outcome.resumedRunIds = await withTenantDb(db, tenantId, (tx) =>
    resumeParkedWaitReplyRuns(tx, tenantId, {
      conversationId,
      messageId,
    }),
  );

  const activeFlows = await withTenantDb(db, tenantId, (tx) =>
    tx
      .select()
      .from(flows)
      .where(and(eq(flows.tenantId, tenantId), eq(flows.status, "active")))
      .orderBy(asc(flows.createdAt)),
  );

  for (const flow of activeFlows) {
    const graph = normalizeFlowGraph(flow.graph);
    const trigger = triggerOf(graph);
    if (!trigger) continue;
    if (!flowTriggerMatches(trigger, input.messageText)) continue;

    const started = await withTenantDb(db, tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: flowRuns.id })
        .from(flowRuns)
        .where(
          and(
            eq(flowRuns.flowId, flow.id),
            eq(flowRuns.triggerMessageId, messageId),
          ),
        )
        .limit(1);
      if (existing) return { kind: "duplicate" as const };

      const firstNodeId = firstNodeAfterTrigger(graph);
      const now = new Date();
      const [run] = await tx
        .insert(flowRuns)
        .values({
          tenantId,
          flowId: flow.id,
          conversationId,
          contactId: input.contact!.id,
          triggerMessageId: messageId,
          status: firstNodeId ? "running" : "completed",
          currentNodeId: firstNodeId,
          nextStepSeq: 1,
          stepCount: 0,
          context: { triggerText: input.messageText },
          completedAt: firstNodeId ? null : now,
        })
        .returning();
      await flowAudit(tx, tenantId, {
        actorType: "system",
        actorId: `flow:${flow.id}`,
        action: "flow.run_started",
        flowId: flow.id,
        meta: {
          flowRunId: run.id,
          triggerMessageId: messageId,
          conversationId,
        },
      });
      if (!firstNodeId) {
        await flowAudit(tx, tenantId, {
          actorType: "system",
          actorId: `flow:${flow.id}`,
          action: "flow.run_completed",
          flowId: flow.id,
          meta: { flowRunId: run.id, conversationId, reason: "empty_flow" },
        });
        return { kind: "started" as const, runId: run.id, queued: false };
      }
      // Eksekusi diserahkan ke worker lewat rel outbox (pola sequence/
      // broadcast): event → relay → job `flow.step` jobId deterministik.
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "flow.step_due",
        payload: {
          runId: run.id,
          stepSeq: 1,
          resumeAt: now.toISOString(),
        },
      });
      return { kind: "started" as const, runId: run.id, queued: true };
    }).catch((err: unknown) => {
      if (
        err instanceof Error &&
        /flow_runs_flow_trigger_message_unique/.test(err.message)
      ) {
        return { kind: "duplicate" as const };
      }
      throw err;
    });

    if (started.kind === "duplicate") {
      outcome.duplicateStarts += 1;
    } else {
      outcome.startedRunIds.push(started.runId);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Eksekusi run (sisi worker, job `flow.step`)
// ---------------------------------------------------------------------------

export interface FlowStepDeps {
  /**
   * Resolver provider LLM untuk node `ai_response` — worker me-resolve
   * per job lewat Panel Admin (pola agent.respond Fase 6C). Tanpa
   * resolver, node ai_response tercatat `skipped/llm_unavailable`.
   */
  resolveLlmProvider?: () => Promise<LlmProvider>;
  /**
   * Resolver provider embedding untuk node `ai_response` (Fase 12D) —
   * pola yang sama seperti resolver LLM; null/absen = retrieval
   * full-text murni di dalam jalur agent.
   */
  resolveEmbeddingProvider?: () => Promise<EmbeddingProvider | null>;
  /** Base URL publik untuk tool agent (send_payment_link). */
  publicBaseUrl?: string;
}

export interface ExecuteFlowStepResult {
  executed: boolean;
  reason?:
    | "run_not_found"
    | "run_terminal"
    | "stale_step"
    | "contact_opted_out";
  /** Status run sesudah pemanggilan ini (bila run ada). */
  status?: FlowRunStatus;
  conversationId?: string;
  /** Pesan keluar terakhir yang dibuat pemanggilan ini (nudge realtime). */
  outboundMessageId?: string;
  stepsExecuted?: number;
}

interface RunContext {
  run: FlowRun;
  flow: Flow;
  graph: FlowGraphData;
  conversation: Conversation | null;
  contact: Contact | null;
}

async function loadRunContext(
  db: Database,
  tenantId: string,
  runId: string,
): Promise<RunContext | null> {
  return withTenantDb(db, tenantId, async (tx) => {
    const [run] = await tx
      .select()
      .from(flowRuns)
      .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
      .limit(1);
    if (!run) return null;
    const [flow] = await tx
      .select()
      .from(flows)
      .where(and(eq(flows.tenantId, tenantId), eq(flows.id, run.flowId)))
      .limit(1);
    if (!flow) return null;
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.id, run.conversationId),
        ),
      )
      .limit(1);
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.tenantId, tenantId), eq(contacts.id, run.contactId)),
      )
      .limit(1);
    return {
      run,
      flow,
      graph: normalizeFlowGraph(flow.graph),
      conversation: conversation ?? null,
      contact: contact ?? null,
    };
  });
}

function isTerminalStatus(status: FlowRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Hasil penerapan satu node: apakah run berhenti di sini, dan kenapa. */
interface AdvanceResult {
  applied: boolean;
  reason?: "stale_step" | "run_terminal";
  status?: FlowRunStatus;
  outboundMessageId?: string;
}

/**
 * Menulis baris langkah + memajukan run dalam transaksi yang sedang
 * berjalan. `run` adalah keadaan run yang dimuat DALAM transaksi ini
 * dan seq-nya sudah diverifikasi pemanggil.
 */
async function advanceRun(
  tx: DbTx,
  tenantId: string,
  run: FlowRun,
  graph: FlowGraphData,
  node: FlowGraphNode,
  input: {
    detail: Record<string, unknown>;
    branch?: FlowBranch;
    /** Node delay: run menunggu selama ini lalu resume. */
    waitMs?: number;
    /**
     * Node wait_reply (Fase 12A): run parkir PADA node ini sendiri
     * (bukan node berikutnya) — context.wait menandai parkirnya agar
     * jalur balasan & jalur tenggat bisa membedakannya dari delay.
     */
    parkWaitReplyMs?: number;
    /** Node end: selesaikan walau ada edge keluar. */
    forceComplete?: boolean;
  },
): Promise<{ status: FlowRunStatus }> {
  const now = new Date();
  const seq = run.nextStepSeq;
  await tx.insert(flowRunSteps).values({
    tenantId,
    runId: run.id,
    seq,
    nodeId: node.id,
    nodeType: node.type,
    detail: input.detail,
  });

  if (input.parkWaitReplyMs !== undefined) {
    const resumeAt = new Date(now.getTime() + input.parkWaitReplyMs);
    const context: FlowRunContextData = {
      ...runContextOf(run),
      wait: {
        nodeId: node.id,
        deadline: resumeAt.toISOString(),
        parkedAt: now.toISOString(),
      },
    };
    await tx
      .update(flowRuns)
      .set({
        stepCount: run.stepCount + 1,
        nextStepSeq: seq + 1,
        status: "waiting",
        currentNodeId: node.id,
        context,
        updatedAt: now,
      })
      .where(eq(flowRuns.id, run.id));
    // Job tenggat: relay menerjemahkannya menjadi job flow.step
    // tertunda; job itu menjalankan branch "timeout" bila run masih
    // parkir (balasan yang datang lebih dulu membuatnya basi).
    await tx.insert(outboxEvents).values({
      tenantId,
      type: "flow.step_due",
      payload: {
        runId: run.id,
        stepSeq: seq + 1,
        resumeAt: resumeAt.toISOString(),
      },
    });
    return { status: "waiting" };
  }

  const nextId = input.forceComplete
    ? null
    : nextNodeId(graph, node.id, input.branch);
  const patch: Partial<FlowRun> = {
    stepCount: run.stepCount + 1,
    nextStepSeq: seq + 1,
    updatedAt: now,
  };

  if (input.waitMs !== undefined) {
    // Node delay: run menunggu; resume ditulis sebagai event outbox
    // (relay → job flow.step tertunda, jobId flow-<runId>-<seq+1>).
    // Node delay di UJUNG graf: currentNodeId null — resume akan
    // menemukan tidak ada node tersisa dan menyelesaikan run.
    const resumeAt = new Date(now.getTime() + input.waitMs);
    patch.status = "waiting";
    patch.currentNodeId = nextId;
    await tx
      .update(flowRuns)
      .set(patch)
      .where(eq(flowRuns.id, run.id));
    await tx.insert(outboxEvents).values({
      tenantId,
      type: "flow.step_due",
      payload: {
        runId: run.id,
        stepSeq: seq + 1,
        resumeAt: resumeAt.toISOString(),
      },
    });
    return { status: "waiting" };
  }

  if (nextId === null) {
    patch.status = "completed";
    patch.currentNodeId = null;
    patch.completedAt = now;
    await tx.update(flowRuns).set(patch).where(eq(flowRuns.id, run.id));
    await flowAudit(tx, tenantId, {
      actorType: "system",
      actorId: `flow:${run.flowId}`,
      action: "flow.run_completed",
      flowId: run.flowId,
      meta: {
        flowRunId: run.id,
        conversationId: run.conversationId,
        stepCount: run.stepCount + 1,
      },
    });
    return { status: "completed" };
  }

  patch.status = "running";
  patch.currentNodeId = nextId;
  await tx.update(flowRuns).set(patch).where(eq(flowRuns.id, run.id));
  return { status: "running" };
}

/** Menandai run gagal + baris langkah error + audit, dalam transaksi berjalan. */
async function failRun(
  tx: DbTx,
  tenantId: string,
  run: FlowRun,
  node: FlowGraphNode | null,
  errorCode: string,
  errorMessage: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await tx.insert(flowRunSteps).values({
    tenantId,
    runId: run.id,
    seq: run.nextStepSeq,
    nodeId: node?.id ?? run.currentNodeId ?? "unknown",
    nodeType: node?.type ?? "unknown",
    detail,
    error: errorMessage.slice(0, 1000),
  });
  await tx
    .update(flowRuns)
    .set({
      status: "failed",
      errorCode,
      currentNodeId: null,
      stepCount: run.stepCount + 1,
      nextStepSeq: run.nextStepSeq + 1,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(flowRuns.id, run.id));
  await flowAudit(tx, tenantId, {
    actorType: "system",
    actorId: `flow:${run.flowId}`,
    action: "flow.run_failed",
    flowId: run.flowId,
    meta: {
      flowRunId: run.id,
      conversationId: run.conversationId,
      reason: errorCode,
      error: errorMessage.slice(0, 300),
    },
  });
}

// --- Eksekutor per tipe node (dalam transaksi) ------------------------------

interface NodeEffects {
  detail: Record<string, unknown>;
  branch?: FlowBranch;
  waitMs?: number;
  parkWaitReplyMs?: number;
  forceComplete?: boolean;
  outboundMessageId?: string;
}

/**
 * Kegagalan keras satu node: run menjadi `failed`. `code` opsional
 * menjadi error_code run (default lapisan eksekutor: "step_error") —
 * dipakai kode spesifik seperti goto_depth_exceeded.
 */
class FlowNodeError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function executeNodeInTx(
  tx: DbTx,
  tenantId: string,
  ctx: RunContext,
  node: FlowGraphNode,
): Promise<NodeEffects> {
  const { run, graph } = ctx;
  const c = node.config;
  switch (node.type) {
    case "trigger":
      return { detail: { outcome: "passed" } };

    case "send_message": {
      const text = isNonEmptyString(c.text) ? c.text : "";
      if (!text) throw new FlowNodeError("send_message tanpa config.text");
      if (!ctx.conversation) {
        throw new FlowNodeError("percakapan run tidak ditemukan");
      }
      const rendered = renderMessageText(text, { name: ctx.contact?.name });
      const [outbound] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId: run.conversationId,
          direction: "outbound",
          senderType: "system",
          type: "text",
          contentText: rendered,
          status: "queued",
        })
        .returning();
      const now = new Date();
      await tx
        .update(conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversations.id, run.conversationId));
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "message.queued",
        payload: {
          provider: ctx.conversation.provider,
          conversationId: run.conversationId,
          messageId: outbound.id,
          via: "flow",
          flowId: run.flowId,
          runId: run.id,
        },
      });
      return {
        detail: { outcome: "queued", outboundMessageId: outbound.id },
        outboundMessageId: outbound.id,
      };
    }

    case "condition": {
      const contact = ctx.contact;
      const runContext = (run.context ?? {}) as { triggerText?: unknown };
      const triggerText =
        typeof runContext.triggerText === "string" ? runContext.triggerText : "";
      let result = false;
      if (c.predicate === "has_tag") {
        result = !!contact && contact.tags.includes(String(c.tag ?? ""));
      } else if (c.predicate === "stage_equals") {
        result = !!contact && contact.pipelineStage === String(c.stage ?? "");
      } else if (c.predicate === "field_equals") {
        const field = c.field === "phone" || c.field === "email" ? c.field : "name";
        const actual = contact ? contact[field] : null;
        result = actual !== null && actual === String(c.value ?? "");
      } else if (c.predicate === "message_contains") {
        result = normalizeText(triggerText).includes(
          normalizeText(String(c.text ?? "")),
        );
      } else {
        throw new FlowNodeError(`predicate tidak dikenal: ${String(c.predicate)}`);
      }
      return {
        detail: {
          outcome: "evaluated",
          predicate: String(c.predicate ?? ""),
          result,
        },
        branch: result ? "yes" : "no",
      };
    }

    case "delay": {
      const amount = typeof c.amount === "number" ? c.amount : NaN;
      const unitMs =
        c.unit === "seconds" ? 1_000 : c.unit === "minutes" ? 60_000 : c.unit === "hours" ? 3_600_000 : NaN;
      if (!Number.isFinite(amount) || !Number.isFinite(unitMs)) {
        throw new FlowNodeError("delay dengan config amount/unit tidak sah");
      }
      // Smart Delay (Fase 9A): config.random {min, max} yang sah
      // mengalahkan amount tetap — durasi dipilih acak bilangan bulat
      // dalam [min, max] pada satuan node, dan pilihan itu DICATAT di
      // detail langkah (chosenAmount + rentangnya) agar bisa diaudit.
      // Random yang rusak di graf aktif lama (pra-validasi) diabaikan:
      // jatuh ke amount, tidak pernah menggagalkan run.
      const r = c.random as { min?: unknown; max?: unknown } | undefined;
      const randomValid =
        typeof r === "object" &&
        r !== null &&
        typeof r.min === "number" &&
        Number.isInteger(r.min) &&
        typeof r.max === "number" &&
        Number.isInteger(r.max) &&
        r.min >= 1 &&
        r.max >= r.min;
      if (randomValid) {
        const min = r.min as number;
        const max = r.max as number;
        const chosenAmount = min + Math.floor(Math.random() * (max - min + 1));
        const waitMs = Math.max(0, Math.floor(chosenAmount * unitMs));
        return {
          detail: {
            outcome: "waiting",
            delayMs: waitMs,
            resumeAt: new Date(Date.now() + waitMs).toISOString(),
            random: { min, max, unit: String(c.unit) },
            chosenAmount,
          },
          waitMs,
        };
      }
      const waitMs = Math.max(0, Math.floor(amount * unitMs));
      return {
        detail: {
          outcome: "waiting",
          delayMs: waitMs,
          resumeAt: new Date(Date.now() + waitMs).toISOString(),
        },
        waitMs,
      };
    }

    case "add_tag":
    case "remove_tag": {
      if (!ctx.contact) throw new FlowNodeError("kontak run tidak ditemukan");
      const tag = String(c.tag ?? "");
      if (!tag) throw new FlowNodeError(`${node.type} tanpa config.tag`);
      const has = ctx.contact.tags.includes(tag);
      if (node.type === "add_tag" && !has) {
        await tx
          .update(contacts)
          .set({ tags: [...ctx.contact.tags, tag], updatedAt: new Date() })
          .where(eq(contacts.id, ctx.contact.id));
      }
      if (node.type === "remove_tag" && has) {
        await tx
          .update(contacts)
          .set({
            tags: ctx.contact.tags.filter((t) => t !== tag),
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, ctx.contact.id));
      }
      return {
        detail: {
          outcome: node.type === "add_tag" ? "tag_added" : "tag_removed",
          tag,
          changed: node.type === "add_tag" ? !has : has,
        },
      };
    }

    case "set_stage": {
      if (!ctx.contact) throw new FlowNodeError("kontak run tidak ditemukan");
      const stage = String(c.stage ?? "");
      if (!stage) throw new FlowNodeError("set_stage tanpa config.stage");
      await tx
        .update(contacts)
        .set({ pipelineStage: stage, updatedAt: new Date() })
        .where(eq(contacts.id, ctx.contact.id));
      return {
        detail: {
          outcome: "stage_set",
          stage,
          previousStage: ctx.contact.pipelineStage,
        },
      };
    }

    case "enroll_sequence": {
      const automationId = String(c.automationId ?? "");
      if (!automationId) {
        throw new FlowNodeError("enroll_sequence tanpa config.automationId");
      }
      const [automation] = await tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.tenantId, tenantId),
            eq(automations.id, automationId),
          ),
        )
        .limit(1);
      if (!automation || automation.kind !== "sequence" || !automation.isActive) {
        // Sequence hilang/dinonaktifkan SETELAH aktivasi flow: langkah
        // dilewati beralasan, run lanjut — bukan kegagalan run.
        return {
          detail: { outcome: "skipped", reason: "sequence_unavailable", automationId },
        };
      }
      const steps = await tx
        .select()
        .from(automationSteps)
        .where(
          and(
            eq(automationSteps.tenantId, tenantId),
            eq(automationSteps.automationId, automationId),
          ),
        )
        .orderBy(asc(automationSteps.position));
      const firstStep = steps[0];
      if (!firstStep) {
        return {
          detail: { outcome: "skipped", reason: "no_steps", automationId },
        };
      }
      const [activeEnrollment] = await tx
        .select({ id: sequenceEnrollments.id })
        .from(sequenceEnrollments)
        .where(
          and(
            eq(sequenceEnrollments.automationId, automationId),
            eq(sequenceEnrollments.contactId, run.contactId),
            eq(sequenceEnrollments.status, "active"),
          ),
        )
        .limit(1);
      if (activeEnrollment) {
        await tx.insert(automationRuns).values({
          tenantId,
          automationId,
          contactId: run.contactId,
          conversationId: run.conversationId,
          triggerMessageId: run.triggerMessageId,
          status: "skipped",
          detail: {
            reason: "already_enrolled",
            enrollmentId: activeEnrollment.id,
            via: "flow",
            flowId: run.flowId,
            flowRunId: run.id,
          },
        });
        return {
          detail: {
            outcome: "skipped",
            reason: "already_enrolled",
            automationId,
            enrollmentId: activeEnrollment.id,
          },
        };
      }
      const now = new Date();
      const nextRunAt = new Date(now.getTime() + firstStep.delayMinutes * 60_000);
      const [enrollment] = await tx
        .insert(sequenceEnrollments)
        .values({
          tenantId,
          automationId,
          contactId: run.contactId,
          conversationId: run.conversationId,
          triggerMessageId: run.triggerMessageId,
          currentStep: 0,
          status: "active",
          nextRunAt,
        })
        .returning();
      const [autoRun] = await tx
        .insert(automationRuns)
        .values({
          tenantId,
          automationId,
          contactId: run.contactId,
          conversationId: run.conversationId,
          triggerMessageId: run.triggerMessageId,
          status: "completed",
          detail: {
            kind: "sequence",
            enrollmentId: enrollment.id,
            via: "flow",
            flowId: run.flowId,
            flowRunId: run.id,
          },
        })
        .returning();
      await tx.insert(auditLogs).values({
        tenantId,
        actorType: "system",
        actorId: `automation:${automationId}`,
        action: "sequence.enrolled",
        meta: {
          automationId,
          runId: autoRun.id,
          enrollmentId: enrollment.id,
          triggerMessageId: run.triggerMessageId,
          conversationId: run.conversationId,
          via: "flow",
          // Nama kunci via* disengaja: target audit sequence.enrolled
          // harus tetap sequence_enrollment (lihat deriveAuditTarget).
          viaFlowId: run.flowId,
          viaFlowRunId: run.id,
          firstStepPosition: firstStep.position,
          nextRunAt: nextRunAt.toISOString(),
        },
      });
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "sequence.step_due",
        payload: {
          enrollmentId: enrollment.id,
          automationId,
          stepPosition: firstStep.position,
          delayMinutes: firstStep.delayMinutes,
        },
      });
      return {
        detail: { outcome: "enrolled", automationId, enrollmentId: enrollment.id },
      };
    }

    case "set_field": {
      if (!ctx.contact) throw new FlowNodeError("kontak run tidak ditemukan");
      const field = String(c.field ?? "");
      // Nilai dirender PERSIS seperti send_message ({name} + spintax).
      const rendered = renderMessageText(
        typeof c.value === "string" ? c.value : "",
        { name: ctx.contact.name },
      );
      const patch: Partial<Contact> = { updatedAt: new Date() };
      if (field === "name") {
        // Kolom name NOT NULL — hasil render kosong adalah kegagalan
        // langkah yang jujur, bukan penulisan nilai rusak.
        if (!rendered) {
          throw new FlowNodeError("set_field name menghasilkan nilai kosong");
        }
        patch.name = rendered;
      } else if (field === "phone" || field === "email") {
        patch[field] = rendered ? rendered : null;
      } else if (field.startsWith("custom:") && field.length > "custom:".length) {
        const key = field.slice("custom:".length);
        patch.customFields = {
          ...(ctx.contact.customFields as Record<string, unknown>),
          [key]: rendered,
        };
      } else {
        throw new FlowNodeError(`set_field dengan field tidak sah: ${field}`);
      }
      await tx
        .update(contacts)
        .set(patch)
        .where(eq(contacts.id, ctx.contact.id));
      return {
        detail: {
          outcome: "field_set",
          field,
          value: rendered.slice(0, 200),
        },
      };
    }

    case "ab_split": {
      const percentA = c.percentA;
      if (
        typeof percentA !== "number" ||
        !Number.isInteger(percentA) ||
        percentA < 1 ||
        percentA > 99
      ) {
        throw new FlowNodeError("ab_split dengan config.percentA tidak sah");
      }
      // Fase 13D — mode eksperimen: penugasan DETERMINISTIK dan
      // LENGKET per (flow, node, kontak). Penugasan pertama
      // dipersistenkan (unik flow+node+kontak) dan selalu menang —
      // kontak tidak berpindah varian walau percentA diubah di
      // tengah eksperimen atau run diulang berapa pun kali.
      if (c.experiment === true && ctx.contact) {
        const contactId = ctx.contact.id;
        const [existing] = await tx
          .select({
            branch: flowExperimentAssignments.branch,
            percentA: flowExperimentAssignments.percentA,
          })
          .from(flowExperimentAssignments)
          .where(
            and(
              eq(flowExperimentAssignments.tenantId, tenantId),
              eq(flowExperimentAssignments.flowId, run.flowId),
              eq(flowExperimentAssignments.nodeId, node.id),
              eq(flowExperimentAssignments.contactId, contactId),
            ),
          )
          .limit(1);
        if (existing) {
          const branch = existing.branch === "b" ? "b" : "a";
          return {
            detail: {
              outcome: "split",
              experiment: true,
              percentA: existing.percentA,
              branch,
              sticky: true,
            },
            branch,
          };
        }
        const bucket = experimentBucket(
          flowExperimentKey(run.flowId, node.id, contactId),
        );
        const branch = flowBranchForBucket(bucket, percentA);
        const label =
          typeof c.experimentLabel === "string" && c.experimentLabel
            ? c.experimentLabel.slice(0, 255)
            : null;
        const [inserted] = await tx
          .insert(flowExperimentAssignments)
          .values({
            tenantId,
            flowId: run.flowId,
            nodeId: node.id,
            contactId,
            runId: run.id,
            branch,
            label,
            percentA,
          })
          .onConflictDoNothing()
          .returning({ branch: flowExperimentAssignments.branch });
        if (!inserted) {
          // Balapan resume ganda: penugasan serentak dari run lain
          // menang — baca ulang dan pakai branch-nya (kelengketan
          // tidak boleh kalah oleh balapan).
          const [raced] = await tx
            .select({ branch: flowExperimentAssignments.branch })
            .from(flowExperimentAssignments)
            .where(
              and(
                eq(flowExperimentAssignments.tenantId, tenantId),
                eq(flowExperimentAssignments.flowId, run.flowId),
                eq(flowExperimentAssignments.nodeId, node.id),
                eq(flowExperimentAssignments.contactId, contactId),
              ),
            )
            .limit(1);
          const racedBranch = raced?.branch === "b" ? "b" : branch;
          return {
            detail: {
              outcome: "split",
              experiment: true,
              percentA,
              bucket,
              branch: racedBranch,
              sticky: true,
            },
            branch: racedBranch,
          };
        }
        return {
          detail: {
            outcome: "split",
            experiment: true,
            percentA,
            bucket,
            branch,
            sticky: false,
          },
          branch,
        };
      }
      // Acak per run (12A, tanpa mode eksperimen); hasil undian
      // DICATAT agar distribusi bisa diaudit dari log langkah.
      const roll = Math.floor(Math.random() * 100);
      const branch = roll < percentA ? ("a" as const) : ("b" as const);
      return {
        detail: { outcome: "split", percentA, roll, branch },
        branch,
      };
    }

    case "wait_reply": {
      const amount = typeof c.amount === "number" ? c.amount : NaN;
      const unitMs =
        c.unit === "seconds" ? 1_000 : c.unit === "minutes" ? 60_000 : c.unit === "hours" ? 3_600_000 : NaN;
      if (!Number.isFinite(amount) || !Number.isFinite(unitMs)) {
        throw new FlowNodeError("wait_reply dengan config amount/unit tidak sah");
      }
      const waitMs = Math.max(0, Math.floor(amount * unitMs));
      return {
        detail: {
          outcome: "waiting",
          waitMs,
          deadline: new Date(Date.now() + waitMs).toISOString(),
          amount,
          unit: String(c.unit),
        },
        parkWaitReplyMs: waitMs,
      };
    }

    case "goto_flow": {
      const targetId = String(c.flowId ?? "");
      if (!targetId || !isUuidLike(targetId)) {
        throw new FlowNodeError(
          "flow tujuan goto tidak ada atau tidak aktif",
          "goto_target_unavailable",
        );
      }
      const runCtx = runContextOf(run);
      const depth = runCtx.gotoDepth ?? 0;
      // Pengaman siklus: kedalaman dibawa di konteks dan diwariskan ke
      // run tujuan; goto yang melewati batas GAGAL (run asal failed),
      // bukan diam-diam berhenti — operator harus melihat siklusnya.
      if (depth + 1 > FLOW_GOTO_MAX_DEPTH) {
        throw new FlowNodeError(
          `rantai goto melebihi kedalaman maksimum ${FLOW_GOTO_MAX_DEPTH}`,
          "goto_depth_exceeded",
        );
      }
      const [target] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.tenantId, tenantId), eq(flows.id, targetId)))
        .limit(1);
      if (!target || target.status !== "active") {
        throw new FlowNodeError(
          "flow tujuan goto tidak ada atau tidak aktif",
          "goto_target_unavailable",
        );
      }
      const targetGraph = normalizeFlowGraph(target.graph);
      const firstNodeId = firstNodeAfterTrigger(targetGraph);
      const now = new Date();
      const rootTriggerMessageId = effectiveTriggerMessageId(run);
      const [newRun] = await tx
        .insert(flowRuns)
        .values({
          tenantId,
          flowId: target.id,
          conversationId: run.conversationId,
          contactId: run.contactId,
          // Run goto tidak dipicu pesan masuk (migrasi 0038).
          triggerMessageId: null,
          status: firstNodeId ? "running" : "completed",
          currentNodeId: firstNodeId,
          nextStepSeq: 1,
          stepCount: 0,
          context: {
            triggerText: runCtx.triggerText ?? "",
            gotoDepth: depth + 1,
            ...(rootTriggerMessageId ? { rootTriggerMessageId } : {}),
            viaGoto: {
              fromRunId: run.id,
              fromFlowId: run.flowId,
              nodeId: node.id,
            },
          },
          completedAt: firstNodeId ? null : now,
        })
        .returning();
      await flowAudit(tx, tenantId, {
        actorType: "system",
        actorId: `flow:${target.id}`,
        action: "flow.run_started",
        flowId: target.id,
        meta: {
          flowRunId: newRun.id,
          conversationId: run.conversationId,
          via: "goto",
          fromRunId: run.id,
          fromFlowId: run.flowId,
          gotoDepth: depth + 1,
        },
      });
      if (!firstNodeId) {
        await flowAudit(tx, tenantId, {
          actorType: "system",
          actorId: `flow:${target.id}`,
          action: "flow.run_completed",
          flowId: target.id,
          meta: {
            flowRunId: newRun.id,
            conversationId: run.conversationId,
            reason: "empty_flow",
          },
        });
      } else {
        await tx.insert(outboxEvents).values({
          tenantId,
          type: "flow.step_due",
          payload: {
            runId: newRun.id,
            stepSeq: 1,
            resumeAt: now.toISOString(),
          },
        });
      }
      return {
        detail: {
          outcome: "goto",
          targetFlowId: target.id,
          targetRunId: newRun.id,
          gotoDepth: depth + 1,
        },
        // Run asal selesai di sini — kelanjutannya hidup di run tujuan.
        forceComplete: true,
      };
    }

    case "handoff": {
      await tx
        .update(conversations)
        .set({ agentEnabled: false, updatedAt: new Date() })
        .where(eq(conversations.id, run.conversationId));
      await tx.insert(auditLogs).values({
        tenantId,
        actorType: "system",
        actorId: `flow:${run.flowId}`,
        action: "agent.handoff",
        meta: {
          flowId: run.flowId,
          flowRunId: run.id,
          conversationId: run.conversationId,
          via: "flow",
        },
      });
      return { detail: { outcome: "handed_off" } };
    }

    case "end":
      return { detail: { outcome: "ended" }, forceComplete: true };

    default:
      throw new FlowNodeError(`tipe node tidak dikenal: ${node.type}`);
  }
}

/**
 * Menjalankan run flow untuk job BullMQ `flow.step`. Aman dipanggil
 * berulang: job basi (stepSeq != next_step_seq) dan run terminal
 * selesai diam-diam tanpa efek. Satu pemanggilan menjalankan node
 * demi node (transaksi per node) sampai run menunggu di node delay
 * atau mencapai status terminal.
 */
export async function executeFlowStep(
  db: Database,
  input: { tenantId: string; runId: string; stepSeq: number },
  deps: FlowStepDeps = {},
): Promise<ExecuteFlowStepResult> {
  const { tenantId, runId, stepSeq } = input;

  const initial = await loadRunContext(db, tenantId, runId);
  if (!initial) return { executed: false, reason: "run_not_found" };
  if (isTerminalStatus(initial.run.status)) {
    return {
      executed: false,
      reason: "run_terminal",
      status: initial.run.status,
      conversationId: initial.run.conversationId,
    };
  }
  if (stepSeq !== initial.run.nextStepSeq) {
    return {
      executed: false,
      reason: "stale_step",
      status: initial.run.status,
      conversationId: initial.run.conversationId,
    };
  }

  // Aturan berhenti opt-out: diperiksa saat resume/eksekusi (pasangan
  // pembatalan di jalur evaluasi pesan masuk).
  if (initial.contact?.optInStatus === "opted_out") {
    await withTenantDb(db, tenantId, async (tx) => {
      const now = new Date();
      await tx
        .update(flowRuns)
        .set({
          status: "cancelled",
          errorCode: "contact_opted_out",
          currentNodeId: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(flowRuns.id, runId),
            or(eq(flowRuns.status, "running"), eq(flowRuns.status, "waiting")),
          ),
        );
      await flowAudit(tx, tenantId, {
        actorType: "system",
        actorId: `flow:${initial.run.flowId}`,
        action: "flow.run_cancelled",
        flowId: initial.run.flowId,
        meta: {
          flowRunId: runId,
          conversationId: initial.run.conversationId,
          reason: "contact_opted_out",
        },
      });
    });
    return {
      executed: false,
      reason: "contact_opted_out",
      status: "cancelled",
      conversationId: initial.run.conversationId,
    };
  }

  let stepsExecuted = 0;
  let lastOutboundMessageId: string | undefined;

  for (;;) {
    const ctxState = await loadRunContext(db, tenantId, runId);
    if (!ctxState) return { executed: stepsExecuted > 0, reason: "run_not_found", stepsExecuted };
    const { run, graph } = ctxState;
    if (isTerminalStatus(run.status)) {
      return {
        executed: stepsExecuted > 0,
        status: run.status,
        conversationId: run.conversationId,
        outboundMessageId: lastOutboundMessageId,
        stepsExecuted,
      };
    }

    // Resume run waiting yang node terakhirnya delay di ujung graf:
    // tidak ada node tersisa → selesaikan.
    if (!run.currentNodeId) {
      await withTenantDb(db, tenantId, async (tx) => {
        const now = new Date();
        await tx
          .update(flowRuns)
          .set({ status: "completed", completedAt: now, updatedAt: now })
          .where(eq(flowRuns.id, runId));
        await flowAudit(tx, tenantId, {
          actorType: "system",
          actorId: `flow:${run.flowId}`,
          action: "flow.run_completed",
          flowId: run.flowId,
          meta: {
            flowRunId: runId,
            conversationId: run.conversationId,
            stepCount: run.stepCount,
            reason: "delay_tail",
          },
        });
      });
      return {
        executed: true,
        status: "completed",
        conversationId: run.conversationId,
        outboundMessageId: lastOutboundMessageId,
        stepsExecuted,
      };
    }

    const node = graph.nodes.find((n) => n.id === run.currentNodeId);
    if (!node) {
      await withTenantDb(db, tenantId, (tx) =>
        failRun(tx, tenantId, run, null, "node_missing", `node tidak ditemukan di graf: ${run.currentNodeId}`, { outcome: "failed", reason: "node_missing" }),
      );
      return {
        executed: stepsExecuted > 0,
        status: "failed",
        conversationId: run.conversationId,
        stepsExecuted,
      };
    }

    // Fase 12A — run parkir di wait_reply: job yang tiba adalah job
    // tenggatnya (seq sudah dicocokkan di pintu masuk). Bila run masih
    // parkir saat job ini diproses, tenggat lewat tanpa balasan →
    // selesaikan parkir lewat branch "timeout", lalu loop lanjut ke
    // node cabang seperti langkah biasa. Balasan yang datang lebih
    // dulu sudah menyelesaikan parkir (context.wait hilang / status
    // berubah) sehingga pemeriksaan segar di dalam transaksi menolak.
    const parkedCtx = runContextOf(run);
    if (
      run.status === "waiting" &&
      node.type === "wait_reply" &&
      parkedCtx.wait &&
      parkedCtx.wait.nodeId === node.id
    ) {
      const resolved: AdvanceResult = await withTenantDb(
        db,
        tenantId,
        async (tx) => {
          const [fresh] = await tx
            .select()
            .from(flowRuns)
            .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
            .limit(1);
          if (!fresh || isTerminalStatus(fresh.status)) {
            return { applied: false, reason: "run_terminal" as const };
          }
          const freshCtx = runContextOf(fresh);
          if (
            fresh.status !== "waiting" ||
            !freshCtx.wait ||
            freshCtx.wait.nodeId !== node.id ||
            fresh.nextStepSeq !== run.nextStepSeq
          ) {
            return { applied: false, reason: "stale_step" as const };
          }
          const parkedAtMs = Date.parse(freshCtx.wait.parkedAt);
          const r = await resolveParkedWaitReply(
            tx,
            tenantId,
            fresh,
            graph,
            node,
            {
              branch: "timeout",
              extraDetail: {
                deadline: freshCtx.wait.deadline,
                waitedMs: Number.isNaN(parkedAtMs)
                  ? null
                  : Math.max(0, Date.now() - parkedAtMs),
              },
            },
          );
          return { applied: true, status: r.status };
        },
      );
      if (!resolved.applied) {
        return {
          executed: stepsExecuted > 0,
          reason:
            resolved.reason === "stale_step" ? "stale_step" : "run_terminal",
          conversationId: run.conversationId,
          stepsExecuted,
        };
      }
      stepsExecuted += 1;
      if (isTerminalStatus(resolved.status!)) {
        return {
          executed: true,
          status: resolved.status,
          conversationId: run.conversationId,
          outboundMessageId: lastOutboundMessageId,
          stepsExecuted,
        };
      }
      continue;
    }

    // Cap langkah: graf melingkar tanpa delay berhenti di sini.
    if (run.stepCount >= FLOW_MAX_STEPS) {
      await withTenantDb(db, tenantId, (tx) =>
        failRun(
          tx,
          tenantId,
          run,
          node,
          "step_cap_exceeded",
          `cap ${FLOW_MAX_STEPS} langkah per run tercapai`,
          { outcome: "cap_exceeded", stepCap: FLOW_MAX_STEPS },
        ),
      );
      return {
        executed: stepsExecuted > 0,
        status: "failed",
        conversationId: run.conversationId,
        stepsExecuted,
      };
    }

    // Node ai_response: panggil jalur agent.respond yang ada DI LUAR
    // transaksi langkah (panggilan LLM tidak boleh menahan transaksi).
    // Hasil apa pun (termasuk skipped) dicatat sebagai langkah; run
    // lanjut — agent yang tidak tersedia BUKAN kegagalan flow.
    if (node.type === "ai_response") {
      let detail: Record<string, unknown>;
      // Run goto tidak punya trigger_message_id sendiri — pakai pesan
      // pemicu run akar dari konteks (Fase 12A).
      const aiMessageId = effectiveTriggerMessageId(run);
      if (!aiMessageId) {
        detail = { outcome: "skipped", reason: "no_trigger_message" };
      } else if (!deps.resolveLlmProvider) {
        detail = { outcome: "skipped", reason: "llm_unavailable" };
      } else {
        try {
          const provider = await deps.resolveLlmProvider();
          const embeddingProvider = deps.resolveEmbeddingProvider
            ? await deps.resolveEmbeddingProvider().catch(() => null)
            : null;
          const res = await respondToInboundMessage(db, provider, {
            tenantId,
            conversationId: run.conversationId,
            messageId: aiMessageId,
            publicBaseUrl: deps.publicBaseUrl,
            embeddingProvider,
          });
          detail = {
            outcome: res.responded ? "responded" : "skipped",
            ...(res.reason ? { reason: res.reason } : {}),
            ...(res.mode ? { mode: res.mode } : {}),
            ...(res.outboundMessageId
              ? { outboundMessageId: res.outboundMessageId }
              : {}),
            ...(res.suggestionId ? { suggestionId: res.suggestionId } : {}),
          };
          if (res.outboundMessageId) {
            lastOutboundMessageId = res.outboundMessageId;
          }
        } catch {
          detail = { outcome: "skipped", reason: "provider_error" };
        }
      }
      const applied: AdvanceResult = await withTenantDb(db, tenantId, async (tx) => {
        const [fresh] = await tx
          .select()
          .from(flowRuns)
          .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
          .limit(1);
        if (!fresh || isTerminalStatus(fresh.status)) {
          return { applied: false, reason: "run_terminal" as const };
        }
        if (fresh.nextStepSeq !== run.nextStepSeq) {
          return { applied: false, reason: "stale_step" as const };
        }
        const adv = await advanceRun(tx, tenantId, fresh, graph, node, { detail });
        return { applied: true, status: adv.status };
      });
      if (!applied.applied) {
        return {
          executed: stepsExecuted > 0,
          reason: applied.reason === "stale_step" ? "stale_step" : "run_terminal",
          conversationId: run.conversationId,
          stepsExecuted,
        };
      }
      stepsExecuted += 1;
      if (applied.status === "waiting" || isTerminalStatus(applied.status!)) {
        return {
          executed: true,
          status: applied.status,
          conversationId: run.conversationId,
          outboundMessageId: lastOutboundMessageId,
          stepsExecuted,
        };
      }
      continue;
    }

    // Node http_request (Fase 12A): fetch DI LUAR transaksi langkah.
    // Node ini TIDAK PERNAH menggagalkan run (keputusan desain di
    // kontrak): config rusak, jaringan mati, dan non-2xx semuanya
    // menjadi detail langkah `http_error` dan run lanjut ke node
    // berikutnya. saveToField hanya menulis pada respons 2xx.
    if (node.type === "http_request") {
      const c = node.config;
      const contact = ctxState.contact;
      const method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
        String(c.method),
      )
        ? String(c.method)
        : "POST";
      const url = renderFlowHttpTemplate(
        typeof c.url === "string" ? c.url : "",
        contact,
      );
      const headers: Record<string, string> = {};
      if (
        typeof c.headers === "object" &&
        c.headers !== null &&
        !Array.isArray(c.headers)
      ) {
        for (const [k, v] of Object.entries(
          c.headers as Record<string, unknown>,
        )) {
          if (typeof v === "string") {
            headers[k] = renderFlowHttpTemplate(v, contact);
          }
        }
      }
      const bodyText =
        typeof c.body === "string"
          ? renderFlowHttpTemplate(c.body, contact)
          : "";
      const saveFieldRaw =
        typeof c.saveToField === "string" ? c.saveToField : "";
      const saveKey =
        saveFieldRaw.startsWith("custom:") && saveFieldRaw.length > 7
          ? saveFieldRaw.slice("custom:".length)
          : null;
      const startedAtMs = Date.now();
      let httpStatus: number | null = null;
      let responseText = "";
      let errorText: string | null = null;
      if (!url) {
        errorText = "url_kosong";
      } else {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          FLOW_HTTP_TIMEOUT_MS,
        );
        try {
          const sendBody = method !== "GET" && bodyText.length > 0;
          const hasContentType = Object.keys(headers).some(
            (k) => k.toLowerCase() === "content-type",
          );
          const res = await fetch(url, {
            method,
            headers: {
              ...(sendBody && !hasContentType
                ? { "content-type": "application/json" }
                : {}),
              ...headers,
            },
            ...(sendBody ? { body: bodyText } : {}),
            signal: controller.signal,
            redirect: "follow",
          });
          httpStatus = res.status;
          responseText = (await res.text()).slice(0, 10_000);
        } catch (err) {
          errorText =
            err instanceof Error
              ? `${err.name}: ${err.message}`.slice(0, 300)
              : "network_error";
        } finally {
          clearTimeout(timer);
        }
      }
      const httpOk =
        httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
      const detail: Record<string, unknown> = {
        outcome: httpOk ? "http_response" : "http_error",
        method,
        url: url.slice(0, 300),
        status: httpStatus,
        durationMs: Date.now() - startedAtMs,
        responsePreview: responseText.slice(0, 500),
        ...(errorText ? { error: errorText } : {}),
        ...(saveKey && httpOk ? { savedToField: `custom:${saveKey}` } : {}),
      };
      const applied: AdvanceResult = await withTenantDb(
        db,
        tenantId,
        async (tx) => {
          const [fresh] = await tx
            .select()
            .from(flowRuns)
            .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
            .limit(1);
          if (!fresh || isTerminalStatus(fresh.status)) {
            return { applied: false, reason: "run_terminal" as const };
          }
          if (fresh.nextStepSeq !== run.nextStepSeq) {
            return { applied: false, reason: "stale_step" as const };
          }
          if (saveKey && httpOk) {
            const [freshContact] = await tx
              .select({ customFields: contacts.customFields })
              .from(contacts)
              .where(eq(contacts.id, run.contactId))
              .limit(1);
            if (freshContact) {
              await tx
                .update(contacts)
                .set({
                  customFields: {
                    ...(freshContact.customFields as Record<string, unknown>),
                    [saveKey]: responseText.slice(0, 2000),
                  },
                  updatedAt: new Date(),
                })
                .where(eq(contacts.id, run.contactId));
            }
          }
          const adv = await advanceRun(tx, tenantId, fresh, graph, node, {
            detail,
          });
          return { applied: true, status: adv.status };
        },
      );
      if (!applied.applied) {
        return {
          executed: stepsExecuted > 0,
          reason:
            applied.reason === "stale_step" ? "stale_step" : "run_terminal",
          conversationId: run.conversationId,
          stepsExecuted,
        };
      }
      stepsExecuted += 1;
      if (applied.status === "waiting" || isTerminalStatus(applied.status!)) {
        return {
          executed: true,
          status: applied.status,
          conversationId: run.conversationId,
          outboundMessageId: lastOutboundMessageId,
          stepsExecuted,
        };
      }
      continue;
    }

    // Node send_payment_link (Fase 12A): layanan payment link yang
    // sama dengan tool agent 4A (createPaymentLink membuka
    // transaksinya sendiri) dipanggil DI LUAR transaksi langkah.
    // Produk tak ditemukan/arsip = kegagalan keras yang tercatat
    // (payment_product_unavailable) — berbeda dari http_request,
    // karena mengirim link pembayaran yang salah/tidak ada lebih
    // buruk daripada menghentikan run.
    if (node.type === "send_payment_link") {
      const productId = String(node.config.productId ?? "");
      const product = isUuidLike(productId)
        ? await withTenantDb(db, tenantId, async (tx) => {
            const [row] = await tx
              .select({
                id: products.id,
                name: products.name,
                isActive: products.isActive,
              })
              .from(products)
              .where(
                and(
                  eq(products.tenantId, tenantId),
                  eq(products.id, productId),
                ),
              )
              .limit(1);
            return row ?? null;
          })
        : null;
      if (!product || !product.isActive) {
        await withTenantDb(db, tenantId, (tx) =>
          failRun(
            tx,
            tenantId,
            run,
            node,
            "payment_product_unavailable",
            "produk untuk send_payment_link tidak ditemukan atau tidak aktif",
            {
              outcome: "failed",
              reason: "payment_product_unavailable",
              productId,
            },
          ),
        );
        return {
          executed: true,
          status: "failed",
          conversationId: run.conversationId,
          stepsExecuted: stepsExecuted + 1,
        };
      }
      const created = await createPaymentLink(
        db,
        { tenantId },
        {
          productId: product.id,
          contactId: run.contactId,
          conversationId: run.conversationId,
        },
        { actorType: "system", actorId: `flow:${run.flowId}` },
      );
      if (created.kind !== "ok") {
        await withTenantDb(db, tenantId, (tx) =>
          failRun(
            tx,
            tenantId,
            run,
            node,
            "payment_link_failed",
            `payment link gagal dibuat: ${created.kind}`,
            { outcome: "failed", reason: "payment_link_failed", productId },
          ),
        );
        return {
          executed: true,
          status: "failed",
          conversationId: run.conversationId,
          stepsExecuted: stepsExecuted + 1,
        };
      }
      // Format teks PERSIS pola tool agent 4A.
      const paymentUrl = buildPaymentUrl(deps.publicBaseUrl, created.link.code);
      const paymentText = `Link pembayaran ${product.name}: ${paymentUrl} (berlaku 7 hari)`;
      const applied: AdvanceResult = await withTenantDb(
        db,
        tenantId,
        async (tx) => {
          const [fresh] = await tx
            .select()
            .from(flowRuns)
            .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
            .limit(1);
          if (!fresh || isTerminalStatus(fresh.status)) {
            return { applied: false, reason: "run_terminal" as const };
          }
          if (fresh.nextStepSeq !== run.nextStepSeq) {
            return { applied: false, reason: "stale_step" as const };
          }
          if (!ctxState.conversation) {
            await failRun(
              tx,
              tenantId,
              fresh,
              node,
              "step_error",
              "percakapan run tidak ditemukan",
              { outcome: "failed" },
            );
            return { applied: true, status: "failed" as const };
          }
          const [outbound] = await tx
            .insert(messages)
            .values({
              tenantId,
              conversationId: run.conversationId,
              direction: "outbound",
              senderType: "system",
              type: "text",
              contentText: paymentText,
              status: "queued",
            })
            .returning();
          const now = new Date();
          await tx
            .update(conversations)
            .set({ lastMessageAt: now, updatedAt: now })
            .where(eq(conversations.id, run.conversationId));
          await tx.insert(outboxEvents).values({
            tenantId,
            type: "message.queued",
            payload: {
              provider: ctxState.conversation.provider,
              conversationId: run.conversationId,
              messageId: outbound.id,
              via: "flow",
              flowId: run.flowId,
              runId: run.id,
              paymentLinkId: created.link.id,
            },
          });
          const adv = await advanceRun(tx, tenantId, fresh, graph, node, {
            detail: {
              outcome: "payment_link_sent",
              productId: product.id,
              paymentLinkId: created.link.id,
              code: created.link.code,
              amountIdr: created.link.amountIdr,
            },
          });
          return {
            applied: true,
            status: adv.status,
            outboundMessageId: outbound.id,
          };
        },
      );
      if (!applied.applied) {
        return {
          executed: stepsExecuted > 0,
          reason:
            applied.reason === "stale_step" ? "stale_step" : "run_terminal",
          conversationId: run.conversationId,
          stepsExecuted,
        };
      }
      stepsExecuted += 1;
      if (applied.outboundMessageId) {
        lastOutboundMessageId = applied.outboundMessageId;
      }
      if (applied.status === "waiting" || isTerminalStatus(applied.status!)) {
        return {
          executed: true,
          status: applied.status,
          conversationId: run.conversationId,
          outboundMessageId: lastOutboundMessageId,
          stepsExecuted,
        };
      }
      continue;
    }

    // Node biasa: efek + baris langkah + kemajuan run dalam SATU
    // transaksi tenant. Kegagalan node (FlowNodeError) menandai run
    // failed dengan baris langkah error — job TIDAK melempar.
    const applied: AdvanceResult = await withTenantDb(db, tenantId, async (tx) => {
      const [fresh] = await tx
        .select()
        .from(flowRuns)
        .where(and(eq(flowRuns.tenantId, tenantId), eq(flowRuns.id, runId)))
        .limit(1);
      if (!fresh || isTerminalStatus(fresh.status)) {
        return { applied: false, reason: "run_terminal" as const };
      }
      if (fresh.nextStepSeq !== run.nextStepSeq) {
        return { applied: false, reason: "stale_step" as const };
      }
      const freshCtx: RunContext = { ...ctxState, run: fresh };
      let effects: NodeEffects;
      try {
        effects = await executeNodeInTx(tx, tenantId, freshCtx, node);
      } catch (err) {
        if (err instanceof FlowNodeError) {
          await failRun(
            tx,
            tenantId,
            fresh,
            node,
            err.code ?? "step_error",
            err.message,
            { outcome: "failed", ...(err.code ? { reason: err.code } : {}) },
          );
          return { applied: true, status: "failed" as const };
        }
        throw err;
      }
      const adv = await advanceRun(tx, tenantId, fresh, graph, node, {
        detail: effects.detail,
        branch: effects.branch,
        waitMs: effects.waitMs,
        parkWaitReplyMs: effects.parkWaitReplyMs,
        forceComplete: effects.forceComplete,
      });
      return {
        applied: true,
        status: adv.status,
        outboundMessageId: effects.outboundMessageId,
      };
    });
    if (!applied.applied) {
      return {
        executed: stepsExecuted > 0,
        reason: applied.reason === "stale_step" ? "stale_step" : "run_terminal",
        conversationId: run.conversationId,
        stepsExecuted,
      };
    }
    stepsExecuted += 1;
    if (applied.outboundMessageId) {
      lastOutboundMessageId = applied.outboundMessageId;
    }
    if (applied.status === "waiting" || isTerminalStatus(applied.status!)) {
      return {
        executed: true,
        status: applied.status,
        conversationId: run.conversationId,
        outboundMessageId: lastOutboundMessageId,
        stepsExecuted,
      };
    }
    // status 'running' → lanjut ke node berikutnya dalam pemanggilan ini.
  }
}
