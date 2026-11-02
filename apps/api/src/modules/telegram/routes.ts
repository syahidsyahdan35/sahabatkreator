import { Hono } from "hono";
import { z } from "zod";
import {
  decryptChannelSecret,
  fetchAndStoreTelegramProfilePhoto,
  recordIntegrationLog,
  recordTelegramChannelPost,
  recordTelegramInboundMessage,
  recordTelegramMyChatMember,
  resolveTelegramAccountById,
  verifyChannelWebhookSecret,
  type RecordIntegrationLogInput,
  type TelegramAccountRef,
} from "@sahabat-kreator/core";
import {
  parseTelegramChannelPost,
  parseTelegramUpdate,
  type TelegramUpdate,
} from "@sahabat-kreator/channel-telegram";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
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
 *
 * Fase 7B.1: SETIAP hit (termasuk 404 akun tak dikenal, 401 secret
 * salah, akun disconnected, duplikat, update non-pesan) menulis satu
 * baris `integration_log` dengan outcome jujur per titik keluar —
 * best-effort, tidak pernah mengubah respons di atas.
 */
export interface TelegramModuleOptions {
  /** Material kunci enkripsi kredensial channel (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret?: string;
  /** Base URL Bot API (env TELEGRAM_API_BASE; default api.telegram.org). */
  telegramApiBase?: string;
}

export function createTelegramRoutes(
  bundle: AuthBundle | null,
  publisher?: RealtimePublisher | null,
  opts: TelegramModuleOptions = {},
) {
  const app = new Hono<{ Variables: AppVariables }>();

  /**
   * Fase 7B.1: pencatatan log integrasi untuk SETIAP hit webhook —
   * best-effort murni. `recordIntegrationLog` sendiri tidak pernah
   * melempar; pembungkus ini lapis kedua agar kegagalan observabilitas
   * tidak pernah mengubah respons webhook (200 tetap 200, 401 tetap 401).
   */
  const logIntegration = async (
    entry: RecordIntegrationLogInput,
  ): Promise<void> => {
    if (!bundle) return;
    try {
      await recordIntegrationLog(bundle.db, entry);
    } catch {
      // Sengaja ditelan: log tidak boleh menjatuhkan webhook.
    }
  };

  /**
   * Fase 6D: identitas Telegram yang BARU pertama kali terlihat memicu
   * pengambilan foto profil kontaknya — best-effort & fire-and-forget
   * (webhook tetap menjawab seketika; helper core tidak pernah melempar),
   * dan TIDAK diulang pada pesan berikutnya dari kontak yang sama.
   */
  const triggerContactPhoto = (
    db: AuthBundle["db"],
    account: TelegramAccountRef,
    contactId: string,
    senderExternalId: string,
  ): void => {
    if (!account.accessTokenEncrypted || !opts.channelTokenSecret) return;
    const botToken = decryptChannelSecret(
      opts.channelTokenSecret,
      account.accessTokenEncrypted,
    );
    if (!botToken) return;
    void fetchAndStoreTelegramProfilePhoto(db, {
      tenantId: account.tenantId,
      botToken,
      telegramApiBase: opts.telegramApiBase,
      telegramUserId: senderExternalId,
      ownerType: "contact",
      ownerId: contactId,
    });
  };

  app.post("/telegram/webhook/:channelAccountId", async (c) => {
    if (!bundle) {
      return apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    }
    const channelAccountId = c.req.param("channelAccountId");
    if (!z.string().uuid().safeParse(channelAccountId).success) {
      await logIntegration({
        direction: "in",
        provider: "telegram",
        outcome: "unresolved_account",
        summary: `webhook hit for malformed account id ${channelAccountId}`,
      });
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }
    const account = await resolveTelegramAccountById(
      bundle.db,
      channelAccountId,
    );
    if (!account) {
      // Payload dibaca best-effort untuk log (parse gagal → null);
      // Hono meng-cache body sehingga pembacaan jalur normal tidak
      // terpengaruh. Akun tak dikenal → baris platform (tenant NULL).
      const rawForLog = await c.req.json().catch(() => null);
      await logIntegration({
        direction: "in",
        provider: "telegram",
        outcome: "unresolved_account",
        summary: `webhook hit for unknown account ${channelAccountId}`,
        payload: rawForLog,
      });
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }
    const presented = c.req.header("x-telegram-bot-api-secret-token");
    if (
      !presented ||
      !verifyChannelWebhookSecret(presented, account.webhookSecret)
    ) {
      const rawForLog = await c.req.json().catch(() => null);
      await logIntegration({
        direction: "in",
        provider: "telegram",
        tenantId: account.tenantId,
        channelAccountId: account.id,
        signatureValid: false,
        outcome: "rejected_signature",
        summary: "webhook secret token mismatch",
        payload: rawForLog,
      });
      return apiError(c, 401, "UNAUTHORIZED", "Invalid webhook secret");
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      // Body rusak dari pengirim yang lolos secret: jawab 200 agar
      // Telegram tidak me-retry selamanya; tidak ada yang disimpan.
      await logIntegration({
        direction: "in",
        provider: "telegram",
        tenantId: account.tenantId,
        channelAccountId: account.id,
        signatureValid: true,
        outcome: "error",
        errorCode: "invalid_json",
        summary: "webhook body is not valid JSON",
      });
      return c.json({ ok: true });
    }
    if (account.status !== "connected") {
      await logIntegration({
        direction: "in",
        provider: "telegram",
        tenantId: account.tenantId,
        channelAccountId: account.id,
        signatureValid: true,
        outcome: "ignored_disconnected",
        summary: `update for ${account.status} account`,
        payload,
      });
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
        await logIntegration({
          direction: "in",
          provider: "telegram",
          tenantId: account.tenantId,
          channelAccountId: account.id,
          signatureValid: true,
          outcome: "recorded",
          summary: `my_chat_member update for chat ${memberUpdate.chat.id}`,
          payload,
        });
      } catch (err) {
        console.error("[telegram] gagal mencatat my_chat_member", err);
        await logIntegration({
          direction: "in",
          provider: "telegram",
          tenantId: account.tenantId,
          channelAccountId: account.id,
          signatureValid: true,
          outcome: "error",
          errorCode: "processing_error",
          summary: "failed to record my_chat_member update",
          payload,
        });
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
      if (!post) {
        await logIntegration({
          direction: "in",
          provider: "telegram",
          tenantId: account.tenantId,
          channelAccountId: account.id,
          signatureValid: true,
          outcome: "ignored_status_only",
          summary: "non-text channel post",
          payload,
        });
        return c.json({ ok: true });
      }
      let recorded: Awaited<ReturnType<typeof recordTelegramChannelPost>>;
      try {
        recorded = await recordTelegramChannelPost(bundle.db, account, {
          chatExternalId: post.chatExternalId,
          chatTitle: post.chatTitle,
          // Sematkan id bot seperti jalur pesan: index unik global.
          providerMessageId: `telegram:${account.externalId}:${post.providerMessageId}`,
          text: post.text,
        });
      } catch (err) {
        await logIntegration({
          direction: "in",
          provider: "telegram",
          tenantId: account.tenantId,
          channelAccountId: account.id,
          signatureValid: true,
          outcome: "error",
          errorCode: "processing_error",
          summary: "failed to record channel post",
          payload,
        });
        throw err;
      }
      await logIntegration({
        direction: "in",
        provider: "telegram",
        tenantId: account.tenantId,
        channelAccountId: account.id,
        signatureValid: true,
        outcome: !recorded || recorded.duplicate ? "duplicate" : "recorded",
        summary: `channel post in chat ${post.chatExternalId}`,
        payload,
      });
      // Fase 6G: linimasa channel berubah — nudge dashboard (postingan
      // pantulan milik tenant lain mengembalikan null di core dan
      // tidak menghasilkan nudge di sini).
      if (recorded && publisher) {
        await publisher.publishNudge({
          kind: "message.received",
          tenantId: account.tenantId,
          conversationId: recorded.message.conversationId,
        });
      }
      return c.json({ ok: true });
    }

    const events = parseTelegramUpdate(payload);
    let handledCount = 0;
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
        handledCount += 1;
        let recorded: Awaited<
          ReturnType<typeof recordTelegramInboundMessage>
        >;
        try {
          recorded = await recordTelegramInboundMessage(bundle.db, account, {
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
        } catch (err) {
          await logIntegration({
            direction: "in",
            provider: "telegram",
            tenantId: account.tenantId,
            channelAccountId: account.id,
            signatureValid: true,
            outcome: "error",
            errorCode: "processing_error",
            summary: `failed to record message from ${event.message.senderExternalId}`,
            payload,
          });
          throw err;
        }
        await logIntegration({
          direction: "in",
          provider: "telegram",
          tenantId: account.tenantId,
          channelAccountId: account.id,
          signatureValid: true,
          outcome:
            recorded === null || recorded.duplicate ? "duplicate" : "recorded",
          summary: `text message from ${event.message.senderExternalId}`,
          payload,
        });
        if (recorded) {
          // Fase 6D: pengirim pertama kali terlihat → ambil foto profil
          // kontaknya (best-effort, tidak menahan jawaban webhook).
          if (recorded.identityCreated) {
            triggerContactPhoto(
              bundle.db,
              account,
              recorded.contactId,
              event.message.senderExternalId,
            );
          }
          // Fase 6G: nudge dashboard setelah commit (null = kembaran milik
          // tenant lain / duplikat webhook — tidak ada perubahan lokal).
          if (publisher) {
            await publisher.publishNudge({
              kind: "message.received",
              tenantId: account.tenantId,
              conversationId: recorded.message.conversationId,
            });
          }
        }
      }
    }
    if (handledCount === 0) {
      // Update valid tanpa konten yang bisa dicatat (edit, reaksi,
      // pesan non-teks, service update, ...) — tetap berjejak di log.
      await logIntegration({
        direction: "in",
        provider: "telegram",
        tenantId: account.tenantId,
        channelAccountId: account.id,
        signatureValid: true,
        outcome: "ignored_status_only",
        summary: "update without recordable message content",
        payload,
      });
    }
    return c.json({ ok: true });
  });

  return app;
}
