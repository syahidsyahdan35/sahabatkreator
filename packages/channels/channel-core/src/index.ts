/**
 * channel-core — antarmuka standar semua channel (RANCANGAN §4).
 * Core & worker hanya bicara dengan tipe di file ini; kekhususan tiap
 * provider (format webhook, token, error code) hidup di adapter masing-masing.
 */

export type ChannelProvider =
  | "whatsapp"
  | "instagram"
  | "messenger"
  | "telegram"
  | "webchat";

export interface ChannelAccountRef {
  id: string;
  tenantId: string;
  provider: ChannelProvider;
  /** ID akun di sisi provider (nomor WABA, IG user id, Page id, bot id, site id). */
  externalId: string;
}

export type MessageDirection = "inbound" | "outbound";
export type StandardMessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "reaction"
  | "unknown";

/** Pesan yang sudah dinormalisasi dari format provider apa pun. */
export interface StandardMessage {
  providerMessageId?: string;
  conversationExternalId: string;
  senderExternalId: string;
  direction: MessageDirection;
  type: StandardMessageType;
  text?: string;
  /** Kunci objek media di R2 setelah diunduh (URL media provider kedaluwarsa). */
  mediaObjectKey?: string;
  sentAt: string;
}

export type StandardEventType =
  | "message.received"
  | "message.status"
  | "comment.created"
  | "unknown";

/** Event webhook yang sudah dinormalisasi; `raw` disimpan untuk dedup & audit. */
export interface StandardEvent {
  type: StandardEventType;
  provider: ChannelProvider;
  providerEventId?: string;
  message?: StandardMessage;
  raw: unknown;
  receivedAt: string;
}

export interface SendMessageInput {
  account: ChannelAccountRef;
  toExternalId: string;
  text: string;
  /** Mencegah kirim ganda pada retry (idempotency, RANCANGAN §2). */
  idempotencyKey: string;
}

export interface SendMessageResult {
  providerMessageId: string;
}

export interface VerifyWebhookInput {
  rawBody: string;
  signatureHeader: string | undefined;
}

/** Kontrak yang wajib diimplementasikan setiap adapter channel. */
export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  verifyWebhookSignature(input: VerifyWebhookInput): boolean | Promise<boolean>;
  parseWebhookEvents(payload: unknown): StandardEvent[];
}

/** Kebijakan jendela pesan per channel untuk policy engine (RANCANGAN §12.7). */
export interface MessagingWindowPolicy {
  provider: ChannelProvider;
  /** null = tidak ada jendela free-form. */
  freeFormWindowHours: number | null;
  humanAgentWindowHours?: number | null;
  notes: string;
}

export const MESSAGING_WINDOW_POLICIES: Record<ChannelProvider, MessagingWindowPolicy> = {
  whatsapp: {
    provider: "whatsapp",
    freeFormWindowHours: 24,
    notes: "Di luar 24 jam wajib template message. Jendela free-entry iklan: 72 jam.",
  },
  instagram: {
    provider: "instagram",
    freeFormWindowHours: 24,
    humanAgentWindowHours: 24 * 7,
    notes: "Tag HUMAN_AGENT s/d 7 hari hanya untuk support, bukan promosi.",
  },
  messenger: {
    provider: "messenger",
    freeFormWindowHours: 24,
    humanAgentWindowHours: 24 * 7,
    notes: "Tag HUMAN_AGENT s/d 7 hari hanya untuk support, bukan promosi.",
  },
  telegram: { provider: "telegram", freeFormWindowHours: null, notes: "Bot API: tidak ada jendela pesan." },
  webchat: { provider: "webchat", freeFormWindowHours: null, notes: "Channel milik sendiri: sesi & consent diatur sendiri." },
};
