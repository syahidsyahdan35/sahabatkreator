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
  "CHANNEL_DISCONNECTED",
  "TELEGRAM_TOKEN_INVALID",
  "TELEGRAM_BOT_ALREADY_CONNECTED",
  "META_TOKEN_INVALID",
  "META_ACCOUNT_ALREADY_CONNECTED",
  "META_NOT_CONFIGURED",
  "META_SIGNATURE_INVALID",
  "CHANNEL_DELETE_CONFIRMATION_MISMATCH",
  "CHANNEL_ALREADY_TRASHED",
  "CHANNEL_NOT_TRASHED",
  "LOG_REPLAY_NOT_ALLOWED",
  "LOG_PAYLOAD_TRUNCATED",
  "MESSAGE_NOT_FAILED",
  "MESSAGE_RETRY_UNSUPPORTED",
  "PRODUCT_HAS_LINKS",
  "API_KEY_INVALID",
  "API_KEY_REVOKED",
  "API_KEY_SCOPE_DENIED",
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
  /**
   * URL foto profil kontak (Fase 6D): endpoint avatar kita sendiri
   * (`/api/tenants/:tenantId/avatars/contacts/:id`) bila foto tersimpan
   * (saat ini hanya kontak Telegram), selain itu null dan UI menampilkan
   * inisial berwarna — untuk kontak webchat null adalah BY DESIGN
   * (pengunjung anonim tidak punya foto). Bukan URL provider.
   */
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
  /**
   * URL foto profil kontak percakapan ini (Fase 6D) — endpoint avatar
   * kita sendiri, null bila kontak belum punya foto tersimpan (UI jatuh
   * ke inisial berwarna). Untuk percakapan grup/channel ini foto kontak
   * jangkarnya; atribusi per pesan tetap lewat senderName.
   */
  contactAvatarUrl: z.string().nullable(),
  /**
   * Judul percakapan di provider (Fase 6A.1) — judul grup Telegram;
   * null untuk percakapan privat (tampilkan contactName).
   */
  title: z.string().nullable(),
  /** Percakapan grup (banyak anggota) vs privat 1:1 (Fase 6A.1). */
  isGroup: z.boolean(),
  /**
   * Percakapan channel siaran (Fase 6A.2): linimasa postingan satu arah
   * (mis. channel Telegram tempat bot menjadi admin). Bukan percakapan
   * dua arah — postingan masuk tidak memicu automation/agent dan
   * unreadCount-nya selalu 0; membalas di utas ini = memposting ke
   * channel.
   */
  isChannel: z.boolean(),
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
  /** Nama anggota pengirim — hanya terisi pada pesan masuk grup (Fase 6A.1). */
  senderName: z.string().nullable(),
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

/** Outcome terkendali log integrasi — union arah masuk & keluar (kolom `outcome`). */
export const IntegrationLogOutcomeSchema = z.enum([
  // arah masuk
  "recorded",
  "duplicate",
  "ignored_disconnected",
  "ignored_echo",
  "ignored_status_only",
  "rejected_signature",
  "rejected_unconfigured",
  "unresolved_account",
  "error",
  // arah keluar
  "sent",
  "failed",
]);
export type IntegrationLogOutcome = z.infer<typeof IntegrationLogOutcomeSchema>;

/**
 * Status kesehatan operasional channel (Fase 7B.3), dihitung server dari
 * log integrasi (telegram/messenger/instagram/whatsapp) atau aktivitas
 * pesan (webchat — flush-nya tidak dicatat log integrasi by design):
 * - `idle`: belum ada aktivitas apa pun yang tercatat untuk akun ini;
 * - `attention`: sinyal kegagalan terakhir LEBIH BARU daripada aktivitas
 *   sehat terakhir (webhook tercatat / pengiriman sukses);
 * - `ok`: ada aktivitas dan tidak ada kegagalan yang lebih baru dari
 *   aktivitas sehat terakhir.
 */
export const ChannelHealthStatusSchema = z.enum(["ok", "attention", "idle"]);
export type ChannelHealthStatus = z.infer<typeof ChannelHealthStatusSchema>;

/**
 * Kesehatan operasional satu akun channel (Fase 7B.3) — fakta mentahnya
 * dari `integration_log` per akun (satu kueri agregat untuk seluruh
 * daftar, bukan N+1):
 * - `lastInboundAt`/`lastInboundOutcome`: hit webhook arah masuk
 *   terakhir (outcome apa pun). Untuk webchat: waktu pesan pengunjung
 *   terakhir dari tabel messages, dan outcome selalu null (webchat
 *   tidak punya konsep outcome webhook).
 * - `lastDeliveredAt`: pengiriman keluar sukses terakhir (log 'out'
 *   outcome `sent`). Untuk webchat: waktu flush gateway terakhir dari
 *   audit `message.sent` (satu-satunya jalur penanda `sent` webchat =
 *   waktu antar yang sesungguhnya, bukan waktu tulis balasan).
 * - `lastFailureAt`/`lastFailureOutcome`/`lastFailureErrorCode`: sinyal
 *   kegagalan terakhir — arah masuk: rejected_*, unresolved_account,
 *   error, ignored_disconnected; arah keluar: failed. Untuk webchat
 *   selalu null (pesan webchat tidak pernah berstatus failed).
 * Hit Meta yang gagal di gerbang bersama (tanda tangan buruk dsb.)
 * ber-channel_account_id NULL sehingga tidak menempel ke kartu mana
 * pun — kesehatan per kartu hanya mencerminkan event yang memang
 * teratribusi ke akun itu.
 */
export const ChannelHealthSchema = z.object({
  status: ChannelHealthStatusSchema,
  lastInboundAt: z.string().datetime().nullable(),
  lastInboundOutcome: IntegrationLogOutcomeSchema.nullable(),
  lastDeliveredAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  lastFailureOutcome: IntegrationLogOutcomeSchema.nullable(),
  lastFailureErrorCode: z.string().nullable(),
});
export type ChannelHealth = z.infer<typeof ChannelHealthSchema>;

export const CreateChannelRequestSchema = z.object({
  provider: ChannelProviderSchema,
  displayName: z.string().trim().min(1).max(255).optional(),
  /**
   * Token bot Telegram (Fase 6A) — wajib hanya untuk provider 'telegram'.
   * Token TIDAK PERNAH dikembalikan API: ia divalidasi ke Bot API, lalu
   * disimpan terenkripsi di server.
   */
  botToken: z.string().trim().min(10).max(255).optional(),
  /**
   * Page Access Token Meta (Fase 7A) — wajib hanya untuk provider
   * 'messenger'/'instagram'. Pola yang sama seperti botToken: divalidasi
   * ke Graph API, disimpan terenkripsi, TIDAK PERNAH dikembalikan API.
   */
  pageAccessToken: z.string().trim().min(10).max(1024).optional(),
  /**
   * Facebook Page ID (Fase 7A) — untuk 'messenger' ini menjadi
   * external_id akun; untuk 'instagram' ini Page yang terhubung ke akun
   * IG (token divalidasi terhadap Page ini juga).
   */
  pageId: z.string().trim().min(1).max(64).optional(),
  /**
   * ID akun Instagram Professional (Fase 7A) — wajib hanya untuk
   * provider 'instagram'; menjadi external_id akun itu.
   */
  igUserId: z.string().trim().min(1).max(64).optional(),
  /**
   * WABA ID (Fase 7B) — wajib hanya untuk provider 'whatsapp': id
   * WhatsApp Business Account yang menaungi nomor; disimpan sebagai
   * konteks induk (`parent_external_id`), bukan kunci resolusi.
   */
  wabaId: z.string().trim().min(1).max(64).optional(),
  /**
   * Phone Number ID WhatsApp (Fase 7B) — wajib hanya untuk provider
   * 'whatsapp'; menjadi external_id akun (kunci resolusi webhook &
   * penjaga satu-nomor-satu-koneksi).
   */
  phoneNumberId: z.string().trim().min(1).max(64).optional(),
  /**
   * Access Token WhatsApp (Fase 7B) — wajib hanya untuk provider
   * 'whatsapp'. Pola resminya adalah token System User permanen dari
   * Meta Business Settings. Sama seperti token lain: divalidasi ke
   * Graph API, disimpan terenkripsi, TIDAK PERNAH dikembalikan API.
   */
  accessToken: z.string().trim().min(10).max(1024).optional(),
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const ChannelAccountResponseSchema = z.object({
  id: z.string().uuid(),
  provider: ChannelProviderSchema,
  /** Untuk webchat: siteKey publik (`wc_...`) yang dipasang di situs tenant. */
  externalId: z.string(),
  displayName: z.string().nullable(),
  /** Untuk telegram: username bot (`@...` tanpa '@') dari getMe. Provider lain: null. */
  botUsername: z.string().nullable(),
  /**
   * Handle publik akun Meta (Fase 7A): username Page Facebook untuk
   * 'messenger', username akun untuk 'instagram' — dipakai kartu
   * Channels sebagai baris @handle dan menyusun tautan publik
   * (m.me / ig.me). Null bila akun tidak punya username (Page tanpa
   * username adalah hal yang sah) atau provider non-Meta.
   * Fase 7B: untuk 'whatsapp' kolom ini adalah `display_phone_number`
   * terformat dari Graph (mis. "+62 812-3456-7890"); chip kartu
   * menyusun tautan wa.me dari digitnya saja.
   */
  publicHandle: z.string().nullable(),
  /**
   * URL foto profil akun (Fase 6D): endpoint avatar kita sendiri
   * (`/api/tenants/:tenantId/avatars/channels/:id`) bila foto tersimpan
   * (saat ini foto bot Telegram), selain itu null dan kartu Channels
   * menampilkan inisial/glyph provider. TIDAK PERNAH URL file provider
   * (URL file Telegram menyematkan token bot).
   */
  avatarUrl: z.string().nullable(),
  status: ChannelAccountStatusSchema,
  /**
   * Kesehatan operasional akun (Fase 7B.3) — selalu hadir; akun tanpa
   * aktivitas tercatat menjawab status `idle` dengan semua waktu null.
   */
  health: ChannelHealthSchema,
  /**
   * Nama yang harus diketik PERSIS untuk mengonfirmasi pembuangan ke
   * Sampah (Fase 6I): displayName bila ada, else botUsername (telegram),
   * else externalId. Dihitung server agar UI & validasi server selalu
   * sepakat — ini nama yang memang sudah terlihat di kartu, bukan rahasia.
   */
  confirmationName: z.string(),
  /** Kapan akun dibuang ke Sampah (Fase 6I); null = akun hidup normal. */
  trashedAt: z.string().datetime().nullable(),
  /** trashedAt + 30 hari masa tenggang; null bila tidak di Sampah. */
  purgeAt: z.string().datetime().nullable(),
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

/**
 * Info pemasangan webhook Meta (Fase 7A) — hanya untuk owner/admin
 * workspace (endpoint menjawab 403 untuk peran lain): URL webhook publik
 * platform + verify token yang harus ditempel ke dashboard Meta App.
 * Verify token BUKAN kredensial Meta; ia nilai yang kita tentukan
 * sendiri. App secret TIDAK pernah termasuk di sini.
 */
export const MetaWebhookInfoResponseSchema = z.object({
  /** URL publik webhook tunggal: `{publicBaseUrl}/api/meta/webhook`. */
  webhookUrl: z.string(),
  /** Verify token untuk ditempel ke Meta App; null bila env belum diset. */
  verifyToken: z.string().nullable(),
  /** True bila platform sudah punya app secret untuk memverifikasi tanda tangan. */
  appSecretConfigured: z.boolean(),
});
export type MetaWebhookInfoResponse = z.infer<
  typeof MetaWebhookInfoResponseSchema
>;

/**
 * Buang channel ke Sampah (Fase 6I): nama konfirmasi wajib sama PERSIS
 * dengan `confirmationName` akun di respons channel — server memvalidasi
 * ulang; ketidakcocokan ditolak CHANNEL_DELETE_CONFIRMATION_MISMATCH.
 */
export const TrashChannelRequestSchema = z.object({
  confirmationName: z.string().min(1).max(255),
});
export type TrashChannelRequest = z.infer<typeof TrashChannelRequestSchema>;

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

// ---------------------------------------------------------------------------
// API keys & API publik /v1 (Fase 5A)
// ---------------------------------------------------------------------------

/**
 * Scope API key v1 (RANCANGAN §5.4). Read tersedia untuk kontak, percakapan,
 * dan produk; write harus dipilih EKSPLISIT saat kunci dibuat — default
 * pembuatan hanya berisi scope read (lihat API_KEYS_DEFAULT_SCOPES).
 */
export const ApiKeyScopeSchema = z.enum([
  "contacts:read",
  "contacts:write",
  "conversations:read",
  "messages:write",
  "products:read",
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const API_KEY_SCOPES: readonly ApiKeyScope[] = [
  "contacts:read",
  "contacts:write",
  "conversations:read",
  "messages:write",
  "products:read",
] as const;

/** Default aman saat pembuatan tidak menyebut scope: hanya baca. */
export const API_KEY_DEFAULT_SCOPES: readonly ApiKeyScope[] = [
  "contacts:read",
  "conversations:read",
  "products:read",
] as const;

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  scopes: z.array(ApiKeyScopeSchema).max(5).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

export const ApiKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Awalan tampil, mis. `sk_live_ab12` — BUKAN kunci utuh. */
  keyPrefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  lastUsedAt: z.string().datetime().nullable(),
  /** Terisi = kunci sudah dicabut (soft revoke) dan tidak berlaku lagi. */
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;

/** Respons pembuatan: memuat kunci UTUH — ditampilkan SATU KALI, tak pernah lagi. */
export const CreatedApiKeyResponseSchema = ApiKeyResponseSchema.extend({
  key: z.string(),
});
export type CreatedApiKeyResponse = z.infer<typeof CreatedApiKeyResponseSchema>;

export const ApiKeyListResponseSchema = z.object({
  apiKeys: z.array(ApiKeyResponseSchema),
});
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;

/** GET /api/v1/me — identitas tenant pemilik kunci yang dipakai. */
export const PublicMeResponseSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
});
export type PublicMeResponse = z.infer<typeof PublicMeResponseSchema>;

// ---------------------------------------------------------------------------
// Parameter query API publik /v1 (Fase 5B) — bentuk request sisi klien.
// SDK (@sahabat-kreator/sdk) memakai tipe ini agar tidak mendefinisikan
// ulang parameter endpoint v1 (RANCANGAN §2 aturan 2: contracts adalah
// sumber kebenaran; SDK & tool MCP diturunkan darinya). Semua field
// opsional — default & koersi diterapkan server (lihat modul public-v1).
// ---------------------------------------------------------------------------

export const V1ListContactsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ListContactsQuery = z.infer<typeof V1ListContactsQuerySchema>;

export const V1ListConversationsQuerySchema = z.object({
  status: ConversationStatusSchema.optional(),
});
export type ListConversationsQuery = z.infer<
  typeof V1ListConversationsQuerySchema
>;

export const V1ListMessagesQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});
export type ListMessagesQuery = z.infer<typeof V1ListMessagesQuerySchema>;

// ---------------------------------------------------------------------------
// Realtime (Fase 6G) — event "nudge" yang diterbitkan ke Redis pub/sub dan
// diteruskan apps/realtime ke klien WebSocket (dashboard & widget webchat).
//
// Event ini SENGAJA bukan muatan data: ia hanya berkata "ada perubahan di
// tenant/percakapan ini" — klien lalu memuat ulang lewat REST yang sudah
// ada (sumber kebenaran tetap REST + RLS + autentikasi per request). Ini
// menghindari duplikasi otorisasi & serialisasi muatan di jalur socket.
// ---------------------------------------------------------------------------

export const RealtimeNudgeKindSchema = z.enum([
  /** Pesan masuk baru tercatat (webchat/telegram, termasuk postingan channel). */
  "message.received",
  /** Pesan outbound baru dibuat & berstatus `queued` (manual/automation/agent/sequence/saran disetujui). */
  "message.queued",
  /** Pesan outbound berubah status menjadi `sent`. */
  "message.sent",
  /** Pesan outbound berubah status menjadi `failed`. */
  "message.failed",
  /** Draf saran agent baru menunggu persetujuan (mode suggest). */
  "agent.suggestion",
  /** Perubahan percakapan lain yang tak tertampung jenis di atas. */
  "conversation.updated",
]);
export type RealtimeNudgeKind = z.infer<typeof RealtimeNudgeKindSchema>;

export const RealtimeNudgeSchema = z.object({
  type: z.literal("nudge"),
  kind: RealtimeNudgeKindSchema,
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  /** Cap waktu penerbitan (ISO) — diagnostik latensi, bukan otoritas urutan. */
  at: z.string().datetime(),
});
export type RealtimeNudge = z.infer<typeof RealtimeNudgeSchema>;

/** Bentuk yang diberikan penerbit: `type` & `at` diisi helper penerbit. */
export type RealtimeNudgeInput = Omit<RealtimeNudge, "type" | "at">;

// ---------------------------------------------------------------------------
// Panel Admin Platform (Fase 6C) — kredensial provider milik PLATFORM,
// dikelola pemilik platform (allowlist env PLATFORM_ADMIN_EMAILS), BUKAN
// pengaturan tenant. Nilai rahasia TIDAK PERNAH muncul dalam kontrak mana
// pun: yang dipertukarkan hanya status (isSet + sumber efektif), aksi
// set/clear, dan hasil uji koneksi non-rahasia. Resolusi server: panel
// dulu, env fallback (urutan yang diminta pemilik platform).
// ---------------------------------------------------------------------------

export const PlatformSettingKeySchema = z.enum([
  "openrouter_api_key",
  "openrouter_model",
  "r2_access_key_id",
  "r2_secret_access_key",
  // Fase 7A.1: App Secret Meta App platform — memverifikasi tanda tangan
  // webhook Instagram/Messenger. Sengaja TANPA uji koneksi: Meta tidak
  // menyediakan validasi app secret yang berdiri sendiri.
  "meta_app_secret",
]);
export type PlatformSettingKey = z.infer<typeof PlatformSettingKeySchema>;

export const PlatformSettingStatusSchema = z.object({
  key: PlatformSettingKeySchema,
  /** True bila ada nilai efektif (panel atau env). */
  isSet: z.boolean(),
  /** Sumber nilai efektif; null bila belum diatur di mana pun. */
  source: z.enum(["panel", "env"]).nullable(),
  /** Waktu ubah terakhir di panel (ISO); null bila bukan dari panel. */
  updatedAt: z.string().datetime().nullable(),
  /** Email user yang terakhir mengubah nilai panel; null bila bukan dari panel. */
  updatedBy: z.string().nullable(),
});
export type PlatformSettingStatus = z.infer<
  typeof PlatformSettingStatusSchema
>;

/** Info R2 BUKAN rahasia (konfigurasi tetap) yang ditampilkan panel. */
export const PlatformR2InfoSchema = z.object({
  accountId: z.string(),
  endpoint: z.string(),
  /** Bucket yang akan dipakai konsumen R2 & target uji koneksi. */
  bucket: z.string(),
});
export type PlatformR2Info = z.infer<typeof PlatformR2InfoSchema>;

export const PlatformSettingsResponseSchema = z.object({
  settings: z.array(PlatformSettingStatusSchema),
  r2: PlatformR2InfoSchema,
});
export type PlatformSettingsResponse = z.infer<
  typeof PlatformSettingsResponseSchema
>;

export const SetPlatformSettingRequestSchema = z.object({
  /** Nilai baru; string kosong ditolak (gunakan DELETE untuk mengosongkan). */
  value: z.string().trim().min(1).max(1024),
});
export type SetPlatformSettingRequest = z.infer<
  typeof SetPlatformSettingRequestSchema
>;

/**
 * Hasil uji koneksi — selalu 200 untuk kegagalan upstream (ok=false +
 * kode stabil), karena "uji" adalah operasi baca yang hasilnya memang
 * bisa "tidak tersambung". `info` hanya berisi data NON-rahasia dari
 * provider (mis. label & sisa limit kunci OpenRouter).
 */
export const PlatformSettingTestResultSchema = z.object({
  key: PlatformSettingKeySchema,
  ok: z.boolean(),
  /** Kode hasil stabil, mis. OK | NOT_CONFIGURED | OPENROUTER_AUTH_FAILED | OPENROUTER_UNREACHABLE | R2_AUTH_FAILED | R2_BUCKET_NOT_FOUND | R2_UNREACHABLE. */
  code: z.string(),
  info: z.record(z.string(), z.unknown()).optional(),
});
export type PlatformSettingTestResult = z.infer<
  typeof PlatformSettingTestResultSchema
>;

// ---------------------------------------------------------------------------
// Log integrasi webhook & pengiriman (Fase 7B.1)
// ---------------------------------------------------------------------------

export const IntegrationLogDirectionSchema = z.enum(["in", "out"]);
export type IntegrationLogDirection = z.infer<
  typeof IntegrationLogDirectionSchema
>;

/**
 * Provider pada baris log. `meta` = hit webhook Meta SEBELUM ter-rute ke
 * provider konkret (tanda tangan buruk / belum terkonfigurasi / akun tak
 * dikenal di gerbang bersama). `webchat` dicadangkan (flush webchat bukan
 * percobaan API provider dan tidak dicatat di v1).
 */
export const IntegrationLogProviderSchema = z.enum([
  "telegram",
  "messenger",
  "instagram",
  "whatsapp",
  "webchat",
  "meta",
]);
export type IntegrationLogProvider = z.infer<
  typeof IntegrationLogProviderSchema
>;

/**
 * Outcome terkendali — union arah masuk & keluar (kolom `outcome`).
 * Skemanya sendiri didefinisikan di seksi channel di atas (dipakai juga
 * oleh `ChannelHealthSchema`, Fase 7B.3).
 */

/**
 * Satu baris log integrasi sebagaimana tampil di daftar (TANPA payload —
 * payload hanya di endpoint detail; payload memuat isi pesan pelanggan
 * dan endpoint-nya owner/admin saja). `hasPayload` memberi tahu UI
 * apakah detail punya payload untuk ditampilkan.
 */
export const IntegrationLogResponseSchema = z.object({
  id: z.string().uuid(),
  direction: IntegrationLogDirectionSchema,
  provider: z.string(),
  tenantId: z.string().uuid().nullable(),
  channelAccountId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  /** Hanya arah 'in'; null = tidak berlaku/belum bisa dinilai. */
  signatureValid: z.boolean().nullable(),
  outcome: IntegrationLogOutcomeSchema,
  errorCode: z.string().nullable(),
  summary: z.string().nullable(),
  hasPayload: z.boolean(),
  createdAt: z.string().datetime(),
});
export type IntegrationLogResponse = z.infer<
  typeof IntegrationLogResponseSchema
>;

/** Detail satu baris log: daftar + payload tersimpan (sudah dibatasi ±32KB di server). */
export const IntegrationLogDetailResponseSchema =
  IntegrationLogResponseSchema.extend({
    payload: z.unknown().nullable(),
  });
export type IntegrationLogDetailResponse = z.infer<
  typeof IntegrationLogDetailResponseSchema
>;

export const IntegrationLogListResponseSchema = z.object({
  logs: z.array(IntegrationLogResponseSchema),
  /** Kursor opaque halaman berikutnya; null = habis. */
  nextCursor: z.string().nullable(),
});
export type IntegrationLogListResponse = z.infer<
  typeof IntegrationLogListResponseSchema
>;

/** Query daftar log: filter + paginasi kursor (bukan offset). */
export const IntegrationLogListQuerySchema = z.object({
  provider: IntegrationLogProviderSchema.optional(),
  direction: IntegrationLogDirectionSchema.optional(),
  outcome: IntegrationLogOutcomeSchema.optional(),
  channelAccountId: z.string().uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type IntegrationLogListQuery = z.infer<
  typeof IntegrationLogListQuerySchema
>;

// ---------------------------------------------------------------------------
// Penanganan kegagalan (Fase 7B.2): replay webhook & pusat pesan gagal
// ---------------------------------------------------------------------------

/**
 * Respons POST /tenants/:tenantId/logs/:logId/replay — proses ulang SATU
 * baris log arah masuk yang eligible (signature_valid=true, payload
 * lengkap, outcome `error`/`ignored_disconnected`) lewat jalur pemrosesan
 * webhook yang sama. `outcomes` = outcome baris-baris log BARU yang
 * ditulis replay ini, berurutan (payload multi-event bisa menghasilkan
 * lebih dari satu). Baris sumber tidak pernah diubah (append-only).
 */
export const IntegrationLogReplayResponseSchema = z.object({
  replayed: z.literal(true),
  sourceLogId: z.string().uuid(),
  outcomes: z.array(IntegrationLogOutcomeSchema),
});
export type IntegrationLogReplayResponse = z.infer<
  typeof IntegrationLogReplayResponseSchema
>;

/** Provider yang dapat memiliki pesan keluar `failed` (poller telegram/meta). */
export const FailedMessageProviderSchema = z.enum([
  "telegram",
  "messenger",
  "instagram",
  "whatsapp",
]);
export type FailedMessageProvider = z.infer<typeof FailedMessageProviderSchema>;

/**
 * Satu pesan keluar berstatus `failed` pada pusat pesan gagal.
 * `contentPreview` dipotong server (±280 char) — isi penuh tetap ada di
 * utas inbox; endpoint ini owner/admin saja seperti log integrasi.
 */
export const FailedMessageResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  provider: z.string(),
  channelAccountId: z.string().uuid(),
  /** Nama tampil akun channel; null bila akun sudah tidak ada. */
  channelDisplayName: z.string().nullable(),
  contactId: z.string().uuid(),
  /** Nama kontak percakapan; null bila kontak sudah tidak ada. */
  contactName: z.string().nullable(),
  contentPreview: z.string().nullable(),
  /** Kode kegagalan terakhir (kolom messages.error_code), mis. `meta_graph_131047`. */
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type FailedMessageResponse = z.infer<typeof FailedMessageResponseSchema>;

export const FailedMessageListResponseSchema = z.object({
  messages: z.array(FailedMessageResponseSchema),
  /** Kursor opaque halaman berikutnya; null = habis. */
  nextCursor: z.string().nullable(),
});
export type FailedMessageListResponse = z.infer<
  typeof FailedMessageListResponseSchema
>;

/** Query pusat pesan gagal: filter provider + paginasi kursor. */
export const FailedMessageListQuerySchema = z.object({
  provider: FailedMessageProviderSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type FailedMessageListQuery = z.infer<typeof FailedMessageListQuerySchema>;

/**
 * Respons POST /tenants/:tenantId/failed-messages/:messageId/retry —
 * pesan berhasil diantrekan ulang (`failed` → `queued`); terkirim atau
 * tidaknya dibuktikan percobaan poller berikutnya, bukan respons ini.
 */
export const FailedMessageRetryResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("queued"),
});
export type FailedMessageRetryResponse = z.infer<
  typeof FailedMessageRetryResponseSchema
>;
