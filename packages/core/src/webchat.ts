import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  channelAccounts,
  channelIdentities,
  contacts,
  conversations,
  messages,
  outboxEvents,
  type ChannelAccount,
  type Database,
  type Message,
} from "@sahabat-kreator/db";
import { withTenantDb } from "./tx";

/**
 * Service domain webchat (Fase 1F) — channel milik sendiri (RANCANGAN §4).
 *
 * Alur publik widget:
 * 1. `resolveWebchatAccountBySiteKey` — siteKey publik → akun channel +
 *    tenant. Ini satu-satunya query webchat TANPA konteks tenant lebih dulu:
 *    ia berjalan dalam transaksi yang men-set `app.webchat_site_key`, dan
 *    policy RLS channel_accounts (migrasi 0006) hanya membuka baris webchat
 *    yang external_id-nya sama dengan siteKey itu.
 * 2. `openWebchatSession` — temukan/buat kontak (identitas webchat dari
 *    visitorId persisten widget) + percakapannya, dalam konteks tenant hasil
 *    resolusi di atas.
 * 3. `recordWebchatInboundMessage` — pesan masuk pengunjung: baris pesan +
 *    unread_count + last_message_at + event outbox `message.received`,
 *    semua dalam SATU transaksi tenant (Transactional Outbox, §2 aturan 5).
 * 4. `flushQueuedWebchatMessages` — saat pengunjung (re)connect, pesan
 *    outbound yang masih `queued` dianggap terkirim ke widget → `sent`.
 */

export type WebchatAccountRef = Pick<
  ChannelAccount,
  "id" | "tenantId" | "provider" | "externalId" | "displayName" | "status"
>;

/** Null bila siteKey tidak dikenal (API menjawab 404). */
export async function resolveWebchatAccountBySiteKey(
  db: Database,
  siteKey: string,
): Promise<WebchatAccountRef | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.webchat_site_key', ${siteKey}, true)`,
    );
    const [row] = await tx
      .select({
        id: channelAccounts.id,
        tenantId: channelAccounts.tenantId,
        provider: channelAccounts.provider,
        externalId: channelAccounts.externalId,
        displayName: channelAccounts.displayName,
        status: channelAccounts.status,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.provider, "webchat"),
          eq(channelAccounts.externalId, siteKey),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

export interface OpenWebchatSessionResult {
  contactId: string;
  conversationId: string;
  /** visitorId efektif (yang diberikan widget, atau yang dibuat server). */
  visitorId: string;
  messages: Message[];
}

export async function openWebchatSession(
  db: Database,
  account: WebchatAccountRef,
  input: { name?: string; visitorId?: string },
): Promise<OpenWebchatSessionResult> {
  const visitorId =
    input.visitorId ?? `vis_${randomBytes(18).toString("base64url")}`;
  return withTenantDb(db, account.tenantId, async (tx) => {
    // Identitas pengunjung pada akun channel ini sudah ada?
    const [identity] = await tx
      .select()
      .from(channelIdentities)
      .where(
        and(
          eq(channelIdentities.channelAccountId, account.id),
          eq(channelIdentities.externalUserId, visitorId),
        ),
      )
      .limit(1);

    let contactId: string;
    if (identity) {
      contactId = identity.contactId;
      const name = input.name?.trim();
      if (name) {
        await tx
          .update(contacts)
          .set({ name, updatedAt: new Date() })
          .where(eq(contacts.id, contactId));
      }
    } else {
      const [contact] = await tx
        .insert(contacts)
        .values({
          tenantId: account.tenantId,
          name: input.name?.trim() || "Webchat visitor",
        })
        .returning();
      contactId = contact.id;
      await tx.insert(channelIdentities).values({
        tenantId: account.tenantId,
        contactId,
        channelAccountId: account.id,
        provider: "webchat",
        externalUserId: visitorId,
      });
    }

    // Percakapan aktif (belum closed) kontak ini pada akun channel ini.
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, account.tenantId),
          eq(conversations.channelAccountId, account.id),
          eq(conversations.contactId, contactId),
        ),
      )
      .orderBy(desc(conversations.createdAt))
      .limit(1);

    let conversationId: string;
    if (existing && existing.status !== "closed") {
      conversationId = existing.id;
    } else {
      const [conv] = await tx
        .insert(conversations)
        .values({
          tenantId: account.tenantId,
          channelAccountId: account.id,
          contactId,
          provider: "webchat",
          status: "open",
        })
        .returning();
      conversationId = conv.id;
    }

    const recent = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, account.tenantId),
          eq(messages.conversationId, conversationId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(50);

    return {
      contactId,
      conversationId,
      visitorId,
      messages: recent.reverse(),
    };
  });
}

/**
 * Menyimpan pesan inbound dari pengunjung webchat + menaikkan unread dan
 * menulis event outbox `message.received` dalam transaksi yang sama.
 * Null bila percakapan bukan milik tenant ini.
 */
export async function recordWebchatInboundMessage(
  db: Database,
  ctx: { tenantId: string; conversationId: string },
  input: { contentText: string },
): Promise<Message | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [conv] = await tx
      .select({
        id: conversations.id,
        channelAccountId: conversations.channelAccountId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.id, ctx.conversationId),
        ),
      )
      .limit(1);
    if (!conv) return null;

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        direction: "inbound",
        senderType: "contact",
        type: "text",
        contentText: input.contentText,
        status: "received",
      })
      .returning();

    const now = new Date();
    await tx
      .update(conversations)
      .set({
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, ctx.conversationId));

    await tx.insert(outboxEvents).values({
      tenantId: ctx.tenantId,
      type: "message.received",
      payload: {
        provider: "webchat",
        channelAccountId: conv.channelAccountId,
        conversationId: ctx.conversationId,
        messageId: message.id,
      },
    });

    return message;
  });
}

/**
 * Menandai semua pesan outbound `queued` pada percakapan webchat sebagai
 * `sent` (mereka akan didorong ke widget yang baru connect). Mengembalikan
 * pesan-pesan itu dalam urutan kronologis menaik.
 */
export async function flushQueuedWebchatMessages(
  db: Database,
  ctx: { tenantId: string; conversationId: string },
): Promise<Message[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const queued = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.conversationId, ctx.conversationId),
          eq(messages.direction, "outbound"),
          eq(messages.status, "queued"),
        ),
      )
      .orderBy(asc(messages.createdAt));
    if (queued.length === 0) return [];

    const ids = queued.map((m) => m.id);
    const updated = await tx
      .update(messages)
      .set({ status: "sent" })
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.conversationId, ctx.conversationId),
          eq(messages.status, "queued"),
        ),
      )
      .returning();

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "system",
      actorId: "webchat-hub",
      action: "message.sent",
      meta: {
        conversationId: ctx.conversationId,
        messageIds: ids,
        channel: "webchat",
        via: "ws-connect-flush",
      },
    });

    return updated.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  });
}
