import { and, desc, eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  contacts,
  conversations,
  messages,
  type Conversation,
  type Database,
  type Message,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain percakapan & pesan inbox (Fase 1D, RANCANGAN §5.1 & §6).
 * Transport-agnostic; semua query dalam konteks RLS tenant.
 *
 * Pengiriman outbound di fase ini adalah STUB antrean: pesan dibuat dengan
 * status `queued` + catatan audit `message.queued`, TANPA dikirim ke
 * channel mana pun. Pengiriman sungguhan menunggu adapter channel
 * (WhatsApp/IG/...) di fase berikutnya — worker nanti mengambil pesan
 * `queued` dan mengeksekusi pengirimannya.
 */

export interface ConversationWithSummary extends Conversation {
  contactName: string;
  lastMessagePreview: string | null;
  lastMessageDirection: Message["direction"] | null;
}

export async function listConversations(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: { status?: Conversation["status"] },
): Promise<ConversationWithSummary[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(conversations.tenantId, ctx.tenantId)];
    if (input.status) conditions.push(eq(conversations.status, input.status));
    const rows = await tx
      .select({
        conversation: conversations,
        contactName: contacts.name,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt));

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.conversation.id);
    const recent = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          inArray(messages.conversationId, ids),
        ),
      )
      .orderBy(desc(messages.createdAt));
    const lastByConversation = new Map<string, Message>();
    for (const m of recent) {
      if (!lastByConversation.has(m.conversationId)) {
        lastByConversation.set(m.conversationId, m);
      }
    }
    return rows.map((r) => {
      const last = lastByConversation.get(r.conversation.id);
      return {
        ...r.conversation,
        contactName: r.contactName,
        lastMessagePreview: last?.contentText ?? null,
        lastMessageDirection: last?.direction ?? null,
      };
    });
  });
}

/** Null bila percakapan tidak ada DI tenant ini (API menerjemahkan ke 404). */
export async function getConversation(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
): Promise<Conversation | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.id, conversationId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

/**
 * Pesan-pesan satu percakapan, kronologis menaik. `limit` mengambil N pesan
 * TERAKHIR lalu mengembalikannya dalam urutan kronologis.
 * Null bila percakapan bukan milik tenant ini.
 */
export async function listMessages(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
  input: { limit: number },
): Promise<Message[] | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conv) return null;
    const rows = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.conversationId, conversationId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(input.limit);
    return rows.reverse();
  });
}

/**
 * Membuat pesan outbound manual dari inbox (fondasi balasan manusia):
 * baris `messages` (direction=outbound, sender_type=user, status=queued),
 * memperbarui `conversations.last_message_at`, dan menulis audit
 * `message.queued` — semua dalam SATU transaksi tenant.
 * Null bila percakapan bukan milik tenant ini.
 */
export async function queueOutboundMessage(
  db: Database,
  ctx: Pick<TenantContext, "tenantId" | "userId"> & { userId: string },
  conversationId: string,
  input: { contentText: string },
): Promise<Message | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conv) return null;

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId: ctx.tenantId,
        conversationId,
        direction: "outbound",
        senderType: "user",
        type: "text",
        contentText: input.contentText,
        status: "queued",
        sentByUserId: ctx.userId,
      })
      .returning();

    const now = new Date();
    await tx
      .update(conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, conversationId));

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "message.queued",
      meta: { conversationId, messageId: message.id, stub: true },
    });

    return message;
  });
}
