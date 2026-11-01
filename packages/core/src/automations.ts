import { and, desc, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  automationRuns,
  automations,
  contacts,
  conversations,
  messages,
  outboxEvents,
  type Automation,
  type AutomationRun,
  type Database,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain automation (Fase 2A, RANCANGAN §5 & §6).
 * Transport-agnostic; semua query dalam konteks RLS tenant.
 *
 * Dua sisi:
 * 1. Manajemen (dipakai API dashboard): CRUD automation keyword +
 *    riwayat automation_runs.
 * 2. Evaluasi (dipakai worker lewat job `automation.evaluate`): pesan
 *    inbound dicocokkan ke automation keyword aktif milik tenant; yang
 *    cocok menembakkan balasan outbound `sender_type='system'` berstatus
 *    `queued` + run `completed` + audit `automation.fired` + event outbox
 *    `message.queued`. Pengiriman sungguhan ke channel BUKAN urusan sini:
 *    untuk webchat, poller di proses API mendorong pesan `queued` lewat
 *    hub WebSocket (lihat README @sahabat-kreator/queue).
 *
 * Idempotensi: satu (automation, pesan pemicu) maksimal menembak sekali.
 * Penjaga berlapis: jobId BullMQ diturunkan dari event outbox, cek run
 * yang sudah ada, dan index unik parsial di DB sebagai penahan terakhir.
 */

export interface CreateAutomationInput {
  name: string;
  keywords: string[];
  match: "exact" | "contains";
  text: string;
}

export interface UpdateAutomationInput {
  name?: string;
  keywords?: string[];
  match?: "exact" | "contains";
  text?: string;
  isActive?: boolean;
}

export type AutomationWithRunCount = Automation & { runCount: number };

export async function createAutomation(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: CreateAutomationInput,
): Promise<Automation> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(automations)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        triggerType: "keyword",
        triggerConfig: { keywords: input.keywords, match: input.match },
        actionType: "send_message",
        actionConfig: { text: input.text },
        isActive: true,
      })
      .returning();
    return row;
  });
}

export async function listAutomations(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
): Promise<AutomationWithRunCount[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        automation: automations,
        runCount: sql<number>`count(${automationRuns.id})::int`,
      })
      .from(automations)
      .leftJoin(
        automationRuns,
        eq(automationRuns.automationId, automations.id),
      )
      .where(eq(automations.tenantId, ctx.tenantId))
      .groupBy(automations.id)
      .orderBy(desc(automations.createdAt));
    return rows.map((r) => ({ ...r.automation, runCount: r.runCount }));
  });
}

/** Null bila automation tidak ada DI tenant ini. */
export async function getAutomation(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  automationId: string,
): Promise<Automation | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.tenantId, ctx.tenantId),
          eq(automations.id, automationId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Null bila automation tidak ada DI tenant ini. */
export async function updateAutomation(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  automationId: string,
  input: UpdateAutomationInput,
): Promise<Automation | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.tenantId, ctx.tenantId),
          eq(automations.id, automationId),
        ),
      )
      .limit(1);
    if (!existing) return null;

    const patch: Partial<Automation> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.keywords !== undefined || input.match !== undefined) {
      patch.triggerConfig = {
        keywords: input.keywords ?? existing.triggerConfig.keywords,
        match: input.match ?? existing.triggerConfig.match,
      };
    }
    if (input.text !== undefined) {
      patch.actionConfig = { text: input.text };
    }

    const [row] = await tx
      .update(automations)
      .set(patch)
      .where(eq(automations.id, automationId))
      .returning();
    return row;
  });
}

/**
 * Riwayat eksekusi satu automation, terbaru dulu.
 * Null bila automation bukan milik tenant ini (API menjawab 404).
 */
export async function listAutomationRuns(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  automationId: string,
  input: { limit: number },
): Promise<AutomationRun[] | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [owner] = await tx
      .select({ id: automations.id })
      .from(automations)
      .where(
        and(
          eq(automations.tenantId, ctx.tenantId),
          eq(automations.id, automationId),
        ),
      )
      .limit(1);
    if (!owner) return null;
    return tx
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.tenantId, ctx.tenantId),
          eq(automationRuns.automationId, automationId),
        ),
      )
      .orderBy(desc(automationRuns.createdAt))
      .limit(input.limit);
  });
}

// ---------------------------------------------------------------------------
// Evaluasi keyword (sisi worker)
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Mencocokkan teks pesan dengan satu keyword.
 * exact    : seluruh teks (trim, case-insensitive) sama dengan keyword.
 * contains : teks mengandung keyword (case-insensitive).
 */
export function keywordMatches(
  messageText: string,
  keyword: string,
  match: "exact" | "contains",
): boolean {
  const text = normalizeText(messageText);
  const kw = normalizeText(keyword);
  if (!kw) return false;
  return match === "exact" ? text === kw : text.includes(kw);
}

export interface AutomationFiredResult {
  automationId: string;
  runId: string;
  outboundMessageId: string;
  matchedKeyword: string;
}

export interface EvaluateInboundResult {
  /** Pesan tidak ditemukan / bukan inbound / percakapan hilang. */
  evaluated: boolean;
  fired: AutomationFiredResult[];
  /** Jumlah automation cocok yang dilewati karena run untuk pesan ini sudah ada. */
  skippedDuplicates: number;
}

/**
 * Mengevaluasi SATU pesan inbound terhadap automation keyword aktif tenant.
 * Dipanggil worker untuk job `automation.evaluate`. Aman dipanggil berulang
 * untuk pesan yang sama (idempoten — lihat catatan di kepala file).
 */
export async function evaluateInboundMessageForAutomations(
  db: Database,
  input: { tenantId: string; conversationId: string; messageId: string },
): Promise<EvaluateInboundResult> {
  const { tenantId, conversationId, messageId } = input;

  const context = await withTenantDb(db, tenantId, async (tx) => {
    const [message] = await tx
      .select()
      .from(messages)
      .where(
        and(eq(messages.tenantId, tenantId), eq(messages.id, messageId)),
      )
      .limit(1);
    if (!message || message.direction !== "inbound") return null;
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
    if (!conversation) return null;
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, conversation.contactId),
        ),
      )
      .limit(1);
    const active = await tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.tenantId, tenantId),
          eq(automations.triggerType, "keyword"),
          eq(automations.isActive, true),
        ),
      );
    return { message, conversation, contact, active };
  });

  if (!context) return { evaluated: false, fired: [], skippedDuplicates: 0 };
  const text = context.message.contentText ?? "";

  const fired: AutomationFiredResult[] = [];
  let skippedDuplicates = 0;

  for (const automation of context.active) {
    const matchedKeyword = automation.triggerConfig.keywords.find((kw) =>
      keywordMatches(text, kw, automation.triggerConfig.match),
    );
    if (!matchedKeyword) continue;

    const outcome = await withTenantDb(db, tenantId, async (tx) => {
      // Penjaga idempotensi: run untuk (automation, pesan pemicu) ini sudah ada?
      const [existingRun] = await tx
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(
          and(
            eq(automationRuns.automationId, automation.id),
            eq(automationRuns.triggerMessageId, messageId),
          ),
        )
        .limit(1);
      if (existingRun) return { kind: "duplicate" as const };

      const [run] = await tx
        .insert(automationRuns)
        .values({
          tenantId,
          automationId: automation.id,
          contactId: context.conversation.contactId,
          conversationId,
          triggerMessageId: messageId,
          status: "completed",
          detail: { matchedKeyword },
        })
        .returning();

      const rendered = automation.actionConfig.text.replaceAll(
        "{name}",
        context.contact?.name ?? "",
      );
      const [outbound] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId,
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
        .where(eq(conversations.id, conversationId));

      await tx
        .update(automationRuns)
        .set({
          detail: { matchedKeyword, outboundMessageId: outbound.id },
        })
        .where(eq(automationRuns.id, run.id));

      await tx.insert(auditLogs).values({
        tenantId,
        actorType: "system",
        actorId: `automation:${automation.id}`,
        action: "automation.fired",
        meta: {
          automationId: automation.id,
          runId: run.id,
          triggerMessageId: messageId,
          outboundMessageId: outbound.id,
          matchedKeyword,
          conversationId,
        },
      });

      await tx.insert(outboxEvents).values({
        tenantId,
        type: "message.queued",
        payload: {
          provider: context.conversation.provider,
          conversationId,
          messageId: outbound.id,
          via: "automation",
          automationId: automation.id,
        },
      });

      return {
        kind: "fired" as const,
        runId: run.id,
        outboundMessageId: outbound.id,
        matchedKeyword,
      };
    }).catch((err: unknown) => {
      // Index unik parsial adalah penahan terakhir bila dua evaluasi balapan:
      // perlakukan pelanggaran unik run sebagai duplikat, bukan kegagalan job.
      if (
        err instanceof Error &&
        /automation_runs_automation_trigger_message_unique/.test(err.message)
      ) {
        return { kind: "duplicate" as const };
      }
      throw err;
    });

    if (outcome.kind === "duplicate") {
      skippedDuplicates += 1;
    } else {
      fired.push({
        automationId: automation.id,
        runId: outcome.runId,
        outboundMessageId: outcome.outboundMessageId,
        matchedKeyword: outcome.matchedKeyword,
      });
    }
  }

  return { evaluated: true, fired, skippedDuplicates };
}
