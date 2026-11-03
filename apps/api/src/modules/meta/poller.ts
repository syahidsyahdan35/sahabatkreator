import {
  extractRawProviderMessageId,
  getMessageProviderMessageId,
  listQueuedMetaDeliveries,
  type MetaQueuedDelivery,
} from "@sahabat-kreator/core";
import {
  MetaGraphClient,
  MetaGraphError,
} from "@sahabat-kreator/channel-messenger";
import {
  WhatsAppCloudClient,
  WhatsAppGraphError,
} from "@sahabat-kreator/channel-whatsapp";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";
import {
  startDeliveryPoller,
  type DeliveryPoller,
  type QueuedDeliveryBase,
} from "../delivery-poller";

/**
 * Poller pengiriman Meta (Fase 7A; WhatsApp Fase 7B) — kini berupa
 * SPESIFIKASI di atas runner bersama `modules/delivery-poller.ts`
 * (Hotfix analisis 2026-11-03: siklus klaim/kirim/tandai/log/nudge
 * sebelumnya diduplikasi dengan poller Telegram).
 *
 * Semua balasan (dashboard, automation, sequence, agent AI) untuk
 * percakapan messenger/instagram/whatsapp berakhir sebagai pesan outbound
 * `queued` di DB. Runner memindai antrean lintas tenant, mengklaim tiap
 * baris, lalu memanggil `send` di bawah:
 * - Messenger/IG: Send API `POST /{account-id}/messages`
 *   (messaging_type RESPONSE);
 * - WhatsApp: Cloud API `POST /{phone_number_id}/messages`
 *   (messaging_product whatsapp; template resmi bila payload template).
 *
 * Token TIDAK PERNAH dicatat: log hanya memuat kode error aman.
 */

type MetaDelivery = MetaQueuedDelivery & QueuedDeliveryBase;

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

export type MetaDeliveryPoller = DeliveryPoller;

export function startMetaDeliveryPoller(
  bundle: AuthBundle,
  opts: MetaPollerOptions,
  intervalMs = 2_000,
): MetaDeliveryPoller {
  return startDeliveryPoller<MetaDelivery>(
    bundle,
    {
      name: "meta",
      scan: async (db) =>
        (await listQueuedMetaDeliveries(db)).map((delivery) => ({
          ...delivery,
          encryptedToken: delivery.encryptedAccessToken,
          recipientLabel: delivery.recipientExternalId,
          logProvider: delivery.provider,
        })),
      emptyTextCode: "meta_empty_text",
      missingCredentialsCode: "meta_missing_credentials",
      undecryptableCode: "meta_token_undecryptable",
      async send(delivery, token, db) {
        // Fase 7B.5: kutipan keluar. Id mentah target (wamid/mid)
        // diturunkan dari baris targetnya dalam konteks tenant ini —
        // tidak pernah disimpan duplikat di antrean lintas tenant.
        // - WhatsApp: diteruskan sebagai context.message_id (native).
        // - Messenger/IG: Send API TIDAK mendokumentasikan parameter
        //   kutipan keluar (lihat catatan keterbatasan di
        //   MetaGraphClient.sendMessage) → id ini SENGAJA tidak dipakai
        //   di cabang itu; pesan tetap terkirim polos dan blok kutipannya
        //   hidup di inbox kita.
        let quotedRawId: string | null = null;
        if (delivery.replyToMessageId) {
          quotedRawId = extractRawProviderMessageId(
            await getMessageProviderMessageId(
              db,
              { tenantId: delivery.tenantId },
              delivery.replyToMessageId,
            ),
          );
        }

        if (delivery.provider === "whatsapp") {
          const waClient = new WhatsAppCloudClient({
            baseUrl: opts.metaApiBase,
            apiVersion: opts.graphApiVersion,
            accessToken: token,
          });
          // Fase 10A: pesan bertemplatePayload dikirim sebagai pesan
          // TEMPLATE resmi (satu-satunya bentuk proaktif di luar jendela
          // 24 jam); kutipan tidak berlaku untuk template.
          return delivery.templatePayload
            ? (
                await waClient.sendTemplateMessage({
                  phoneNumberId: delivery.accountExternalId,
                  to: delivery.recipientExternalId,
                  templateName: delivery.templatePayload.name,
                  languageCode: delivery.templatePayload.languageCode,
                  bodyParams: delivery.templatePayload.bodyParams,
                })
              ).providerMessageId
            : (
                await waClient.sendTextMessage({
                  phoneNumberId: delivery.accountExternalId,
                  to: delivery.recipientExternalId,
                  text: delivery.contentText!,
                  ...(quotedRawId ? { contextMessageId: quotedRawId } : {}),
                })
              ).providerMessageId;
        }

        const client = new MetaGraphClient({
          baseUrl: opts.metaApiBase,
          apiVersion: opts.graphApiVersion,
          accessToken: token,
        });
        return (
          await client.sendMessage({
            accountExternalId: delivery.accountExternalId,
            recipientExternalId: delivery.recipientExternalId,
            text: delivery.contentText!,
            // Fase 10B: pesan DM comment-to-DM dikirim sebagai private
            // reply (recipient comment_id), bukan ke id pengguna.
            recipientCommentId: delivery.providerCommentId,
          })
        ).providerMessageId;
      },
      compositeProviderMessageId: (delivery, rawProviderId) =>
        `meta:${delivery.accountExternalId}:${rawProviderId}`,
      errorCode(err) {
        const graphErr =
          err instanceof MetaGraphError || err instanceof WhatsAppGraphError
            ? err
            : null;
        if (!graphErr) return "meta_send_error";
        if (graphErr.status === 0) return "meta_network_error";
        return graphErr.graphCode !== null
          ? `meta_graph_${graphErr.graphCode}`
          : `meta_http_${graphErr.status}`;
      },
    },
    {
      channelTokenSecret: opts.channelTokenSecret,
      publisher: opts.publisher,
    },
    intervalMs,
  );
}
