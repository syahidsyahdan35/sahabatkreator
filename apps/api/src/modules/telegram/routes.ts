import { Hono } from "hono";
import { z } from "zod";
import {
  recordTelegramChannelPost,
  recordTelegramInboundMessage,
  recordTelegramMyChatMember,
  resolveTelegramAccountById,
  verifyChannelWebhookSecret,
} from "@sahabat-kreator/core";
import {
  parseTelegramChannelPost,
  parseTelegramUpdate,
  type TelegramUpdate,
} from "@sahabat-kreator/channel-telegram";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";

/**
 * Modul telegram publik (Fase 6A) — webhook Bot API. TANPA sesi dashboard.
 *
 *   POST /telegram/webhook/:channelAccountId
 *
 * Kepercayaan berlapis:
 * 1. Id akun di URL (UUID acak) menyelesaikan tenant lewat lengan RLS
 *    `telegram_webhook_lookup` — id saja tidak membuktikan apa pun.
 * 2. Header `X-Telegram-Bot-Api-Secret-Token` diverifikasi terhadap hash
 *    secret yang tersimpan di baris akun (secret dibuat server saat
 *    connect dan didaftarkan ke Telegram via setWebhook). Salah/tidak
 *    ada → 401 generik, tanpa membocorkan apakah akunnya ada.
 *
 * Handler menjawab cepat: update non-pesan-teks dijawab 200 dan diabaikan;
 * pesan teks disimpan lewat core (kontak + percakapan + pesan + outbox
 * `message.received` dalam satu transaksi) — pemrosesan berat (automation,
 * agent) terjadi di worker lewat relay outbox, bukan di request ini.
 * Update `channel_post` (Fase 6A.2) punya jalur sendiri ke linimasa
 * channel dan SENGAJA tidak menghasilkan event outbox itu.
 */
export function createTelegramRoutes(bundle: AuthBundle | null) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post("/telegram/webhook/:channelAccountId", async (c) => {
    if (!bundle) {
      return apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    }
    const channelAccountId = c.req.param("channelAccountId");
    if (!z.string().uuid().safeParse(channelAccountId).success) {
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }
    const account = await resolveTelegramAccountById(
      bundle.db,
      channelAccountId,
    );
    if (!account) {
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }
    const presented = c.req.header("x-telegram-bot-api-secret-token");
    if (
      !presented ||
      !verifyChannelWebhookSecret(presented, account.webhookSecret)
    ) {
      return apiError(c, 401, "UNAUTHORIZED", "Invalid webhook secret");
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      // Body rusak dari pengirim yang lolos secret: jawab 200 agar
      // Telegram tidak me-retry selamanya; tidak ada yang disimpan.
      return c.json({ ok: true });
    }
    if (account.status !== "connected") {
      return c.json({ ok: true });
    }

    // Update `my_chat_member` (Fase 6A.1): bot dimasukkan/dikeluarkan
    // grup. Bukan pesan — cukup jejak audit. Fase 6A.2: untuk chat
    // bertipe channel, bot yang menjadi ADMIN juga membuat percakapan
    // channel-nya tampil di dashboard (diurus core).
    // Kegagalan mencatat TIDAK boleh menggagalkan webhook (tetap 200).
    const memberUpdate = (payload as TelegramUpdate).my_chat_member;
    if (memberUpdate?.chat && typeof memberUpdate.chat.id === "number") {
      try {
        await recordTelegramMyChatMember(bundle.db, account, {
          chatExternalId: String(memberUpdate.chat.id),
          chatTitle: memberUpdate.chat.title ?? null,
          memberStatus: memberUpdate.new_chat_member?.status ?? "unknown",
          chatType: memberUpdate.chat.type ?? null,
        });
      } catch (err) {
        console.error("[telegram] gagal mencatat my_chat_member", err);
      }
      return c.json({ ok: true });
    }

    // Update `channel_post` (Fase 6A.2): postingan channel tempat bot
    // menjadi admin — termasuk pantulan postingan yang kita kirim
    // sendiri dari dashboard (ter-dedup di core terhadap pesan outbound
    // yang menyimpan message_id yang sama). Bukan pesan percakapan:
    // masuk linimasa channel tanpa unread & tanpa automation/agent.
    // Non-teks → parser mengembalikan null → 200 diabaikan.
    if ((payload as TelegramUpdate).channel_post) {
      const post = parseTelegramChannelPost(payload);
      if (post) {
        await recordTelegramChannelPost(bundle.db, account, {
          chatExternalId: post.chatExternalId,
          chatTitle: post.chatTitle,
          // Sematkan id bot seperti jalur pesan: index unik global.
          providerMessageId: `telegram:${account.externalId}:${post.providerMessageId}`,
          text: post.text,
        });
      }
      return c.json({ ok: true });
    }

    const events = parseTelegramUpdate(payload);
    if (events.length > 0) {
      const update = payload as TelegramUpdate;
      const from = update.message?.from;
      const senderName =
        [from?.first_name, from?.last_name]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(" ")
          .trim() || "Telegram user";
      for (const event of events) {
        if (event.type !== "message.received" || !event.message?.text) {
          continue;
        }
        await recordTelegramInboundMessage(bundle.db, account, {
          senderExternalId: event.message.senderExternalId,
          senderName,
          senderUsername: from?.username,
          // Fase 6A.1: alamat balasan = id CHAT (grup: id grup negatif),
          // terpisah dari identitas pengirim di atas.
          chatExternalId: event.message.conversationExternalId,
          isGroup: event.message.conversationKind === "group",
          chatTitle: event.message.conversationTitle ?? null,
          // Index unik provider_message_id bersifat global → sematkan id
          // bot agar pesan dari bot berbeda tidak bertabrakan.
          providerMessageId: `telegram:${account.externalId}:${event.message.providerMessageId ?? event.providerEventId ?? ""}`,
          text: event.message.text,
        });
      }
    }
    return c.json({ ok: true });
  });

  return app;
}
