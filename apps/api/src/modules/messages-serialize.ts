import { MessageResponseSchema, type MessageResponse } from "@sahabat-kreator/contracts";
import type { Message } from "@sahabat-kreator/db";

/** Serialisasi baris `messages` DB ke kontrak API (dipakai inbox & webchat). */
export function serializeMessage(row: Message): MessageResponse {
  return MessageResponseSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    senderType: row.senderType,
    type: row.type,
    contentText: row.contentText,
    mediaId: row.mediaId,
    providerMessageId: row.providerMessageId,
    status: row.status,
    sentByUserId: row.sentByUserId,
    createdAt: row.createdAt.toISOString(),
  });
}
