import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  auditLogs,
  channelAccounts,
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
 * Pengiriman outbound dimulai sebagai antrean: pesan dibuat dengan status
 * `queued` + catatan audit `message.queued`. Sejak Fase 1F, lapisan
 * transport (API) mencoba mengirim pesan `queued` untuk channel yang sudah
 * hidup (webchat lewat hub WebSocket) dan menandainya `sent` lewat
 * `markOutboundMessageSent`; channel lain tetap `queued` sampai adapter
 * channel-nya tiba di fase masing-masing.
 */

export interface ConversationWithSummary extends Conversation {
  contactName: string;
  /**
   * Percakapan grup (Fase 6A.1; sejak 6A.2 diturunkan dari kolom `kind`,
   * bukan lagi kehadiran `title`). UI menampilkan `title ?? contactName`
   * sebagai nama tampilan.
   */
  isGroup: boolean;
  /**
   * Percakapan channel siaran (Fase 6A.2, `kind === 'channel'`):
   * linimasa postingan satu arah. Untuk baris seperti ini `unreadCount`
   * SELALU dilaporkan 0 — postingan channel bukan antrean kerja agen,
   * apa pun nilai kolomnya di DB.
   */
  isChannel: boolean;
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
      // Fase 6I: percakapan milik channel yang sedang di Sampah hilang
      // dari inbox (kontaknya sendiri tetap ada di CRM) sampai channel
      // dipulihkan atau di-purge permanen.
      .innerJoin(
        channelAccounts,
        eq(conversations.channelAccountId, channelAccounts.id),
      )
      .where(and(...conditions, isNull(channelAccounts.trashedAt)))
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
      const isChannel = r.conversation.kind === "channel";
      return {
        ...r.conversation,
        contactName: r.contactName,
        isGroup: r.conversation.kind === "group",
        isChannel,
        // Channel: unread ditegakkan 0 di permukaan API (Fase 6A.2) —
        // jalur ingest channel memang tidak pernah menaikkannya, dan
        // penegakan ini menjaga badge tetap benar apa pun datanya.
        unreadCount: isChannel ? 0 : r.conversation.unreadCount,
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
 * Menandai percakapan sebagai sudah dibaca pemilik (unread_count → 0).
 * Dipanggil lapisan transport saat manusia MEMBUKA utas dari inbox —
 * membuka percakapan adalah tindakan membaca; tanpa ini badge unread
 * tidak pernah bersih (bug QA-1: unread hanya pernah naik dari pesan
 * masuk webchat, tidak pernah turun). Jalur agent (agent-runtime)
 * sengaja TIDAK lewat sini: agent membaca riwayat bukan berarti pemilik
 * sudah membaca. No-op senyap bila percakapan bukan milik tenant ini.
 */
export async function markConversationRead(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
): Promise<void> {
  await withTenantDb(db, ctx.tenantId, async (tx) => {
    await tx
      .update(conversations)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.id, conversationId),
        ),
      );
  });
}

/** Pelaku pembuatan pesan outbound — menentukan jejak audit & kolom pengirim. */
interface OutboundMessageActor {
  /** actor_type audit: 'user' (dashboard) atau 'api_key' (API publik /v1, Fase 5A). */
  auditActorType: "user" | "api_key";
  /** actor_id audit: id user dashboard, atau id baris api_keys. */
  auditActorId: string;
  /** Terisi hanya untuk pesan dari dashboard; pesan API key tidak punya user. */
  sentByUserId: string | null;
  auditMetaExtra?: Record<string, unknown>;
}

async function queueOutboundMessageWithActor(
  db: Database,
  tenantId: string,
  conversationId: string,
  input: { contentText: string },
  actor: OutboundMessageActor,
): Promise<Message | null> {
  return withTenantDb(db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!conv) return null;

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId,
        conversationId,
        direction: "outbound",
        senderType: "user",
        type: "text",
        contentText: input.contentText,
        status: "queued",
        sentByUserId: actor.sentByUserId,
      })
      .returning();

    const now = new Date();
    await tx
      .update(conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, conversationId));

    await tx.insert(auditLogs).values({
      tenantId,
      actorType: actor.auditActorType,
      actorId: actor.auditActorId,
      action: "message.queued",
      meta: {
        conversationId,
        messageId: message.id,
        stub: true,
        ...actor.auditMetaExtra,
      },
    });

    return message;
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
  return queueOutboundMessageWithActor(db, ctx.tenantId, conversationId, input, {
    auditActorType: "user",
    auditActorId: ctx.userId,
    sentByUserId: ctx.userId,
  });
}

/**
 * Varian API publik /v1 (Fase 5A): pesan outbound dibuat oleh API KEY tenant
 * (bukan user dashboard) — `sent_by_user_id` kosong, audit tercatat dengan
 * actor_type 'api_key' dan actor_id = id baris api_keys, meta menandai
 * sumber 'public_api'. Alur antrean & pengirimannya identik dengan jalur
 * dashboard (poller API / hub webchat yang sama).
 */
export async function queueOutboundMessageForApiKey(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
  input: { contentText: string },
  apiKeyId: string,
): Promise<Message | null> {
  return queueOutboundMessageWithActor(db, ctx.tenantId, conversationId, input, {
    auditActorType: "api_key",
    auditActorId: apiKeyId,
    sentByUserId: null,
    auditMetaExtra: { source: "public_api", apiKeyId },
  });
}

/**
 * Pesan outbound yang masih `queued` pada satu percakapan, kronologis
 * menaik. Dipakai poller pengiriman API (Fase 2A) untuk mendorong balasan
 * yang dibuat proses lain (worker automation) lewat hub WebSocket webchat.
 * Mengembalikan array kosong bila percakapan bukan milik tenant ini.
 */
export async function listQueuedOutboundMessages(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
): Promise<Message[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    return tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
          eq(messages.status, "queued"),
        ),
      )
      .orderBy(asc(messages.createdAt));
  });
}

export interface ConversationDeliveryTarget {
  provider: Conversation["provider"];
  channelAccountId: string;
  /** external_id akun channel (untuk webchat: siteKey publik). */
  channelExternalId: string;
  contactId: string;
}

/**
 * Target pengiriman satu percakapan: provider + akun channel-nya.
 * Dipakai lapisan transport (API) untuk memutuskan apakah balasan bisa
 * dikirim sungguhan (mis. webchat lewat hub WS) atau tetap `queued`.
 * Null bila percakapan bukan milik tenant ini.
 */
export async function getConversationDeliveryTarget(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  conversationId: string,
): Promise<ConversationDeliveryTarget | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        provider: conversations.provider,
        channelAccountId: conversations.channelAccountId,
        channelExternalId: channelAccounts.externalId,
        contactId: conversations.contactId,
      })
      .from(conversations)
      .innerJoin(
        channelAccounts,
        eq(conversations.channelAccountId, channelAccounts.id),
      )
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
 * Menandai satu pesan outbound `queued` sebagai `sent` setelah transport
 * sungguhan mengirimnya (Fase 1F: hub WebSocket webchat) + audit
 * `message.sent`. Mengembalikan baris terbaru, atau null bila pesan tidak
 * ada / tidak lagi berstatus queued.
 *
 * `providerMessageId` (opsional, Fase 6A.2): id pesan di sisi provider
 * hasil pengiriman — disimpan ke baris yang sama agar webhook pantulan
 * (khususnya `channel_post` Telegram untuk postingan kita sendiri)
 * ter-dedup terhadap baris ini. Bila penyimpanan id itu menabrak index
 * unik global (balapan: pantulan tiba & tercatat lebih dulu — sangat
 * jarang), pemanggil boleh memanggil ulang TANPA id ini agar penandaan
 * `sent` tetap berhasil; lihat poller Telegram.
 */
export async function markOutboundMessageSent(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  messageId: string,
  via: string,
  providerMessageId?: string,
): Promise<Message | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .update(messages)
      .set({
        status: "sent",
        ...(providerMessageId ? { providerMessageId } : {}),
      })
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.id, messageId),
          eq(messages.status, "queued"),
        ),
      )
      .returning();
    if (!updated) return null;

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "system",
      actorId: via,
      action: "message.sent",
      meta: {
        conversationId: updated.conversationId,
        messageId: updated.id,
        via,
      },
    });

    return updated;
  });
}

/**
 * Menandai satu pesan outbound `queued` sebagai `failed` setelah transport
 * sungguhan gagal mengirimnya (Fase 6A: Bot API Telegram menolak/error) +
 * audit `message.failed`. `errorCode` adalah kode aman yang diringkas
 * pemanggil (mis. `telegram_http_400`) — TIDAK BOLEH memuat kredensial
 * atau URL bertoken; disimpan juga ke kolom `messages.error_code`.
 * Mengembalikan baris terbaru, atau null bila pesan tidak ada / tidak
 * lagi berstatus queued.
 */
export async function markOutboundMessageFailed(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  messageId: string,
  via: string,
  errorCode: string,
): Promise<Message | null> {
  const safeCode = errorCode.slice(0, 128);
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .update(messages)
      .set({ status: "failed", errorCode: safeCode })
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.id, messageId),
          eq(messages.status, "queued"),
        ),
      )
      .returning();
    if (!updated) return null;

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "system",
      actorId: via,
      action: "message.failed",
      meta: {
        conversationId: updated.conversationId,
        messageId: updated.id,
        via,
        errorCode: safeCode,
      },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Pusat pesan keluar gagal + retry (Fase 7B.2)
// ---------------------------------------------------------------------------

/**
 * Provider yang pesan keluarnya BENAR-BENAR bisa berakhir `failed` dan
 * bisa diantrekan ulang ke mekanisme pengiriman yang ada:
 * - telegram/messenger/instagram/whatsapp: ditandai `failed` oleh poller
 *   pengiriman API (atau, khusus WhatsApp, oleh webhook status Meta lewat
 *   `applyWhatsAppMessageStatus`) dan diambil lagi oleh poller yang sama
 *   begitu statusnya kembali `queued`.
 * - webchat SENGAJA tidak ada di sini: pesan keluar webchat tidak pernah
 *   berstatus `failed` — flush gateway realtime hanya menandai `sent`,
 *   dan pesan untuk pengunjung luring tetap `queued` sampai reconnect
 *   (gerbang disconnect Fase 6G juga mempertahankannya `queued`). Jadi
 *   tidak ada antrean gagal webchat untuk ditampilkan/dikirim ulang.
 */
export const RETRYABLE_FAILED_PROVIDERS = [
  "telegram",
  "messenger",
  "instagram",
  "whatsapp",
] as const;

export interface FailedOutboundMessage {
  id: string;
  conversationId: string;
  provider: string;
  channelAccountId: string;
  channelDisplayName: string | null;
  contactId: string;
  contactName: string | null;
  contentPreview: string | null;
  errorCode: string | null;
  createdAt: Date;
}

export interface ListFailedOutboundMessagesInput {
  provider?: string;
  /** Kursor opaque dari halaman sebelumnya. */
  cursor?: string;
  /** Default 50, maksimum 100. */
  limit?: number;
}

export interface FailedOutboundMessagePage {
  messages: FailedOutboundMessage[];
  nextCursor: string | null;
}

interface FailedMessageCursor {
  createdAt: string;
  id: string;
}

function encodeFailedCursor(row: { createdAt: Date; id: string }): string {
  const raw: FailedMessageCursor = {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  };
  return Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
}

function decodeFailedCursor(
  cursor: string | undefined,
): FailedMessageCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<FailedMessageCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    // Kursor rusak → halaman pertama (pola log integrasi 7B.1).
  }
  return null;
}

const FAILED_CONTENT_PREVIEW_CHARS = 280;

/**
 * Daftar pesan keluar `failed` milik tenant (pusat pesan gagal 7B.2),
 * terbaru dulu, paginasi kursor keyset (created_at, id) menurun — pola
 * yang sama seperti daftar log integrasi. Konteks channel & kontak ikut
 * dibaca dalam transaksi tenant yang sama (RLS menegakkan isolasi).
 */
export async function listFailedOutboundMessages(
  db: Database,
  tenantId: string,
  input: ListFailedOutboundMessagesInput = {},
): Promise<FailedOutboundMessagePage> {
  const limit = !input.limit || Number.isNaN(input.limit)
    ? 50
    : Math.min(100, Math.max(1, Math.floor(input.limit)));
  return withTenantDb(db, tenantId, async (tx) => {
    const conditions = [
      eq(messages.tenantId, tenantId),
      eq(messages.direction, "outbound"),
      eq(messages.status, "failed"),
      inArray(conversations.provider, [...RETRYABLE_FAILED_PROVIDERS]),
    ];
    if (input.provider) {
      conditions.push(eq(conversations.provider, input.provider as never));
    }
    const cursor = decodeFailedCursor(input.cursor);
    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(
          lt(messages.createdAt, cursorDate),
          and(eq(messages.createdAt, cursorDate), lt(messages.id, cursor.id)),
        )!,
      );
    }
    const rows = await tx
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        provider: conversations.provider,
        channelAccountId: conversations.channelAccountId,
        channelDisplayName: channelAccounts.displayName,
        contactId: conversations.contactId,
        contactName: contacts.name,
        contentText: messages.contentText,
        errorCode: messages.errorCode,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(
        conversations,
        eq(messages.conversationId, conversations.id),
      )
      .innerJoin(
        channelAccounts,
        eq(conversations.channelAccountId, channelAccounts.id),
      )
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      messages: pageRows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        provider: r.provider,
        channelAccountId: r.channelAccountId,
        channelDisplayName: r.channelDisplayName,
        contactId: r.contactId,
        contactName: r.contactName,
        contentPreview: r.contentText
          ? r.contentText.slice(0, FAILED_CONTENT_PREVIEW_CHARS)
          : null,
        errorCode: r.errorCode,
        createdAt: r.createdAt,
      })),
      nextCursor: hasMore
        ? encodeFailedCursor(pageRows[pageRows.length - 1])
        : null,
    };
  });
}

export type RetryFailedOutboundMessageResult =
  | { kind: "requeued"; message: Message; provider: string }
  | { kind: "not_found" }
  | { kind: "not_failed" }
  | { kind: "channel_disconnected" }
  | { kind: "unsupported_provider"; provider: string };

/**
 * Mengantrekan ulang SATU pesan keluar `failed` (Fase 7B.2): transisi
 * `failed` → `queued` yang ATOMIK dan kondisional di dalam satu
 * transaksi tenant, agar balapan dengan poller tidak pernah menimpa
 * status yang lebih maju (`sent`/`delivered`/`read`). Isi pesan,
 * percakapan, kontak, dan provider_message_id TIDAK diubah; error_code
 * dibersihkan sebagai bagian transisi (kegagalan lama tetap terbaca di
 * `integration_log` + audit `message.failed`). Penjaga sebelum transisi:
 * akun channel harus ada, tidak di-trash, dan berstatus `connected`;
 * provider harus termasuk yang dilayani poller (webchat tidak pernah
 * `failed` — lihat RETRYABLE_FAILED_PROVIDERS). Berhasil → audit
 * `message.retry` (actor user yang menekan tombol). Pengiriman sungguhan
 * tetap dilakukan poller yang ada pada siklus berikutnya — fungsi ini
 * tidak mengirim apa pun sendiri.
 */
export async function retryFailedOutboundMessage(
  db: Database,
  ctx: Pick<TenantContext, "tenantId" | "userId"> & { userId: string },
  messageId: string,
): Promise<RetryFailedOutboundMessageResult> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        message: messages,
        provider: conversations.provider,
        accountStatus: channelAccounts.status,
        accountTrashedAt: channelAccounts.trashedAt,
      })
      .from(messages)
      .innerJoin(
        conversations,
        eq(messages.conversationId, conversations.id),
      )
      .innerJoin(
        channelAccounts,
        eq(conversations.channelAccountId, channelAccounts.id),
      )
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.id, messageId),
        ),
      )
      .limit(1);
    if (!row) return { kind: "not_found" } as const;
    if (
      row.message.direction !== "outbound" ||
      row.message.status !== "failed"
    ) {
      return { kind: "not_failed" } as const;
    }
    if (
      !(RETRYABLE_FAILED_PROVIDERS as readonly string[]).includes(row.provider)
    ) {
      return { kind: "unsupported_provider", provider: row.provider } as const;
    }
    if (row.accountTrashedAt !== null || row.accountStatus !== "connected") {
      return { kind: "channel_disconnected" } as const;
    }

    const previousErrorCode = row.message.errorCode;
    const [updated] = await tx
      .update(messages)
      .set({ status: "queued", errorCode: null })
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.id, messageId),
          eq(messages.status, "failed"),
        ),
      )
      .returning();
    if (!updated) return { kind: "not_failed" } as const;

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "message.retry",
      meta: {
        conversationId: updated.conversationId,
        messageId: updated.id,
        provider: row.provider,
        previousErrorCode,
      },
    });

    return { kind: "requeued", message: updated, provider: row.provider } as const;
  });
}
