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
  "CHANNEL_NOT_AVAILABLE_YET",
  "PRODUCT_HAS_LINKS",
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

// ---------------------------------------------------------------------------
// Channel accounts (Fase 1F — manajemen channel workspace)
// ---------------------------------------------------------------------------

export const ChannelAccountStatusSchema = z.enum([
  "connected",
  "disconnected",
  "error",
]);
export type ChannelAccountStatus = z.infer<typeof ChannelAccountStatusSchema>;

export const CreateChannelRequestSchema = z.object({
  provider: ChannelProviderSchema,
  displayName: z.string().trim().min(1).max(255).optional(),
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const ChannelAccountResponseSchema = z.object({
  id: z.string().uuid(),
  provider: ChannelProviderSchema,
  /** Untuk webchat: siteKey publik (`wc_...`) yang dipasang di situs tenant. */
  externalId: z.string(),
  displayName: z.string().nullable(),
  status: ChannelAccountStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChannelAccountResponse = z.infer<
  typeof ChannelAccountResponseSchema
>;

export const ChannelAccountListResponseSchema = z.object({
  channels: z.array(ChannelAccountResponseSchema),
});
export type ChannelAccountListResponse = z.infer<
  typeof ChannelAccountListResponseSchema
>;

// ---------------------------------------------------------------------------
// Webchat publik (Fase 1F) — API widget untuk pengunjung situs tenant.
// Autentikasi: siteKey publik (di URL sesi) + token pengunjung bertanda
// tangan HMAC (Bearer). BUKAN sesi dashboard.
// ---------------------------------------------------------------------------

export const WebchatSessionRequestSchema = z.object({
  /** Nama tampilan opsional dari pengunjung. */
  name: z.string().trim().min(1).max(255).optional(),
  /**
   * Id pengunjung persisten yang dibuat widget & disimpan di localStorage
   * situs asal — dipakai untuk menemukan kontak/percakapan yang sama pada
   * kunjungan berikutnya.
   */
  visitorId: z.string().trim().min(8).max(255).optional(),
});
export type WebchatSessionRequest = z.infer<typeof WebchatSessionRequestSchema>;

export const WebchatSessionResponseSchema = z.object({
  token: z.string(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  /** Pesan terakhir percakapan (kronologis menaik) untuk render awal widget. */
  messages: z.array(MessageResponseSchema),
});
export type WebchatSessionResponse = z.infer<
  typeof WebchatSessionResponseSchema
>;

export const WebchatSendMessageRequestSchema = z.object({
  contentText: z.string().trim().min(1).max(4096),
});
export type WebchatSendMessageRequest = z.infer<
  typeof WebchatSendMessageRequestSchema
>;

/** Event yang didorong server ke pengunjung lewat WebSocket webchat. */
export const WebchatRealtimeEventSchema = z.object({
  type: z.literal("message"),
  message: MessageResponseSchema,
});
export type WebchatRealtimeEvent = z.infer<typeof WebchatRealtimeEventSchema>;

// ---------------------------------------------------------------------------
// Automations (Fase 2A; diperluas Fase 2C) — trigger keyword.
// Konfigurasi di DB disimpan sebagai trigger_config {keywords, match} dan
// action_config {text}; kontrak API menampilkannya sebagai field datar.
// Dua jenis (kolom kind di DB):
//   'keyword'  — pesan cocok → satu balasan langsung (perilaku Fase 2A).
//   'sequence' — pesan cocok → kontak didaftarkan ke rangkaian langkah
//                automation_steps yang dikirim berjeda (Fase 2C).
// Request buat BARU memakai union: tanpa field `kind` (atau kind='keyword')
// berarti jalur keyword lama — kompatibilitas mundur penuh.
// ---------------------------------------------------------------------------

export const AutomationMatchSchema = z.enum(["exact", "contains"]);
export type AutomationMatch = z.infer<typeof AutomationMatchSchema>;

export const AutomationKindSchema = z.enum(["keyword", "sequence"]);
export type AutomationKind = z.infer<typeof AutomationKindSchema>;

const AutomationKeywordsSchema = z
  .array(z.string().trim().min(1).max(255))
  .min(1)
  .max(10);

const AutomationNameSchema = z.string().trim().min(1).max(255);

/** Satu langkah rangkaian sequence (Fase 2C). */
export const AutomationStepInputSchema = z.object({
  /** Jeda (menit) sebelum langkah ini, relatif terhadap langkah sebelumnya. */
  delayMinutes: z.number().int().min(0).max(43_200),
  /** Isi pesan langkah; mendukung placeholder {name} = nama kontak. */
  text: z.string().trim().min(1).max(4096),
});
export type AutomationStepInput = z.infer<typeof AutomationStepInputSchema>;

export const AutomationStepResponseSchema = AutomationStepInputSchema.extend({
  position: z.number().int().positive(),
});
export type AutomationStepResponse = z.infer<
  typeof AutomationStepResponseSchema
>;

export const CreateKeywordAutomationRequestSchema = z.object({
  kind: z.literal("keyword").optional(),
  name: AutomationNameSchema,
  keywords: AutomationKeywordsSchema,
  match: AutomationMatchSchema.default("exact"),
  /** Isi balasan otomatis; mendukung placeholder {name} = nama kontak. */
  text: z.string().trim().min(1).max(4096),
});
export type CreateKeywordAutomationRequest = z.infer<
  typeof CreateKeywordAutomationRequestSchema
>;

export const CreateSequenceAutomationRequestSchema = z.object({
  kind: z.literal("sequence"),
  name: AutomationNameSchema,
  keywords: AutomationKeywordsSchema,
  match: AutomationMatchSchema.default("exact"),
  /** 1–10 langkah; posisi ditentukan urutan array (mulai dari 1). */
  steps: z.array(AutomationStepInputSchema).min(1).max(10),
});
export type CreateSequenceAutomationRequest = z.infer<
  typeof CreateSequenceAutomationRequestSchema
>;

export const CreateAutomationRequestSchema = z.union([
  CreateKeywordAutomationRequestSchema,
  CreateSequenceAutomationRequestSchema,
]);
export type CreateAutomationRequest = z.infer<
  typeof CreateAutomationRequestSchema
>;

export const UpdateAutomationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    keywords: AutomationKeywordsSchema.optional(),
    match: AutomationMatchSchema.optional(),
    text: z.string().trim().min(1).max(4096).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateAutomationRequest = z.infer<
  typeof UpdateAutomationRequestSchema
>;

export const AutomationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  triggerType: z.literal("keyword"),
  /** Jenis automation (Fase 2C): 'keyword' (balasan langsung) | 'sequence'. */
  kind: AutomationKindSchema,
  keywords: z.array(z.string()),
  match: AutomationMatchSchema,
  actionType: z.literal("send_message"),
  /** Isi balasan untuk kind='keyword'; untuk sequence selalu string kosong. */
  text: z.string(),
  /** Langkah rangkaian terurut posisi; kosong untuk kind='keyword'. */
  steps: z.array(AutomationStepResponseSchema),
  /** Jumlah langkah (Fase 2C); 0 untuk kind='keyword'. */
  stepCount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  /** Jumlah baris automation_runs milik automation ini. */
  runCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AutomationResponse = z.infer<typeof AutomationResponseSchema>;

export const AutomationListResponseSchema = z.object({
  automations: z.array(AutomationResponseSchema),
});
export type AutomationListResponse = z.infer<
  typeof AutomationListResponseSchema
>;

export const AutomationRunStatusSchema = z.enum([
  "completed",
  "failed",
  "skipped",
]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

export const AutomationRunResponseSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  triggerMessageId: z.string().uuid().nullable(),
  status: AutomationRunStatusSchema,
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AutomationRunResponse = z.infer<typeof AutomationRunResponseSchema>;

export const AutomationRunListResponseSchema = z.object({
  runs: z.array(AutomationRunResponseSchema),
});
export type AutomationRunListResponse = z.infer<
  typeof AutomationRunListResponseSchema
>;

// ---------------------------------------------------------------------------
// Sequence enrollments (Fase 2C) — pendaftaran kontak ke rangkaian pesan.
// ---------------------------------------------------------------------------

export const SequenceEnrollmentStatusSchema = z.enum([
  "active",
  "completed",
  "cancelled",
]);
export type SequenceEnrollmentStatus = z.infer<
  typeof SequenceEnrollmentStatusSchema
>;

export const SequenceEnrollmentResponseSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  triggerMessageId: z.string().uuid().nullable(),
  status: SequenceEnrollmentStatusSchema,
  /** Berapa langkah yang SUDAH terkirim (0 = belum ada). */
  currentStep: z.number().int().nonnegative(),
  /** Total langkah pada automation (untuk tampilan "langkah X dari Y"). */
  totalSteps: z.number().int().nonnegative(),
  /** Jadwal pengiriman langkah berikutnya; null bila tidak lagi aktif. */
  nextRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SequenceEnrollmentResponse = z.infer<
  typeof SequenceEnrollmentResponseSchema
>;

export const SequenceEnrollmentListResponseSchema = z.object({
  enrollments: z.array(SequenceEnrollmentResponseSchema),
});
export type SequenceEnrollmentListResponse = z.infer<
  typeof SequenceEnrollmentListResponseSchema
>;

// ---------------------------------------------------------------------------
// AI Agents (Fase 3A) — konfigurasi agent per tenant. Runtime memakai agent
// aktif tertua; mode 'auto' mengirim langsung, mode 'suggest' membuat draf
// di agent_suggestions yang menunggu persetujuan manusia.
// ---------------------------------------------------------------------------

export const AgentModeSchema = z.enum(["auto", "suggest"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const AgentConfigSchema = z.object({
  maxReplyChars: z.number().int().positive().max(100_000).optional(),
  language: z.string().trim().min(2).max(16).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const CreateAgentRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  systemPrompt: z.string().max(20_000).optional(),
  model: z.string().trim().max(128).optional(),
  mode: AgentModeSchema.optional(),
  isActive: z.boolean().optional(),
  config: AgentConfigSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const UpdateAgentRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    systemPrompt: z.string().max(20_000).optional(),
    model: z.string().trim().max(128).optional(),
    mode: AgentModeSchema.optional(),
    isActive: z.boolean().optional(),
    config: AgentConfigSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;

export const AgentResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  mode: AgentModeSchema,
  isActive: z.boolean(),
  config: AgentConfigSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const AgentListResponseSchema = z.object({
  agents: z.array(AgentResponseSchema),
});
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;

// ---------------------------------------------------------------------------
// Knowledge Base (Fase 3A) — dokumen teks yang di-chunk untuk retrieval
// full-text (pgvector embedding menyusul; kolom sudah disiapkan di DB).
// ---------------------------------------------------------------------------

export const CreateKbDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content: z.string().trim().min(1).max(200_000),
});
export type CreateKbDocumentRequest = z.infer<
  typeof CreateKbDocumentRequestSchema
>;

export const KbDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  /** Jumlah chunk hasil pemecahan dokumen ini (untuk retrieval). */
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KbDocumentResponse = z.infer<typeof KbDocumentResponseSchema>;

export const KbDocumentListResponseSchema = z.object({
  documents: z.array(KbDocumentResponseSchema),
});
export type KbDocumentListResponse = z.infer<
  typeof KbDocumentListResponseSchema
>;

// ---------------------------------------------------------------------------
// Agent suggestions (Fase 3A) — draf balasan dari agent mode 'suggest'.
// Approve = kirim teks saran sebagai pesan outbound agent (status saran
// menjadi 'sent'); tool call yang diusulkan agent TIDAK ikut dieksekusi.
// ---------------------------------------------------------------------------

export const AgentSuggestionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "sent",
]);
export type AgentSuggestionStatus = z.infer<typeof AgentSuggestionStatusSchema>;

export const AgentSuggestionResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  conversationId: z.string().uuid(),
  triggerMessageId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  suggestedText: z.string(),
  status: AgentSuggestionStatusSchema,
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentSuggestionResponse = z.infer<
  typeof AgentSuggestionResponseSchema
>;

export const AgentSuggestionListResponseSchema = z.object({
  suggestions: z.array(AgentSuggestionResponseSchema),
});
export type AgentSuggestionListResponse = z.infer<
  typeof AgentSuggestionListResponseSchema
>;

// ---------------------------------------------------------------------------
// Products & payment links (Fase 4A) — katalog produk tenant + tautan bayar.
// PENTING: provider fase ini adalah 'simulation' — halaman /pay adalah
// SIMULASI berlabel jujur, bukan gerbang pembayaran sungguhan (Midtrans/
// Xendit menyusul bersama kredensial sandbox; temuan v26 §12: order API
// Meta dihapus, pembayaran memang harus milik sendiri).
// ---------------------------------------------------------------------------

/** Harga Rupiah penuh: bilangan bulat >= 0 (bigint di DB, number di kontrak). */
const PriceIdrSchema = z.number().int().nonnegative().max(1_000_000_000_000_000);

export const CreateProductRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10_000).optional(),
  priceIdr: PriceIdrSchema,
  isActive: z.boolean().optional(),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const UpdateProductRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    /** null = kosongkan deskripsi. */
    description: z.string().trim().max(10_000).nullable().optional(),
    priceIdr: PriceIdrSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

export const ProductResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceIdr: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

export const ProductListResponseSchema = z.object({
  products: z.array(ProductResponseSchema),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;

export const PaymentLinkStatusSchema = z.enum([
  "pending",
  "paid",
  "expired",
  "cancelled",
]);
export type PaymentLinkStatus = z.infer<typeof PaymentLinkStatusSchema>;

export const CreatePaymentLinkRequestSchema = z.object({
  productId: z.string().uuid(),
  /** Opsional: tautan dibuat untuk kontak tertentu. */
  contactId: z.string().uuid().optional(),
});
export type CreatePaymentLinkRequest = z.infer<
  typeof CreatePaymentLinkRequestSchema
>;

export const PaymentLinkResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  contactId: z.string().uuid().nullable(),
  contactName: z.string().nullable(),
  conversationId: z.string().uuid().nullable(),
  code: z.string(),
  /** URL publik halaman bayar: {base}/pay/{code}. */
  url: z.string(),
  /** Snapshot harga produk saat tautan dibuat. */
  amountIdr: z.number().int().nonnegative(),
  status: PaymentLinkStatusSchema,
  /** Fase ini selalu 'simulation' — belum ada pembayaran sungguhan. */
  provider: z.string(),
  paidAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaymentLinkResponse = z.infer<typeof PaymentLinkResponseSchema>;

export const PaymentLinkListResponseSchema = z.object({
  paymentLinks: z.array(PaymentLinkResponseSchema),
});
export type PaymentLinkListResponse = z.infer<
  typeof PaymentLinkListResponseSchema
>;

/**
 * Tampilan publik halaman bayar /pay/:code — TANPA data pribadi kontak.
 * Yang boleh dilihat siapa pun yang memegang tautan: produk, harga,
 * status, dan nama workspace penjual.
 */
export const PublicPaymentResponseSchema = z.object({
  code: z.string(),
  productName: z.string(),
  description: z.string().nullable(),
  amountIdr: z.number().int().nonnegative(),
  status: PaymentLinkStatusSchema,
  tenantName: z.string(),
  /** Selalu 'simulation' di fase ini; UI wajib menampilkan label simulasi. */
  provider: z.string(),
  paidAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
});
export type PublicPaymentResponse = z.infer<
  typeof PublicPaymentResponseSchema
>;
