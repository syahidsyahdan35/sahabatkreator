import { Hono } from "hono";
import { z } from "zod";
import {
  recordTelegramInboundMessage,
  resolveTelegramAccountById,
  verifyChannelWebhookSecret,
} from "@sahabat-kreator/core";
import {
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
