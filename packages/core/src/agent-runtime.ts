import { and, eq, gte, sql } from "drizzle-orm";
import {
  auditLogs,
  agentSuggestions,
  contacts,
  conversations,
  messages,
  outboxEvents,
  usageLedger,
  type Database,
} from "@sahabat-kreator/db";
import {
  AGENT_TOOLS,
  isPipelineStage,
  type LlmProvider,
  type LlmToolCall,
} from "@sahabat-kreator/ai";
import type { TenantContext } from "./tenant";
import { withTenantDb, type DbTx } from "./tx";
import { getActiveAgent } from "./agents";
import { listMessages } from "./conversations";
import { searchKbChunks } from "./kb";
import {
  buildPaymentUrl,
  createPaymentLink,
  matchActiveProductForPayment,
} from "./products";

/**
 * Runtime AI Agent (Fase 3A, RANCANGAN §5.1 langkah 5–9).
 * Transport-agnostic: dipanggil worker lewat job `agent.respond` SETELAH
 * evaluasi automation selesai tanpa tembakan (urutan pasti: keyword dulu,
 * AI kemudian — penegakannya di worker, lihat apps/worker).
 *
 * Alur `respondToInboundMessage`:
 * 1. Muat pemicu + percakapan + kontak dalam konteks RLS tenant. Hanya
 *    pesan inbound dari kontak (sender_type='contact') yang dijawab, dan
 *    hanya bila percakapan masih mengizinkan AI
 *    (`conversations.agent_enabled` — kolom Fase 1D; tool handoff
 *    mematikannya, sesuai catatan di schema/agents.ts).
 * 2. Cek caps harian tenant (AGENT_DAILY_RESPONSE_CAP respons/hari dari
 *    usage_ledger; lewat → audit `agent.capped`, tidak menjawab).
 * 3. Rakit konteks: prompt sistem agent + riwayat 20 pesan terakhir +
 *    retrieval KB (full-text, top 5) untuk teks pesan pemicu.
 * 4. Panggil provider LLM (@sahabat-kreator/ai). Error/timeout provider →
 *    audit `agent.failed`, TIDAK ada pesan keluar, job tidak crash.
 * 5. Catat metering: usage_ledger type='ai_token' (qty = total token,
 *    biaya model dicatat dari provider — mock selalu 0; rincian
 *    provider/model/token ada di audit `agent.responded` karena
 *    usage_ledger memang tidak punya kolom metadata) + audit.
 * 6. Mode 'auto': tool dieksekusi, lalu teks balasan menjadi pesan
 *    outbound sender_type='agent' berstatus 'queued' + event outbox
 *    `message.queued` (pengiriman sungguhan oleh poller API seperti
 *    automation — worker tidak menyentuh transport).
 *    Mode 'suggest': teks + tool yang DIUSULKAN disimpan sebagai
 *    agent_suggestions 'pending'; TIDAK ada pesan keluar dan TIDAK ada
 *    tool yang dieksekusi (approve manusia pun hanya mengirim teks —
 *    lihat suggestions.ts).
 */

export const AGENT_DAILY_RESPONSE_CAP = 200;
/** refType pada usage_ledger untuk satu respons agent (dasar hitung caps). */
export const AGENT_USAGE_REF_TYPE = "agent_response";

const HISTORY_LIMIT = 20;
const KB_HIT_LIMIT = 5;

// ---------------------------------------------------------------------------
// Executor tool — diekspor terpisah agar bisa diuji integrasi langsung
// (mis. jalur handoff yang tidak pernah dipicu MockProvider).
// ---------------------------------------------------------------------------

export interface AgentToolContext {
  agentId: string;
  contactId: string;
  conversationId: string;
}

export interface AgentToolOutcome {
  name: string;
  executed: boolean;
  /** Kode hasil stabil: 'tagged', 'tag_already_present', 'stage_moved', 'handoff_done', 'invalid_tag', 'invalid_stage', 'contact_not_found', 'unknown_tool', 'payment_link_sent', 'payment_link_sent_fallback_product', 'no_active_product', ... */
  note: string;
}

export interface AgentToolOptions {
  /**
   * Base URL publik aplikasi (env BETTER_AUTH_URL, diteruskan worker) —
   * dipakai tool `send_payment_link` untuk merangkai URL /pay/:code yang
   * dikirim ke lawan bicara. Kosong → URL relatif (fallback jujur).
   */
  publicBaseUrl?: string;
}

async function insertAgentAudit(
  tx: DbTx,
  tenantId: string,
  agentId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId,
    actorType: "agent",
    actorId: `agent:${agentId}`,
    action,
    meta,
  });
}

/**
 * Mengeksekusi SATU tool call agent terhadap data tenant (RLS aktif).
 * Tidak pernah melempar untuk input tool yang buruk — hasil buruk dicatat
 * sebagai outcome executed=false agar loop tetap berjalan.
 */
export async function executeAgentToolCall(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  toolCtx: AgentToolContext,
  call: LlmToolCall,
  options?: AgentToolOptions,
): Promise<AgentToolOutcome> {
  const { tenantId } = ctx;

  if (call.name === "tag_contact") {
    const rawTag =
      typeof call.arguments.tag === "string" ? call.arguments.tag : "";
    const tag = rawTag
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_]/g, "")
      .slice(0, 64);
    if (!tag) return { name: call.name, executed: false, note: "invalid_tag" };
    return withTenantDb(db, tenantId, async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.id, toolCtx.contactId),
          ),
        )
        .limit(1);
      if (!contact) {
        return { name: call.name, executed: false, note: "contact_not_found" };
      }
      if (contact.tags.includes(tag)) {
        return {
          name: call.name,
          executed: false,
          note: "tag_already_present",
        };
      }
      await tx
        .update(contacts)
        .set({ tags: [...contact.tags, tag], updatedAt: new Date() })
        .where(eq(contacts.id, contact.id));
      await insertAgentAudit(tx, tenantId, toolCtx.agentId, "contact.tagged", {
        tag,
        contactId: contact.id,
        conversationId: toolCtx.conversationId,
        via: "agent_tool",
      });
      return { name: call.name, executed: true, note: "tagged" };
    });
  }

  if (call.name === "move_pipeline_stage") {
    const stage = call.arguments.stage;
    if (!isPipelineStage(stage)) {
      return { name: call.name, executed: false, note: "invalid_stage" };
    }
    return withTenantDb(db, tenantId, async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.id, toolCtx.contactId),
          ),
        )
        .limit(1);
      if (!contact) {
        return { name: call.name, executed: false, note: "contact_not_found" };
      }
      const from = contact.pipelineStage;
      await tx
        .update(contacts)
        .set({ pipelineStage: stage, updatedAt: new Date() })
        .where(eq(contacts.id, contact.id));
      await insertAgentAudit(
        tx,
        tenantId,
        toolCtx.agentId,
        "contact.stage_changed",
        {
          from,
          to: stage,
          contactId: contact.id,
          conversationId: toolCtx.conversationId,
          via: "agent_tool",
        },
      );
      return { name: call.name, executed: true, note: "stage_moved" };
    });
  }

  if (call.name === "handoff_to_human") {
    const reason =
      typeof call.arguments.reason === "string"
        ? call.arguments.reason.slice(0, 500)
        : "";
    return withTenantDb(db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({ agentEnabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, toolCtx.conversationId),
          ),
        )
        .returning({ id: conversations.id });
      if (!updated) {
        return {
          name: call.name,
          executed: false,
          note: "conversation_not_found",
        };
      }
      await insertAgentAudit(tx, tenantId, toolCtx.agentId, "agent.handoff", {
        reason,
        contactId: toolCtx.contactId,
        conversationId: toolCtx.conversationId,
        via: "agent_tool",
      });
      return { name: call.name, executed: true, note: "handoff_done" };
    });
  }

  if (call.name === "send_payment_link") {
    // Fase 4A: buat tautan bayar (snapshot harga produk) lalu kirim sebagai
    // pesan outbound agent TERPISAH dari teks balasan utama — tautan adalah
    // artefak yang harus bisa dilacak status bayarnya sendiri.
    // CATATAN JUJUR: provider tautan fase ini 'simulation' — belum ada
    // gerbang pembayaran sungguhan; halaman /pay berlabel simulasi.
    const query =
      typeof call.arguments.productName === "string"
        ? call.arguments.productName
        : undefined;
    const match = await matchActiveProductForPayment(db, ctx, query);
    if (!match) {
      return { name: call.name, executed: false, note: "no_active_product" };
    }
    const created = await createPaymentLink(
      db,
      ctx,
      {
        productId: match.product.id,
        contactId: toolCtx.contactId,
        conversationId: toolCtx.conversationId,
      },
      { actorType: "agent", actorId: `agent:${toolCtx.agentId}` },
    );
    if (created.kind !== "ok") {
      return { name: call.name, executed: false, note: created.kind };
    }
    const url = buildPaymentUrl(options?.publicBaseUrl, created.link.code);
    const text = `Link pembayaran ${match.product.name}: ${url} (berlaku 7 hari)`;
    const sent = await withTenantDb(db, tenantId, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, toolCtx.conversationId),
          ),
        )
        .limit(1);
      if (!conversation) return false;
      const [outbound] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId: toolCtx.conversationId,
          direction: "outbound",
          senderType: "agent",
          type: "text",
          contentText: text,
          status: "queued",
        })
        .returning();
      const now = new Date();
      await tx
        .update(conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversations.id, toolCtx.conversationId));
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "message.queued",
        payload: {
          provider: conversation.provider,
          conversationId: toolCtx.conversationId,
          messageId: outbound.id,
          via: "agent_tool",
          tool: "send_payment_link",
          agentId: toolCtx.agentId,
          paymentLinkId: created.link.id,
        },
      });
      // Jejak eksplisit pilihan produk agent (termasuk jalur fallback ke
      // produk aktif pertama) — di luar audit payment_link.created generik.
      await insertAgentAudit(tx, tenantId, toolCtx.agentId, "agent.payment_link", {
        paymentLinkId: created.link.id,
        code: created.link.code,
        productId: match.product.id,
        productName: match.product.name,
        matchedByName: match.matchedByName,
        query: query ?? null,
        contactId: toolCtx.contactId,
        conversationId: toolCtx.conversationId,
        via: "agent_tool",
      });
      return true;
    });
    if (!sent) {
      return { name: call.name, executed: false, note: "conversation_not_found" };
    }
    return {
      name: call.name,
      executed: true,
      note: match.matchedByName
        ? "payment_link_sent"
        : "payment_link_sent_fallback_product",
    };
  }

  return { name: call.name, executed: false, note: "unknown_tool" };
}

// ---------------------------------------------------------------------------
// Loop utama
// ---------------------------------------------------------------------------

export type AgentSkipReason =
  | "message_not_found"
  | "not_inbound"
  | "not_from_contact"
  | "conversation_not_found"
  | "channel_conversation"
  | "ai_disabled"
  | "no_active_agent"
  | "capped"
  | "provider_error"
  | "empty_response";

export interface AgentRespondResult {
  responded: boolean;
  reason?: AgentSkipReason;
  mode?: "auto" | "suggest";
  outboundMessageId?: string;
  suggestionId?: string;
  toolOutcomes?: AgentToolOutcome[];
}

async function recordUsageAndAudit(
  db: Database,
  tenantId: string,
  input: {
    agentId: string;
    triggerMessageId: string;
    tokensIn: number;
    tokensOut: number;
    auditMeta: Record<string, unknown>;
    extra?: (tx: DbTx) => Promise<void>;
  },
): Promise<void> {
  await withTenantDb(db, tenantId, async (tx) => {
    if (input.extra) await input.extra(tx);
    await tx.insert(usageLedger).values({
      tenantId,
      type: "ai_token",
      qty: String(input.tokensIn + input.tokensOut),
      costModel: "0",
      costProvider: "0",
      currency: "IDR",
      refType: AGENT_USAGE_REF_TYPE,
      refId: input.triggerMessageId,
    });
    await insertAgentAudit(tx, tenantId, input.agentId, "agent.responded", {
      triggerMessageId: input.triggerMessageId,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      ...input.auditMeta,
    });
  });
}

export async function respondToInboundMessage(
  db: Database,
  provider: LlmProvider,
  input: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    /** Base URL publik untuk tool send_payment_link (dari env worker). */
    publicBaseUrl?: string;
  },
): Promise<AgentRespondResult> {
  const { tenantId, conversationId, messageId } = input;
  const ctx = { tenantId };

  // 1. Muat konteks pemicu.
  const loaded = await withTenantDb(db, tenantId, async (tx) => {
    const [message] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, messageId)))
      .limit(1);
    if (!message) return { kind: "message_not_found" as const };
    if (message.direction !== "inbound") return { kind: "not_inbound" as const };
    if (message.senderType !== "contact") {
      return { kind: "not_from_contact" as const };
    }
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conversation) return { kind: "conversation_not_found" as const };
    // PENJAGA CHANNEL (Fase 6A.2): postingan channel siaran bukan pesan
    // percakapan — agent TIDAK PERNAH menjawabnya. Jalur ingest channel
    // tidak menulis event outbox, jadi ini lapis kedua untuk event liar
    // (pasangan penjaga yang sama di evaluateInboundMessageForAutomations).
    if (conversation.kind === "channel") {
      return { kind: "channel_conversation" as const };
    }
    if (!conversation.agentEnabled) return { kind: "ai_disabled" as const };
    return { kind: "ok" as const, message, conversation };
  });
  if (loaded.kind !== "ok") return { responded: false, reason: loaded.kind };
  const { message, conversation } = loaded;

  // 2. Agent aktif tenant (tertua).
  const agent = await getActiveAgent(db, ctx);
  if (!agent) return { responded: false, reason: "no_active_agent" };

  // 3. Caps harian (hari berjalan UTC, dari usage_ledger).
  const usedToday = await withTenantDb(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.tenantId, tenantId),
          eq(usageLedger.type, "ai_token"),
          eq(usageLedger.refType, AGENT_USAGE_REF_TYPE),
          gte(usageLedger.createdAt, sql`date_trunc('day', now())`),
        ),
      );
    return row?.n ?? 0;
  });
  if (usedToday >= AGENT_DAILY_RESPONSE_CAP) {
    await withTenantDb(db, tenantId, async (tx) => {
      await insertAgentAudit(tx, tenantId, agent.id, "agent.capped", {
        conversationId,
        triggerMessageId: messageId,
        cap: AGENT_DAILY_RESPONSE_CAP,
        usedToday,
      });
    });
    return { responded: false, reason: "capped" };
  }

  // 4. Riwayat + retrieval KB dari teks pesan pemicu.
  const history = (await listMessages(db, ctx, conversationId, {
    limit: HISTORY_LIMIT,
  })) ?? [];
  const triggerText = message.contentText ?? "";
  const hits = await searchKbChunks(db, ctx, triggerText, KB_HIT_LIMIT);

  const languageLine = agent.config.language
    ? `\nBahasa balasan: ${agent.config.language}.`
    : "\nJawab mengikuti bahasa lawan bicara.";
  const system =
    `${agent.systemPrompt.trim()}${languageLine}\n` +
    "Kamu adalah agent layanan pelanggan. Jawab ringkas dan hanya berdasarkan fakta dari basis pengetahuan bila tersedia; jangan mengarang harga/fakta. " +
    "Kamu boleh memakai tool tag_contact, move_pipeline_stage, send_payment_link (bila kontak ingin membeli), dan handoff_to_human bila relevan.";

  // 5. Panggil provider — error dicatat, tidak pernah melempar keluar.
  let result: Awaited<ReturnType<LlmProvider["chat"]>>;
  try {
    result = await provider.chat({
      system,
      messages: history
        .filter((m) => (m.contentText ?? "").trim().length > 0)
        .map((m) => ({
          role:
            m.direction === "inbound"
              ? ("user" as const)
              : ("assistant" as const),
          content: m.contentText ?? "",
        })),
      tools: AGENT_TOOLS,
      kbChunks: hits.map((h) => h.content),
      model: agent.model || undefined,
    });
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    await withTenantDb(db, tenantId, async (tx) => {
      await insertAgentAudit(tx, tenantId, agent.id, "agent.failed", {
        conversationId,
        triggerMessageId: messageId,
        provider: provider.name,
        error: errorText.slice(0, 500),
      });
    }).catch(() => undefined);
    return { responded: false, reason: "provider_error" };
  }

  let text = result.text.trim();
  const maxChars = agent.config.maxReplyChars;
  if (maxChars && text.length > maxChars) text = text.slice(0, maxChars);
  const auditMeta = {
    agentId: agent.id,
    provider: result.provider,
    model: result.model,
    conversationId,
    kbChunkIds: hits.map((h) => h.chunkId),
  };

  if (!text && result.toolCalls.length === 0) {
    // Tetap catat metering (token terpakai) tetapi tidak mengirim apa pun.
    await recordUsageAndAudit(db, tenantId, {
      agentId: agent.id,
      triggerMessageId: messageId,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      auditMeta: { ...auditMeta, mode: agent.mode, emptyResponse: true },
    });
    return { responded: false, reason: "empty_response", mode: agent.mode };
  }

  // 6a. Mode suggest: simpan draf; tool TIDAK dieksekusi.
  if (agent.mode === "suggest") {
    let suggestionId: string | undefined;
    await recordUsageAndAudit(db, tenantId, {
      agentId: agent.id,
      triggerMessageId: messageId,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      auditMeta: {
        ...auditMeta,
        mode: "suggest",
        proposedToolCalls: result.toolCalls.map((c) => c.name),
      },
      extra: async (tx) => {
        const [row] = await tx
          .insert(agentSuggestions)
          .values({
            tenantId,
            agentId: agent.id,
            conversationId,
            triggerMessageId: messageId,
            contactId: conversation.contactId,
            suggestedText: text,
            status: "pending",
            detail: {
              toolCalls: result.toolCalls,
              provider: result.provider,
              model: result.model,
              tokensIn: result.usage.tokensIn,
              tokensOut: result.usage.tokensOut,
            },
          })
          .returning();
        suggestionId = row.id;
      },
    });
    return { responded: true, mode: "suggest", suggestionId };
  }

  // 6b. Mode auto: eksekusi tool, lalu kirim teks sebagai pesan queued.
  const toolCtx: AgentToolContext = {
    agentId: agent.id,
    contactId: conversation.contactId,
    conversationId,
  };
  const toolOutcomes: AgentToolOutcome[] = [];
  for (const call of result.toolCalls) {
    toolOutcomes.push(
      await executeAgentToolCall(db, ctx, toolCtx, call, {
        publicBaseUrl: input.publicBaseUrl,
      }),
    );
  }

  let outboundMessageId: string | undefined;
  await recordUsageAndAudit(db, tenantId, {
    agentId: agent.id,
    triggerMessageId: messageId,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    auditMeta: {
      ...auditMeta,
      mode: "auto",
      toolOutcomes,
    },
    extra: async (tx) => {
      if (!text) return;
      const [outbound] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId,
          direction: "outbound",
          senderType: "agent",
          type: "text",
          contentText: text,
          status: "queued",
        })
        .returning();
      outboundMessageId = outbound.id;
      const now = new Date();
      await tx
        .update(conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversations.id, conversationId));
      await tx.insert(outboxEvents).values({
        tenantId,
        type: "message.queued",
        payload: {
          provider: conversation.provider,
          conversationId,
          messageId: outbound.id,
          via: "agent",
          agentId: agent.id,
        },
      });
    },
  });

  return {
    responded: true,
    mode: "auto",
    outboundMessageId,
    toolOutcomes,
  };
}
