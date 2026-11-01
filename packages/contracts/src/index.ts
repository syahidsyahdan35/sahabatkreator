import { z } from "zod";

/**
 * Kontrak API Sahabat Kreator — sumber kebenaran tunggal (RANCANGAN §2 aturan 2).
 * API memvalidasi dengan schema ini, SDK di-generate darinya, schema tool MCP
 * diturunkan darinya. Error API membawa KODE, bukan kalimat (RANCANGAN §11.1).
 */

export const ErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "TENANT_NOT_FOUND",
  "CHANNEL_NOT_CONNECTED",
  "MESSAGING_WINDOW_CLOSED",
  "RATE_LIMITED",
  "ENTITLEMENT_EXCEEDED",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    /** Pesan teknis untuk developer/log — BUKAN teks UI. UI menerjemahkan `code` via i18n. */
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const VersionResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  /** Versi Meta Graph API yang ter-pin untuk integrasi Meta (RANCANGAN §12.1). */
  metaGraphApiVersion: z.string(),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;

// ---------------------------------------------------------------------------
// Tenants / workspace (Fase 1B)
// ---------------------------------------------------------------------------

export const MemberRoleSchema = z.enum(["owner", "admin", "agent", "viewer"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const CreateTenantRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  defaultLocale: z.string(),
  timezone: z.string(),
  /** Role pemanggil di workspace ini (dari tenant_members). */
  role: MemberRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TenantResponse = z.infer<typeof TenantResponseSchema>;

export const TenantListResponseSchema = z.object({
  tenants: z.array(TenantResponseSchema),
});
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;

// ---------------------------------------------------------------------------
// Contacts (Fase 1D)
// ---------------------------------------------------------------------------

export const OptInStatusSchema = z.enum(["unknown", "opted_in", "opted_out"]);
export type OptInStatus = z.infer<typeof OptInStatusSchema>;

export const CreateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(32).optional(),
  email: z.string().trim().email().max(320).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>;

export const UpdateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  pipelineStage: z.string().trim().min(1).max(64).optional(),
  optInStatus: OptInStatusSchema.optional(),
});
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>;

export const ContactResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  tags: z.array(z.string()),
  customFields: z.record(z.unknown()),
  pipelineStage: z.string(),
  optInStatus: OptInStatusSchema,
  consentAt: z.string().datetime().nullable(),
  lastContactedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactResponse = z.infer<typeof ContactResponseSchema>;

export const ContactListResponseSchema = z.object({
  contacts: z.array(ContactResponseSchema),
  total: z.number().int().nonnegative(),
});
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;

// ---------------------------------------------------------------------------
// Conversations & messages / inbox (Fase 1D)
// ---------------------------------------------------------------------------

export const ChannelProviderSchema = z.enum([
  "whatsapp",
  "instagram",
  "messenger",
  "telegram",
  "webchat",
]);
export type ChannelProvider = z.infer<typeof ChannelProviderSchema>;

export const ConversationStatusSchema = z.enum(["open", "pending", "closed"]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const MessageDirectionSchema = z.enum(["inbound", "outbound"]);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageSenderTypeSchema = z.enum([
  "contact",
  "user",
  "agent",
  "system",
]);
export type MessageSenderType = z.infer<typeof MessageSenderTypeSchema>;

export const MessageTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "template",
  "other",
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MessageStatusSchema = z.enum([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const ConversationResponseSchema = z.object({
  id: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string(),
  provider: ChannelProviderSchema,
  status: ConversationStatusSchema,
  assigneeUserId: z.string().uuid().nullable(),
  agentEnabled: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime().nullable(),
  /** Cuplikan teks pesan terakhir (null bila belum ada pesan). */
  lastMessagePreview: z.string().nullable(),
  lastMessageDirection: MessageDirectionSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;

export const ConversationListResponseSchema = z.object({
  conversations: z.array(ConversationResponseSchema),
});
export type ConversationListResponse = z.infer<
  typeof ConversationListResponseSchema
>;

export const MessageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  direction: MessageDirectionSchema,
  senderType: MessageSenderTypeSchema,
  type: MessageTypeSchema,
  contentText: z.string().nullable(),
  mediaId: z.string().uuid().nullable(),
  providerMessageId: z.string().nullable(),
  status: MessageStatusSchema,
  sentByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageResponseSchema),
});
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

export const SendMessageRequestSchema = z.object({
  contentText: z.string().trim().min(1).max(4096),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
