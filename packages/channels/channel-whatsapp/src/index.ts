import type {
  ChannelAdapter,
  SendMessageInput,
  SendMessageResult,
  StandardEvent,
  VerifyWebhookInput,
} from "@sahabat-kreator/channel-core";

const NOT_IMPLEMENTED =
  "WhatsAppChannelAdapter belum diimplementasikan (Fase 1)";

/**
 * Adapter WhatsApp — STUB Fase 0.
 * TODO Fase 1: WhatsApp Cloud API di atas Meta Graph API v26.0 (ter-pin),
 * dengan routing berdasarkan kategori template:
 * marketing -> Marketing Messages API, utility/auth/service -> Cloud API
 * (RANCANGAN §12.6). Client dilarang memakai legacy protocol yang dihapus
 * di v26: pretty, debug, date_format, root ?ids=, ETag (RANCANGAN §12.2).
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly provider = "whatsapp" as const;

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  verifyWebhookSignature(_input: VerifyWebhookInput): boolean {
    throw new Error(NOT_IMPLEMENTED);
  }

  parseWebhookEvents(_payload: unknown): StandardEvent[] {
    throw new Error(NOT_IMPLEMENTED);
  }
}
