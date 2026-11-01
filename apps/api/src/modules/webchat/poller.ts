import {
  listQueuedOutboundMessages,
  markOutboundMessageSent,
} from "@sahabat-kreator/core";
import type { AuthBundle } from "../../auth";
import { serializeMessage } from "../messages-serialize";
import type { WebchatHub } from "./hub";

/**
 * Poller pengiriman webchat (Fase 2A) — jembatan lintas proses.
 *
 * Balasan automation dibuat oleh WORKER (proses lain) sebagai pesan
 * outbound berstatus `queued`; hub WebSocket hidup di proses API ini.
 * Poller berjalan tiap ±2 detik: untuk setiap percakapan yang
 * pengunjungnya SEDANG terhubung (hub tahu tenant-nya dari token saat
 * connect), ambil pesan `queued`-nya lewat core dalam konteks RLS tenant,
 * dorong lewat hub, dan tandai `sent` (audit `message.sent` via
 * `markOutboundMessageSent`, via="webchat-poller").
 *
 * Batasan yang disengaja (staging): latensi balasan automation bertambah
 * sampai ±2 detik dari poller ini (di luar relay worker ±2 detik), dan
 * hanya percakapan terhubung yang dipindai — pesan untuk pengunjung
 * offline tidak hilang: tetap `queued` dan ter-flush saat reconnect
 * (mekanisme Fase 1F). Jembatan ini digantikan pub/sub Redis pada fase
 * scale berikutnya.
 */

export interface WebchatDeliveryPoller {
  stop: () => void;
}

export function startWebchatDeliveryPoller(
  bundle: AuthBundle,
  hub: WebchatHub,
  intervalMs = 2_000,
): WebchatDeliveryPoller {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const { conversationId, tenantId } of hub.connectedConversations()) {
        const queued = await listQueuedOutboundMessages(
          bundle.db,
          { tenantId },
          conversationId,
        );
        for (const message of queued) {
          const delivered = hub.deliverMessage(
            conversationId,
            serializeMessage(message),
          );
          if (delivered > 0) {
            await markOutboundMessageSent(
              bundle.db,
              { tenantId },
              message.id,
              "webchat-poller",
            );
          }
        }
      }
    } catch (err) {
      console.error("[webchat] delivery poller tick failed", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  console.log(
    `[webchat] delivery poller aktif (interval ${intervalMs}ms) — jembatan pesan queued lintas proses`,
  );
  return {
    stop: () => clearInterval(timer),
  };
}
