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
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain Telegram (Fase 6A, RANCANGAN §4) — channel Bot API.
 *
 * Pola mengikuti webchat (Fase 1F) dengan perbedaan sumber kepercayaan:
 * - Webchat: siteKey publik mengidentifikasi channel.
 * - Telegram: URL webhook memuat id akun channel (UUID); autentikasi
 *   sesungguhnya adalah header secret token Telegram yang hash-nya
 *   tersimpan di baris akun. Resolusi akun memakai lengan RLS
 *   `telegram_webhook_lookup` (migrasi 0018).
 *
 * Pesan masuk ditulis PERSIS seperti webchat: baris pesan inbound +
 * unread + event outbox `message.received` dalam satu transaksi tenant —
 * jadi relay worker, automation, sequence, dan agent AI bekerja tanpa
 * tahu-menahu soal Telegram.
 *
 * Chat privat & grup (Fase 6A.1): identitas kontak selalu per PENGIRIM
 * (`from.id`), tetapi alamat balasan adalah id CHAT
 * (`conversations.provider_chat_id` = `chat.id`; negatif untuk grup).
 * Percakapan grup: SATU per (akun, chat grup), berlabel judul grup
 * (`conversations.title`), menampung pesan banyak anggota — atribusi
 * penulis per pesan disimpan di `messages.sender_name`. Kontak jangkar
 * percakapan grup = pengirim pertama (semantik sequence per-kontak tetap
 * menunjuk kontak percakapan, sama seperti privat).
 */

export interface CreateTelegramChannelInput {
  displayName?: string;
  /** Id numerik bot dari getMe — menjadi external_id akun. */
  botId: string;
  /** Username bot dari getMe (tanpa '@'); null bila bot tak ber-username. */
  botUsername: string | null;
  /** Envelope enkripsi token bot (lihat channel-secrets.ts) — BUKAN token mentah. */
  encryptedBotToken: string;
  /** Hash SHA-256 hex secret webhook akun ini. */
  webhookSecretHash: string;
}

export async function createTelegramChannelAccount(
  db: Database,
  ctx: Pick<TenantContext, "tenantId" | "userId"> & { userId: string },
  input: CreateTelegramChannelInput,
): Promise<ChannelAccount> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(channelAccounts)
      .values({
        tenantId: ctx.tenantId,
        provider: "telegram",
        externalId: input.botId,
        displayName: input.displayName ?? null,
        status: "connected",
        accessTokenEncrypted: input.encryptedBotToken,
        webhookSecret: input.webhookSecretHash,
        botUsername: input.botUsername,
      })
      .returning();

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "channel.created",
      // Metadata aman: username bot memang publik; token/secret tidak dicatat.
      meta: {
        channelAccountId: row.id,
        provider: "telegram",
        botUsername: input.botUsername,
      },
    });

    return row;
  });
}

export type TelegramAccountRef = Pick<
  ChannelAccount,
  | "id"
  | "tenantId"
  | "provider"
  | "externalId"
  | "displayName"
  | "status"
  | "webhookSecret"
  | "botUsername"
>;

/**
 * Resolusi akun channel dari id di URL webhook TANPA konteks tenant:
 * transaksi men-set `app.telegram_channel_account_id` dan policy
 * `telegram_webhook_lookup` (0018) hanya membuka baris telegram ber-id itu.
 * Null bila id tidak dikenal / bukan akun telegram.
 */
export async function resolveTelegramAccountById(
  db: Database,
  channelAccountId: string,
): Promise<TelegramAccountRef | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.telegram_channel_account_id', ${channelAccountId}, true)`,
    );
    const [row] = await tx
      .select({
        id: channelAccounts.id,
        tenantId: channelAccounts.tenantId,
        provider: channelAccounts.provider,
        externalId: channelAccounts.externalId,
        displayName: channelAccounts.displayName,
        status: channelAccounts.status,
        webhookSecret: channelAccounts.webhookSecret,
        botUsername: channelAccounts.botUsername,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.provider, "telegram"),
          eq(channelAccounts.id, channelAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

export interface RecordTelegramInboundInput {
  /** Id user Telegram pengirim (`from.id`) — identitas kontak (atribusi). */
  senderExternalId: string;
  senderName: string;
  senderUsername?: string;
  /** Id chat Telegram (`chat.id`) — ALAMAT BALASAN; negatif untuk grup. */
  chatExternalId: string;
  /** Grup/supergrup → satu percakapan per grup; privat → per kontak. */
  isGroup: boolean;
  /** Judul grup (`chat.title`); hanya untuk grup. */
  chatTitle?: string | null;
  /** Id pesan unik global untuk dedup webhook: `telegram:<botId>:<message_id>`. */
  providerMessageId: string;
  text: string;
}

/**
 * Menyimpan pesan inbound Telegram: temukan/buat kontak pengirim
 * (identitas = user id pengirim pada akun bot ini) + percakapan terbuka,
 * lalu baris pesan + unread + event outbox `message.received` dalam SATU
 * transaksi tenant (pola webchat persis). Idempoten terhadap retry
 * webhook Telegram: provider_message_id yang sama mengembalikan pesan
 * yang sudah ada.
 *
 * Resolusi percakapan (Fase 6A.1):
 * - Grup: berdasarkan `provider_chat_id` (= id grup) pada akun ini —
 *   SATU percakapan per grup, siapa pun anggotanya yang menulis. Kontak
 *   baris percakapan = pengirim PERTAMA (jangkar); pesan berikutnya dari
 *   anggota lain TIDAK memindahkan jangkar itu.
 * - Privat: berdasarkan kontak pengirim (perilaku 6A), dan
 *   `provider_chat_id` diisi/dirapikan ke id chat (= id pengirim).
 */
export async function recordTelegramInboundMessage(
  db: Database,
  account: Pick<TelegramAccountRef, "id" | "tenantId">,
  input: RecordTelegramInboundInput,
): Promise<Message> {
  return withTenantDb(db, account.tenantId, async (tx) => {
    const [identity] = await tx
      .select()
      .from(channelIdentities)
      .where(
        and(
          eq(channelIdentities.channelAccountId, account.id),
          eq(channelIdentities.externalUserId, input.senderExternalId),
        ),
      )
      .limit(1);

    let contactId: string;
    if (identity) {
      contactId = identity.contactId;
    } else {
      const [contact] = await tx
        .insert(contacts)
        .values({
          tenantId: account.tenantId,
          name: input.senderName,
        })
        .returning();
      contactId = contact.id;
      await tx.insert(channelIdentities).values({
        tenantId: account.tenantId,
        contactId,
        channelAccountId: account.id,
        provider: "telegram",
        externalUserId: input.senderExternalId,
        username: input.senderUsername ?? null,
      });
    }

    const [existingConv] = input.isGroup
      ? await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, account.tenantId),
              eq(conversations.channelAccountId, account.id),
              eq(conversations.providerChatId, input.chatExternalId),
            ),
          )
          .orderBy(desc(conversations.createdAt))
          .limit(1)
      : await tx
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
    if (existingConv && existingConv.status !== "closed") {
      conversationId = existingConv.id;
      // Rapikan kolom 6A.1 pada percakapan lama: judul grup bisa berubah
      // di Telegram; provider_chat_id privat lama bisa masih NULL.
      const patch: { title?: string; providerChatId?: string } = {};
      if (input.isGroup && input.chatTitle && existingConv.title !== input.chatTitle) {
        patch.title = input.chatTitle;
      }
      if (existingConv.providerChatId !== input.chatExternalId) {
        patch.providerChatId = input.chatExternalId;
      }
      if (Object.keys(patch).length > 0) {
        await tx
          .update(conversations)
          .set(patch)
          .where(eq(conversations.id, existingConv.id));
      }
    } else {
      const [conv] = await tx
        .insert(conversations)
        .values({
          tenantId: account.tenantId,
          channelAccountId: account.id,
          contactId,
          provider: "telegram",
          providerChatId: input.chatExternalId,
          title: input.isGroup ? (input.chatTitle ?? null) : null,
          status: "open",
        })
        .returning();
      conversationId = conv.id;
    }

    // Dedup retry webhook: pesan yang sama tidak boleh ganda (index unik
    // global provider_message_id adalah penjaga terakhir).
    const [dupe] = await tx
      .select()
      .from(messages)
      .where(eq(messages.providerMessageId, input.providerMessageId))
      .limit(1);
    if (dupe) return dupe;

    const [message] = await tx
      .insert(messages)
      .values({
        tenantId: account.tenantId,
        conversationId,
        direction: "inbound",
        senderType: "contact",
        // Atribusi penulis per pesan HANYA untuk grup (banyak penulis);
        // privat NULL karena penulisnya ya kontak percakapan itu.
        senderName: input.isGroup ? input.senderName : null,
        type: "text",
        contentText: input.text,
        providerMessageId: input.providerMessageId,
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
      .where(eq(conversations.id, conversationId));

    await tx.insert(outboxEvents).values({
      tenantId: account.tenantId,
      type: "message.received",
      payload: {
        provider: "telegram",
        channelAccountId: account.id,
        conversationId,
        messageId: message.id,
      },
    });

    return message;
  });
}

export interface TelegramQueuedDelivery {
  tenantId: string;
  messageId: string;
  conversationId: string;
  contentText: string | null;
  channelAccountId: string;
  /** Envelope enkripsi token bot akun pemilik (dekripsi di lapisan pengirim). */
  encryptedBotToken: string | null;
  /**
   * Alamat balasan (Fase 6A.1): `conversations.provider_chat_id` — id grup
   * (negatif) untuk percakapan grup, id user untuk privat. Baris lama
   * yang belum ter-backfill jatuh kembali ke external_user_id identitas
   * kontak percakapan.
   */
  chatExternalId: string;
}

/**
 * Pindai antrean pengiriman Telegram LINTAS tenant untuk poller API:
 * pesan outbound `queued` pada percakapan telegram, lengkap dengan token
 * terenkripsi akunnya dan alamat chat tujuannya. Berjalan dalam transaksi
 * yang men-set `app.system_delivery='telegram'` — policy
 * `system_delivery_scan` (0018) membuka tepat baris-baris ini (baca saja);
 * penandaan sent/failed tetap dalam konteks tenant masing-masing.
 */
export async function listQueuedTelegramDeliveries(
  db: Database,
  limit = 25,
): Promise<TelegramQueuedDelivery[]> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.system_delivery', 'telegram', true)`,
    );
    const rows = await tx
      .select({
        tenantId: messages.tenantId,
        messageId: messages.id,
        conversationId: messages.conversationId,
        contentText: messages.contentText,
        channelAccountId: channelAccounts.id,
        encryptedBotToken: channelAccounts.accessTokenEncrypted,
        chatExternalId: sql<string>`coalesce(${conversations.providerChatId}, ${channelIdentities.externalUserId})`,
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
      .innerJoin(
        channelIdentities,
        and(
          eq(channelIdentities.channelAccountId, channelAccounts.id),
          eq(channelIdentities.contactId, conversations.contactId),
        ),
      )
      .where(
        and(
          eq(messages.direction, "outbound"),
          eq(messages.status, "queued"),
          eq(conversations.provider, "telegram"),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(limit);
    return rows;
  });
}

export interface TelegramMyChatMemberInput {
  /** Id chat tempat status bot berubah (grup: negatif). */
  chatExternalId: string;
  chatTitle?: string | null;
  /** Status baru bot di chat itu dari Telegram (member/administrator/kicked/left/...). */
  memberStatus: string;
}

/**
 * Mencatat update `my_chat_member` (Fase 6A.1): bot dimasukkan/dikeluarkan
 * dari sebuah chat. BUKAN pesan — tidak membuat kontak/percakapan/pesan;
 * cukup satu baris audit agar pemilik punya jejak kapan botnya masuk grup.
 * Tidak fatal bila gagal: pemanggil (route webhook) mengabaikan error-nya
 * agar webhook tetap menjawab 200.
 */
export async function recordTelegramMyChatMember(
  db: Database,
  account: Pick<TelegramAccountRef, "id" | "tenantId">,
  input: TelegramMyChatMemberInput,
): Promise<void> {
  await withTenantDb(db, account.tenantId, async (tx) => {
    await tx.insert(auditLogs).values({
      tenantId: account.tenantId,
      actorType: "system",
      actorId: "telegram-webhook",
      action: "telegram.my_chat_member",
      meta: {
        channelAccountId: account.id,
        chatId: input.chatExternalId,
        chatTitle: input.chatTitle ?? null,
        memberStatus: input.memberStatus,
      },
    });
  });
}
