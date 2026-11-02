import {
  decryptChannelSecret,
  listQueuedMetaDeliveries,
  markOutboundMessageFailed,
  markOutboundMessageSent,
} from "@sahabat-kreator/core";
import {
  MetaGraphClient,
  MetaGraphError,
} from "@sahabat-kreator/channel-messenger";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";

/**
 * Poller pengiriman Meta (Fase 7A) — pasangan poller Telegram (6A).
 *
 * Semua balasan (dashboard, automation, sequence, agent AI) untuk
 * percakapan messenger/instagram berakhir sebagai pesan outbound
 * `queued` di DB. Poller ini berjalan tiap ±2 detik di proses API:
 *
 * 1. Pindai antrean lintas tenant lewat core (`listQueuedMetaDeliveries`
 *    — lengan RLS `meta_delivery_scan`, baca saja).
 * 2. Untuk tiap pesan: dekripsi Page Access Token akunnya dan kirim via
 *    Graph Send API `POST /{account-id}/messages` (messaging_type
 *    RESPONSE — jendela 24 jam Meta).
 * 3. Tandai `sent` (+ provider_message_id majemuk `meta:<accountId>:<mid>`
 *    agar konsisten dengan jalur webhook) atau `failed` SATU kali
 *    percobaan: kegagalan Graph (termasuk penolakan di luar jendela
 *    24 jam) disimpan sebagai kode `meta_graph_<kode>` di kolom
 *    error_code pesan — jujur terlihat di dashboard, TANPA retry tanpa
 *    henti (pesan yang sama bisa gagal permanen, mis. jendela tertutup).
 *
 * Token TIDAK PERNAH dicatat: log hanya memuat kode error aman.
 */

export interface MetaPollerOptions {
  /** Material kunci enkripsi kredensial channel (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret: string | undefined;
  /** Base URL Graph API (env META_API_BASE; default graph.facebook.com). */
  metaApiBase: string | undefined;
  /** Versi Graph ter-pin (dari @sahabat-kreator/config). */
  graphApiVersion: string;
  /** Penerbit nudge realtime (Fase 6G). */
  publisher?: RealtimePublisher | null;
}

export interface MetaDeliveryPoller {
  stop: () => void;
}

export function startMetaDeliveryPoller(
  bundle: AuthBundle,
  opts: MetaPollerOptions,
  intervalMs = 2_000,
): MetaDeliveryPoller {
  let running = false;
  let warnedNoSecret = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const deliveries = await listQueuedMetaDeliveries(bundle.db);
      if (deliveries.length === 0) return;
      if (!opts.channelTokenSecret) {
        if (!warnedNoSecret) {
          warnedNoSecret = true;
          console.error(
            "[meta] ada pesan queued tetapi CHANNEL_TOKEN_SECRET belum diatur — pengiriman dilewati",
          );
        }
        return;
      }
      for (const delivery of deliveries) {
        const ctx = { tenantId: delivery.tenantId };
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
            "meta-poller",
            "meta_empty_text",
          );
          await nudgeStatus("message.failed");
          continue;
        }
        if (!delivery.encryptedAccessToken) {
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "meta-poller",
            "meta_missing_credentials",
          );
          await nudgeStatus("message.failed");
          continue;
        }
        const token = decryptChannelSecret(
          opts.channelTokenSecret,
          delivery.encryptedAccessToken,
        );
        if (!token) {
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "meta-poller",
            "meta_token_undecryptable",
          );
          await nudgeStatus("message.failed");
          continue;
        }
        const client = new MetaGraphClient({
          baseUrl: opts.metaApiBase,
          apiVersion: opts.graphApiVersion,
          accessToken: token,
        });
        try {
          const result = await client.sendMessage({
            accountExternalId: delivery.accountExternalId,
            recipientExternalId: delivery.recipientExternalId,
            text: delivery.contentText,
          });
          // Simpan id pesan provider (format majemuk yang sama seperti
          // jalur webhook) pada baris outbound.
          const compositeId = `meta:${delivery.accountExternalId}:${result.providerMessageId}`;
          try {
            await markOutboundMessageSent(
              bundle.db,
              ctx,
              delivery.messageId,
              "meta-poller",
              compositeId,
            );
          } catch {
            // Balapan sangat jarang (pola poller Telegram): id majemuk
            // menabrak index unik global — penandaan `sent` tidak boleh
            // ikut gagal; ulang tanpa id.
            console.error(
              `[meta] menyimpan provider id pesan ${delivery.messageId} gagal — tandai sent tanpa id`,
            );
            await markOutboundMessageSent(
              bundle.db,
              ctx,
              delivery.messageId,
              "meta-poller",
            );
          }
          await nudgeStatus("message.sent");
        } catch (err) {
          const code =
            err instanceof MetaGraphError
              ? err.status === 0
                ? "meta_network_error"
                : err.graphCode !== null
                  ? `meta_graph_${err.graphCode}`
                  : `meta_http_${err.status}`
              : "meta_send_error";
          console.error(
            `[meta] pengiriman pesan ${delivery.messageId} gagal: ${code}`,
          );
          await markOutboundMessageFailed(
            bundle.db,
            ctx,
            delivery.messageId,
            "meta-poller",
            code,
          );
          await nudgeStatus("message.failed");
        }
      }
    } catch (err) {
      console.error("[meta] delivery poller tick failed", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  console.log(
    `[meta] delivery poller aktif (interval ${intervalMs}ms) — mengirim pesan queued via Graph API`,
  );
  return {
    stop: () => clearInterval(timer),
  };
}
