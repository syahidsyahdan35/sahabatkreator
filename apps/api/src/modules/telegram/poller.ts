import {
  decryptChannelSecret,
  extractRawProviderMessageId,
  getMessageProviderMessageId,
  isOutboundMessageQueued,
  listQueuedTelegramDeliveries,
  markOutboundMessageFailed,
  markOutboundMessageSent,
  recordIntegrationLog,
  type TelegramQueuedDelivery,
} from "@sahabat-kreator/core";
import {
  TelegramApiError,
  TelegramBotApiClient,
} from "@sahabat-kreator/channel-telegram";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";

/**
 * Poller pengiriman Telegram (Fase 6A) — pasangan poller webchat (2A).
 *
 * Semua balasan (dashboard, automation, sequence, agent AI) untuk
 * percakapan Telegram berakhir sebagai pesan outbound `queued` di DB —
 * dibuat oleh proses mana pun tanpa tahu Telegram. Poller ini berjalan
 * tiap ±2 detik di proses API:
 *
 * 1. Pindai antrean lintas tenant lewat core (`listQueuedTelegramDeliveries`
 *    — lengan RLS `system_delivery_scan`, baca saja).
 * 2. Untuk tiap pesan: dekripsi token bot akunnya (AES-256-GCM, kunci dari
 *    env CHANNEL_TOKEN_SECRET) dan kirim via Bot API `sendMessage`.
 * 3. Tandai `sent` (audit `message.sent`; sejak Fase 6A.2 sekaligus
 *    menyimpan provider_message_id majemuk hasil sendMessage agar
 *    pantulan `channel_post` postingan sendiri ter-dedup) atau `failed`
 *    (audit `message.failed` + kolom error_code) dalam konteks tenant
 *    pemilik.
 *
 * Token TIDAK PERNAH dicatat: log hanya memuat kode error aman
 * (`telegram_http_<status>`) — pesan error klien Bot API kita memang
 * dirancang bebas token/URL.
 */

export interface TelegramPollerOptions {
  /** Material kunci enkripsi kredensial channel (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret: string | undefined;
  /** Base URL Bot API (env TELEGRAM_API_BASE; default api.telegram.org). */
  telegramApiBase: string | undefined;
  /** Penerbit nudge realtime (Fase 6G): status sent/failed menyegar dashboard seketika. */
  publisher?: RealtimePublisher | null;
}

export interface TelegramDeliveryPoller {
  stop: () => void;
}

export function startTelegramDeliveryPoller(
  bundle: AuthBundle,
  opts: TelegramPollerOptions,
  intervalMs = 2_000,
): TelegramDeliveryPoller {
  let running = false;
  let warnedNoSecret = false;

  /**
   * Fase 7B.1: setiap percobaan kirim (termasuk gagal pra-kirim)
   * meninggalkan baris log integrasi arah 'out' yang terhubung ke
   * messageId — best-effort, tidak pernah mengubah hasil pengiriman.
   */
  const logOut = async (
    delivery: TelegramQueuedDelivery,
    outcome: "sent" | "failed",
    errorCode: string | null,
  ): Promise<void> => {
    try {
      await recordIntegrationLog(bundle.db, {
        direction: "out",
        provider: "telegram",
        tenantId: delivery.tenantId,
        channelAccountId: delivery.channelAccountId,
        messageId: delivery.messageId,
        outcome,
        errorCode,
        summary:
          outcome === "sent"
            ? `message sent to chat ${delivery.chatExternalId}`
            : `send to chat ${delivery.chatExternalId} failed`,
      });
    } catch {
      // Sengaja ditelan: log tidak boleh menjatuhkan poller.
    }
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const deliveries = await listQueuedTelegramDeliveries(bundle.db);
      if (deliveries.length === 0) return;
      if (!opts.channelTokenSecret) {
        if (!warnedNoSecret) {
          warnedNoSecret = true;
          console.error(
            "[telegram] ada pesan queued tetapi CHANNEL_TOKEN_SECRET belum diatur — pengiriman dilewati",
          );
        }
        return;
      }
      for (const delivery of deliveries) {
        const ctx = { tenantId: delivery.tenantId };
        // Fase 7C: validasi ulang snapshot batch — pesan yang sudah
        // tidak queued (mis. dihapus pembatalan broadcast) TIDAK
        // dikirim. Lihat isOutboundMessageQueued di core.
        if (
          !(await isOutboundMessageQueued(bundle.db, ctx, delivery.messageId))
        ) {
          continue;
        }
        // Fase 6G: setiap perubahan status final diterbitkan sebagai
        // nudge agar dashboard menyegar tanpa menunggu polling.
        const nudgeStatus = async (kind: "message.sent" | "message.failed") => {
          if (opts.publisher) {
            await opts.publisher.publishNudge({
              kind,
              tenantId: delivery.tenantId,
              conversationId: delivery.conversationId,
            });
          }
        };
        if (!delivery.contentText) {
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "telegram-poller",
            "telegram_empty_text",
          );
          await logOut(delivery, "failed", "telegram_empty_text");
          await nudgeStatus("message.failed");
          continue;
        }
        if (!delivery.encryptedBotToken) {
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "telegram-poller",
            "telegram_missing_credentials",
          );
          await logOut(delivery, "failed", "telegram_missing_credentials");
          await nudgeStatus("message.failed");
          continue;
        }
        const token = decryptChannelSecret(
          opts.channelTokenSecret,
          delivery.encryptedBotToken,
        );
        if (!token) {
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "telegram-poller",
            "telegram_token_undecryptable",
          );
          await logOut(delivery, "failed", "telegram_token_undecryptable");
          await nudgeStatus("message.failed");
          continue;
        }
        const client = new TelegramBotApiClient({
          baseUrl: opts.telegramApiBase,
          token,
        });
        try {
          // Fase 7B.5: kutipan native — turunkan message_id numerik
          // pesan target dari barisnya dalam konteks tenant ini (id
          // provider kutipan tidak disimpan duplikat; antrean lintas
          // tenant hanya membawa id baris target). Target tanpa id
          // provider yang bisa diuraikan (mis. pesan webchat lama)
          // → kirim polos tanpa reply_parameters.
          let replyToMessageId: number | undefined;
          if (delivery.replyToMessageId) {
            const composite = await getMessageProviderMessageId(
              bundle.db,
              ctx,
              delivery.replyToMessageId,
            );
            const raw = extractRawProviderMessageId(composite);
            const numeric = raw !== null ? Number(raw) : Number.NaN;
            if (Number.isSafeInteger(numeric)) replyToMessageId = numeric;
          }
          const result = await client.sendMessage({
            chatId: delivery.chatExternalId,
            text: delivery.contentText,
            ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
          });
          // Fase 6A.2: simpan id pesan provider (format majemuk yang
          // sama seperti jalur webhook) pada baris outbound — pantulan
          // `channel_post` untuk postingan kita sendiri ter-dedup
          // terhadap baris ini, bukan menjadi postingan masuk ganda.
          const compositeId = `telegram:${delivery.botExternalId}:${result.providerMessageId}`;
          try {
            await markOutboundMessageSent(
              bundle.db,
              ctx,
              delivery.messageId,
              "telegram-poller",
              compositeId,
            );
          } catch {
            // Balapan sangat jarang: pantulannya tiba dan tercatat lebih
            // dulu, sehingga id majemuk menabrak index unik global.
            // Penandaan `sent` tidak boleh ikut gagal — ulang tanpa id.
            console.error(
              `[telegram] menyimpan provider id pesan ${delivery.messageId} gagal (kemungkinan pantulan lebih dulu) — tandai sent tanpa id`,
            );
            await markOutboundMessageSent(
              bundle.db,
              ctx,
              delivery.messageId,
              "telegram-poller",
            );
          }
          await logOut(delivery, "sent", null);
          await nudgeStatus("message.sent");
        } catch (err) {
          const code =
            err instanceof TelegramApiError
              ? err.status === 0
                ? "telegram_network_error"
                : `telegram_http_${err.status}`
              : "telegram_send_error";
          console.error(
            `[telegram] pengiriman pesan ${delivery.messageId} gagal: ${code}`,
          );
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "telegram-poller",
            code,
          );
          await logOut(delivery, "failed", code);
          await nudgeStatus("message.failed");
        }
      }
    } catch (err) {
      console.error("[telegram] delivery poller tick failed", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  console.log(
    `[telegram] delivery poller aktif (interval ${intervalMs}ms) — mengirim pesan queued via Bot API`,
  );
  return {
    stop: () => clearInterval(timer),
  };
}
