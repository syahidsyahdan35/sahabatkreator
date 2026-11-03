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
  // Fase 7D: koneksi Meta via OAuth ("Lanjutkan dengan Facebook").
  "META_OAUTH_NOT_CONFIGURED",
  "META_OAUTH_STATE_INVALID",
  "META_OAUTH_SESSION_NOT_FOUND",
  "META_OAUTH_ASSET_NOT_FOUND",
  // Hotfix R1: aset pemilih ditemukan tetapi tidak punya kredensial
  // yang dapat dipakai (Page tanpa Page Access Token) → 422 saat
  // complete dicoba untuk aset nonaktif itu.
  "META_OAUTH_ASSET_NOT_CONNECTABLE",
  "META_OAUTH_EXCHANGE_FAILED",
  "META_OAUTH_CANCELLED",
  "CHANNEL_DELETE_CONFIRMATION_MISMATCH",
  "CHANNEL_ALREADY_TRASHED",
  "CHANNEL_NOT_TRASHED",
  "LOG_REPLAY_NOT_ALLOWED",
  "LOG_PAYLOAD_TRUNCATED",
  "MESSAGE_NOT_FAILED",
  "MESSAGE_RETRY_UNSUPPORTED",
  // Fase 7B.5: target kutipan balasan tidak sah (tak ada / tenant lain /
  // percakapan lain) → 422 pada endpoint balas dashboard & API publik v1.
  "MESSAGE_REPLY_TARGET_INVALID",
  // Fase 7C: broadcast — channel tidak mendukung broadcast (webchat
  // tanpa semantik push) → 422; transisi status tidak sah (edit
  // non-draft, jadwalkan non-draft, batalkan yang sudah terminal) → 409.
  // Fase 10A: WhatsApp terbuka LEWAT template — broadcast WA tanpa
  // template → 422 BROADCAST_TEMPLATE_REQUIRED; template belum
  // APPROVED → 422 BROADCAST_TEMPLATE_NOT_APPROVED.
  "BROADCAST_CHANNEL_UNSUPPORTED",
  "BROADCAST_INVALID_STATE",
  "BROADCAST_TEMPLATE_REQUIRED",
  "BROADCAST_TEMPLATE_NOT_APPROVED",
  // Fase 13D: uji A/B broadcast menyala (abSplitPercentB terisi)
  // tetapi isi varian B tidak sah untuk provider-nya (teks B kosong
  // untuk provider teks) → 422. Template B WhatsApp yang hilang /
  // belum APPROVED memakai kode template yang sama seperti varian A.
  "BROADCAST_AB_INCOMPLETE",
  // Fase 10A: Meta menolak operasi template (buat/sinkron/hapus —
  // nama ganda, bentuk tidak sah, contoh variabel kurang) → 422;
  // akun WhatsApp tanpa WABA induk tercatat → 422.
  "META_TEMPLATE_INVALID",
  "META_WABA_MISSING",
  // Fase 10B: aturan komentar terikat ke akun selain IG/Messenger yang
  // terhubung (atau akun tenant lain) → 422; moderasi manual komentar
  // ditolak Meta / token akun tak tersedia → 422 (status lokal tidak
  // berubah).
  "COMMENT_CHANNEL_UNSUPPORTED",
  "META_COMMENT_ACTION_FAILED",
  // Fase 8A: flow engine — graf tidak sah saat aktivasi (daftar masalah
  // terstruktur di `details.issues`) → 422; transisi status tidak sah
  // (edit flow aktif, aktifkan yang sudah aktif, dst.) → 409.
  "FLOW_GRAPH_INVALID",
  "FLOW_INVALID_STATE",
  // Fase 12B: instantiate galeri template dengan slug tak dikenal → 404.
  "FLOW_TEMPLATE_NOT_FOUND",
  // Fase 12C: lampiran berkas KB — berkas tanpa teks yang bisa
  // diekstrak (PDF hasil pindaian / berkas rusak) → 422 dan dokumen
  // TIDAK disimpan; tipe di luar PDF/TXT/MD → 422; ukuran di atas
  // batas 5MB → 422 (konvensi apiError codebase tidak memakai 413).
  "KB_DOCUMENT_NO_TEXT",
  "KB_DOCUMENT_TYPE_UNSUPPORTED",
  "KB_DOCUMENT_TOO_LARGE",
  // Fase 12E: playground agent — provider LLM gagal menjawab atau
  // salah konfigurasi (mis. LLM_PROVIDER=openrouter tanpa kunci) → 502.
  "AGENT_PROVIDER_ERROR",
  // Fase 13B: growth links — slug publik sudah dipakai workspace lain
  // (slug unik GLOBAL) → 409; konfigurasi channel tidak sah (akun
  // bukan milik tenant / tidak connected / himpunan picker < 2) → 422;
  // URL tujuan platform tidak bisa disusun dari data akun (WhatsApp /
  // Instagram tanpa handle publik) → 422.
  "GROWTH_LINK_SLUG_TAKEN",
  "GROWTH_LINK_CHANNEL_INVALID",
  "GROWTH_LINK_TARGET_UNAVAILABLE",
  // Fase 9B: merge kontak ke dirinya sendiri → 422.
  "CONTACT_MERGE_SAME",
  // Fase 9C: kedalaman inbox tim — penerima tugas bukan member workspace
  // → 422; siklus hidup undangan tim (kedaluwarsa / dicabut / sudah
  // diterima → 422; email sesi != email undangan → 403; email sudah
  // menjadi member → 409); pemilik workspace dilindungi dari penurunan
  // peran & pengeluaran, dan member tidak bisa mengeluarkan dirinya
  // lewat endpoint tim → 422.
  "ASSIGNEE_NOT_MEMBER",
  "INVITATION_EXPIRED",
  "INVITATION_REVOKED",
  "INVITATION_ALREADY_ACCEPTED",
  "INVITATION_EMAIL_MISMATCH",
  "INVITATION_ALREADY_MEMBER",
  "TEAM_OWNER_PROTECTED",
  "TEAM_SELF_ACTION",
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

/**
 * Peta field kustom kontak: string → string (Fase 13A — sebelumnya hanya
 * bisa ditulis jalur internal: node flow `set_field`, merge kontak, dst.;
 * kini juga permukaan publik). Aturan bentuk: kunci 1–64 karakter
 * (sesudah trim), nilai string maks 1000 karakter, maks 50 entri. Nilai
 * non-string DITOLAK — pemanggil mengonversi angka/boolean sendiri agar
 * tidak ada koersi senyap. Semantik tulis: buat = apa adanya; ubah =
 * GABUNG per kunci (kunci yang dikirim menimpa, yang tidak disebut
 * dipertahankan — sama seperti set_field menulis satu kunci).
 */
export const ContactCustomFieldsSchema = z
  .record(z.string().trim().min(1).max(64), z.string().max(1000))
  .refine((fields) => Object.keys(fields).length <= 50, {
    message: "At most 50 custom fields",
  });
export type ContactCustomFields = z.infer<typeof ContactCustomFieldsSchema>;

export const CreateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(32).optional(),
  email: z.string().trim().email().max(320).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  customFields: ContactCustomFieldsSchema.optional(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>;

export const UpdateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  pipelineStage: z.string().trim().min(1).max(64).optional(),
  optInStatus: OptInStatusSchema.optional(),
  customFields: ContactCustomFieldsSchema.optional(),
});
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>;

/**
 * Status opt-in EFEKTIF (Fase 13C) — diturunkan server dari kolom
 * tersimpan, bukan disimpan apa adanya:
 * - optInStatus tersimpan "opted_out"            → "opted_out"
 * - optInStatus "opted_in" ATAU optInAt terisi   → "opted_in"
 * - selain itu                                   → "none"
 * Dipakai kondisi segmen `opt_in_status` dan gerbang broadcast
 * `require_opt_in`. Status TERSIMPAN tetap diekspos apa adanya lewat
 * `optInStatus` (enum unknown/opted_in/opted_out) agar permukaan
 * PATCH yang ada tidak berubah semantik.
 */
export const EffectiveOptInStatusSchema = z.enum([
  "opted_in",
  "none",
  "opted_out",
]);
export type EffectiveOptInStatus = z.infer<typeof EffectiveOptInStatusSchema>;

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
  /** Status opt-in efektif (Fase 13C) — lihat EffectiveOptInStatusSchema. */
  optInEffectiveStatus: EffectiveOptInStatusSchema,
  /**
   * Jalur persetujuan opt-in terakhir (Fase 13C): "keyword" (kata kunci
   * opt-in di pipeline inbound) atau "manual" (toggle dashboard/API);
   * null bila kontak belum pernah opt-in. Opt-out TIDAK menghapusnya
   * (riwayat) — status efektiflah yang menentukan boleh-tidaknya
   * broadcast.
   */
  optInSource: z.string().nullable(),
  /** Kapan opt-in terakhir diberikan (Fase 13C); null bila belum pernah. */
  optInAt: z.string().datetime().nullable(),
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

// --- Dedup & merge kontak (Fase 9B) ---

/** Alasan dua kontak dinilai kandidat duplikat (sinyal yang cocok). */
export const DuplicateReasonSchema = z.object({
  type: z.enum(["phone", "email", "channel_identity"]),
  /** Nilai ternormalisasi yang sama: telepon digit, email lowercase, atau "provider:externalUserId". */
  value: z.string(),
  contactIds: z.array(z.string().uuid()).min(2),
});
export type DuplicateReason = z.infer<typeof DuplicateReasonSchema>;

export const ContactDuplicateGroupSchema = z.object({
  contacts: z.array(ContactResponseSchema).min(2),
  reasons: z.array(DuplicateReasonSchema).min(1),
});
export type ContactDuplicateGroup = z.infer<typeof ContactDuplicateGroupSchema>;

export const ContactDuplicatesResponseSchema = z.object({
  groups: z.array(ContactDuplicateGroupSchema),
});
export type ContactDuplicatesResponse = z.infer<
  typeof ContactDuplicatesResponseSchema
>;

/** Body POST /contacts/:survivorId/merge — kontak yang dilebur ke survivor. */
export const MergeContactRequestSchema = z.object({
  mergedId: z.string().uuid(),
});
export type MergeContactRequest = z.infer<typeof MergeContactRequestSchema>;

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
  /**
   * Nama tampil penerima tugas (Fase 9C): nama user penerima tugas, jatuh
   * ke email bila nama kosong; null bila percakapan belum ditugaskan atau
   * penerimanya sudah tidak bisa diresolusi. UI menampilkan chip penugasan
   * dari dua field ini tanpa query tambahan.
   */
  assigneeName: z.string().nullable(),
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

/**
 * Penugasan percakapan (Fase 9C): tetapkan penerima tugas ke member
 * workspace mana pun, atau lepaskan dengan `assigneeUserId: null`.
 * Penerima yang bukan member ditolak server (422 ASSIGNEE_NOT_MEMBER) —
 * kontrak di sini hanya memeriksa bentuk UUID.
 */
export const AssignConversationRequestSchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
});
export type AssignConversationRequest = z.infer<
  typeof AssignConversationRequestSchema
>;

/**
 * Catatan internal percakapan (Fase 9C): catatan tim yang TIDAK PERNAH
 * terkirim ke kontak — disimpan di tabel terpisah dari pesan dan tidak
 * punya jalur ke provider mana pun. `authorName` adalah label tampil
 * penulis (nama, jatuh ke email); null bila penulis sudah terhapus
 * (UI memakai label cadangan "mantan anggota").
 */
export const ConversationNoteResponseSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  authorUserId: z.string().uuid().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationNoteResponse = z.infer<
  typeof ConversationNoteResponseSchema
>;

export const ConversationNoteListResponseSchema = z.object({
  notes: z.array(ConversationNoteResponseSchema),
});
export type ConversationNoteListResponse = z.infer<
  typeof ConversationNoteListResponseSchema
>;

export const CreateConversationNoteRequestSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type CreateConversationNoteRequest = z.infer<
  typeof CreateConversationNoteRequestSchema
>;

/**
 * Tim workspace (Fase 9C): member + undangan. Peran mengikuti
 * MemberRoleSchema yang ada (owner|admin|agent|viewer); peran `owner`
 * TIDAK bisa diberikan lewat undangan maupun perubahan peran — kepemilikan
 * tidak berpindah lewat permukaan ini.
 */
export const InvitableRoleSchema = z.enum(["admin", "agent", "viewer"]);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

export const TeamMemberResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: MemberRoleSchema,
  /** Baris ini adalah user sesi yang sedang melihat (UI menandai "Anda"). */
  isSelf: z.boolean(),
  createdAt: z.string().datetime(),
});
export type TeamMemberResponse = z.infer<typeof TeamMemberResponseSchema>;

export const TeamMemberListResponseSchema = z.object({
  members: z.array(TeamMemberResponseSchema),
});
export type TeamMemberListResponse = z.infer<typeof TeamMemberListResponseSchema>;

/** Status turunan undangan — dihitung server dari kolom waktunya. */
export const InvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: InvitableRoleSchema,
  status: InvitationStatusSchema,
  /**
   * Tautan terima utuh — HANYA disertakan pada respons PEMBUATAN
   * undangan (sekali lihat, pola kunci API 5A): yang tersimpan di server
   * hanya HASH tokennya, jadi tautan tidak bisa ditampilkan ulang dari
   * daftar; untuk tautan baru, cabut undangan lama & undang ulang.
   * Null di semua permukaan lain.
   */
  inviteUrl: z.string().nullable(),
  /**
   * Status pengiriman email undangan (Fase 11B) — HANYA bermakna pada
   * respons PEMBUATAN: "queued" = email diantrekan ke job pengiriman
   * (Resend terkonfigurasi), "not_configured" = email platform belum
   * diatur sehingga undangan hanya bisa dibagikan lewat tautan salin.
   * Null pada daftar (keadaan kirim di sana dibaca dari emailSentAt /
   * emailError di bawah).
   */
  emailDelivery: z.enum(["queued", "not_configured"]).nullable(),
  /** Waktu email undangan benar-benar terkirim (Fase 11B); null bila belum. */
  emailSentAt: z.string().datetime().nullable(),
  /**
   * Ringkasan kegagalan kirim terakhir (kode provider + pesan singkat,
   * TANPA token/isi email); null bila belum pernah gagal / sudah terkirim.
   */
  emailError: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;

export const InvitationListResponseSchema = z.object({
  invitations: z.array(InvitationResponseSchema),
});
export type InvitationListResponse = z.infer<typeof InvitationListResponseSchema>;

export const CreateInvitationRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  role: InvitableRoleSchema.default("agent"),
});
export type CreateInvitationRequest = z.infer<
  typeof CreateInvitationRequestSchema
>;

export const UpdateMemberRoleRequestSchema = z.object({
  role: InvitableRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<
  typeof UpdateMemberRoleRequestSchema
>;

/**
 * Pratinjau undangan untuk halaman terima (/invite/:token): cukup untuk
 * menampilkan "Anda diundang ke workspace X sebagai peran Y" dan apakah
 * email sesi cocok — token tidak pernah dikembalikan lagi.
 */
export const InvitationPreviewResponseSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  email: z.string(),
  role: InvitableRoleSchema,
  status: InvitationStatusSchema,
  /** Email user sesi == email undangan (penerimaan hanya boleh olehnya). */
  emailMatches: z.boolean(),
  expiresAt: z.string().datetime(),
});
export type InvitationPreviewResponse = z.infer<
  typeof InvitationPreviewResponseSchema
>;

export const AcceptInvitationResponseSchema = z.object({
  tenantId: z.string().uuid(),
  role: MemberRoleSchema,
});
export type AcceptInvitationResponse = z.infer<
  typeof AcceptInvitationResponseSchema
>;

/**
 * Ringkasan pesan yang dikutip (Fase 7B.5): resolusi server-side dari
 * `messages.reply_to_message_id` — klien TIDAK pernah menerima tautan
 * mentahnya, hanya ringkasan siap tampil ini. `contentPreview` adalah
 * teks target yang terpotong wajar; null untuk pesan non-teks tanpa
 * caption (UI menampilkan label tipe dwibahasanya sendiri dari `type`).
 * `authorLabel`: nama pengirim target bila diketahui (nama kontak /
 * nama anggota grup dari sender_name / nama user pengirim); null bila
 * tidak ada — UI memakai label cadangannya sendiri per arah.
 */
export const MessageReplyToSchema = z.object({
  id: z.string().uuid(),
  direction: MessageDirectionSchema,
  senderType: MessageSenderTypeSchema,
  type: MessageTypeSchema,
  authorLabel: z.string().nullable(),
  contentPreview: z.string().nullable(),
});
export type MessageReplyTo = z.infer<typeof MessageReplyToSchema>;

/**
 * Snapshot kutipan cadangan (Hotfix 7B.6): isi pesan yang dikutip
 * sebagaimana dikirim provider di payload webhook (Telegram menyertakan
 * teks + penulis pesan asal pada `reply_to_message`), disimpan di
 * `messages.reply_to_snapshot` saat ingest. Berbeda dari `replyTo` di
 * atas: ini BUKAN tautan ke baris kita — tidak ada `id`, tidak bisa
 * dilompati — hanya cadangan tampil untuk kutipan yang targetnya tidak
 * tertaut (mis. pesan pra-stamping provider-id) atau sudah terhapus.
 * Klien mendahulukan `replyTo` bila tidak null dan hanya memakai ini
 * bila `replyTo` null. Selalu null untuk WhatsApp & Meta (payload
 * kutipan mereka hanya membawa id, tanpa teks) dan untuk pesan yang
 * tidak mengutip.
 */
export const MessageReplyToSnapshotSchema = z.object({
  authorLabel: z.string().nullable(),
  contentPreview: z.string().nullable(),
});
export type MessageReplyToSnapshot = z.infer<
  typeof MessageReplyToSnapshotSchema
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
  /**
   * Pesan yang dikutip pesan ini (Fase 7B.5), atau null. Null juga bila
   * targetnya sudah terhapus (FK SET NULL) — kutipan lepas dengan anggun.
   */
  replyTo: MessageReplyToSchema.nullable(),
  /**
   * Snapshot kutipan cadangan (Hotfix 7B.6), terpisah dari `replyTo`
   * agar klien membedakan "tertaut" vs "cadangan": isi bila pesan ini
   * mengutip dan provider mengirim isi pesan asalnya (Telegram), apa
   * pun status tautannya; klien hanya menampilkannya bila `replyTo`
   * null.
   */
  replyToSnapshot: MessageReplyToSnapshotSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const MessageListResponseSchema = z.object({
  messages: z.array(MessageResponseSchema),
});
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

export const SendMessageRequestSchema = z.object({
  contentText: z.string().trim().min(1).max(4096),
  /**
   * Fase 7B.5: id pesan yang dikutip balasan ini (opsional). Server
   * memvalidasi target ada, milik tenant yang sama, dan berada di
   * PERCAKAPAN YANG SAMA — selain itu 422 MESSAGE_REPLY_TARGET_INVALID.
   */
  replyToMessageId: z.string().uuid().optional(),
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
   * Jenis token untuk connect manual Instagram (Fase 7D.3):
   * - 'page_access_token' (bawaan bila absen) — perilaku 7A: token di
   *   field `pageAccessToken` adalah Page Access Token dan `pageId`
   *   (Page yang terhubung) WAJIB untuk memvalidasinya.
   * - 'system_user_token' — token di field `pageAccessToken` adalah
   *   System User Access Token (SUAT) dari Pengaturan Bisnis Meta;
   *   `pageId` TIDAK dipakai: validasi langsung ke akun IG
   *   (`GET /{ig-id}?fields=id,username`) dan konteks portofolio
   *   (`client_business_id`) disimpan sebagai parent_external_id.
   *   Varian ini untuk akun IG yang portofolionya sama dengan aplikasi
   *   (kasus pemilik sendiri), yang tidak terjangkau OAuth Unified
   *   Login. Untuk provider selain 'instagram' field ini diabaikan.
   */
  tokenType: z
    .enum(["page_access_token", "system_user_token"])
    .optional(),
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

// ---------------------------------------------------------------------------
// Meta OAuth Connect (Fase 7D) — "Lanjutkan dengan Facebook" menggantikan
// tempel token sebagai jalur utama menghubungkan Messenger/Instagram/
// WhatsApp. Tiga rasa alur di balik satu callback platform:
// - messenger: Facebook Login klasik (scope di URL dialog) → user token →
//   long-lived → /me/accounts (Page + Page Access Token turunannya).
// - instagram: Unified Login (config_id) → Business Integration System
//   User Access Token (SUAT) → RANTAI penemuan multi-tepi (Fase 7D.3:
//   assigned_instagram_accounts + IG-pada-Page + IG-milik-portofolio +
//   per-Page; kandidat lewat Page membawa Page token-nya).
// - whatsapp: Embedded Signup / Login for Business (config_id) → token
//   bisnis → penemuan WABA ter-assign + nomor-nomornya.
// Token hasil exchange TIDAK PERNAH meninggalkan server: callback
// menyimpan "sesi OAuth" server-side berumur pendek di bawah id opak;
// browser hanya membawa id itu. App ID & config ID adalah identifier
// PUBLIK (bukan rahasia) — boleh tampil di respons & UI.
// ---------------------------------------------------------------------------

export const MetaOAuthProviderSchema = z.enum([
  "messenger",
  "instagram",
  "whatsapp",
]);
export type MetaOAuthProvider = z.infer<typeof MetaOAuthProviderSchema>;

export const MetaOAuthStartRequestSchema = z.object({
  provider: MetaOAuthProviderSchema,
});
export type MetaOAuthStartRequest = z.infer<typeof MetaOAuthStartRequestSchema>;

export const MetaOAuthStartResponseSchema = z.object({
  /** URL dialog Meta yang siap diarahkan browser (state sudah tertanam). */
  dialogUrl: z.string(),
  /** Kapan state dialog ini kedaluwarsa (state sekali pakai, ≤10 menit). */
  expiresAt: z.string().datetime(),
});
export type MetaOAuthStartResponse = z.infer<
  typeof MetaOAuthStartResponseSchema
>;

/**
 * Ketersediaan OAuth per provider untuk workspace (owner/admin) — dasar
 * UI memutuskan menampilkan tombol "Lanjutkan dengan Facebook" aktif,
 * nonaktif, atau menyembunyikannya. `available` = appId terisi DAN app
 * secret terisi DAN (untuk instagram/whatsapp) config ID provider itu
 * terisi.
 */
export const MetaOAuthInfoResponseSchema = z.object({
  /** Redirect URI tunggal yang harus didaftarkan di Meta App. */
  oauthRedirectUri: z.string(),
  /** App ID Meta platform (identifier publik); null bila belum diatur. */
  appId: z.string().nullable(),
  appIdConfigured: z.boolean(),
  appSecretConfigured: z.boolean(),
  providers: z.object({
    messenger: z.object({ available: z.boolean() }),
    instagram: z.object({
      available: z.boolean(),
      configId: z.string().nullable(),
    }),
    whatsapp: z.object({
      available: z.boolean(),
      configId: z.string().nullable(),
    }),
  }),
});
export type MetaOAuthInfoResponse = z.infer<typeof MetaOAuthInfoResponseSchema>;

/**
 * Satu aset yang bisa dipilih pemilik sesudah login Meta. `assetId`
 * adalah external_id channel masa depan (Page ID / ID akun IG / Phone
 * Number ID). Untuk WhatsApp, `parentId`/`parentName` = WABA pemilik
 * nomor; untuk Instagram, `parentId` = client_business_id portfolio
 * klien; untuk Messenger selalu null dan `linkedIgUsername` hanya info.
 *
 * `connectable` (Hotfix R1): false bila aset DITEMUKAN tetapi tidak
 * memiliki kredensial yang dapat dipakai untuk connect — saat ini
 * hanya untuk Page Messenger yang terlihat lewat tepi bisnis
 * (assigned/businesses) tetapi Page Access Token-nya tidak berhasil
 * diisi dari Graph. Aset seperti itu TETAP ditampilkan di pemilih
 * (ditandai nonaktif + `unavailableReason`), TIDAK hilang diam-diam;
 * endpoint complete menolaknya dengan META_OAUTH_ASSET_NOT_CONNECTABLE.
 * Aset lama di sesi yang tersimpan sebelum field ini ada terbaca
 * connectable=true lewat default skema.
 */
export const MetaOAuthAssetSchema = z.object({
  assetId: z.string(),
  kind: z.enum(["page", "instagram_account", "whatsapp_number"]),
  name: z.string().nullable(),
  handle: z.string().nullable(),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  linkedIgUsername: z.string().nullable(),
  connectable: z.boolean().default(true),
  unavailableReason: z
    .enum(["missing_page_token"])
    .nullable()
    .default(null),
});
export type MetaOAuthAsset = z.infer<typeof MetaOAuthAssetSchema>;

/**
 * Petunjuk keadaan kosong pemilih OAuth (Fase 7D.3) — hanya bermakna
 * untuk provider 'instagram' saat daftar aset kosong; membedakan
 * penyebab yang arahan perbaikannya BERBEDA (ditentukan dari probe
 * profil token + jejak rantai penemuan di callback):
 * - 'not_system_user': token hasil login BUKAN System User token
 *   (client_business_id kosong) — periksa jenis token pada konfigurasi
 *   Facebook Login untuk Bisnis (Unified Login wajib menerbitkan SUAT).
 * - 'no_accounts_shared': SUAT sah tetapi semua tepi penemuan kosong —
 *   akun belum dibagikan ke aplikasi, atau kasus portofolio-sama
 *   (akun pemilik aplikasi sendiri tidak diserahkan lewat login ini;
 *   jalur keluarnya connect manual varian System User Token).
 * - 'business_permission_missing': tepi IG-milik-portofolio
 *   (/me/businesses) menolak dengan error izin — konfigurasi Login
 *   untuk Bisnis kemungkinan belum memuat business_management.
 * null bila tidak relevan (aset tidak kosong / provider lain / probe
 * dan jejak tidak memberi kesimpulan).
 */
export const MetaOAuthEmptyHintSchema = z.enum([
  "not_system_user",
  "no_accounts_shared",
  "business_permission_missing",
]);
export type MetaOAuthEmptyHint = z.infer<typeof MetaOAuthEmptyHintSchema>;

/**
 * Isi sesi OAuth yang boleh dilihat browser: daftar aset TANPA token apa
 * pun. Token hidup terenkripsi di server dan hanya dipakai endpoint
 * complete.
 */
export const MetaOAuthSessionResponseSchema = z.object({
  sessionId: z.string(),
  provider: MetaOAuthProviderSchema,
  assets: z.array(MetaOAuthAssetSchema),
  /** Fase 7D.3: petunjuk spesifik saat `assets` kosong (instagram). */
  emptyHint: MetaOAuthEmptyHintSchema.nullable(),
  expiresAt: z.string().datetime(),
});
export type MetaOAuthSessionResponse = z.infer<
  typeof MetaOAuthSessionResponseSchema
>;

export const MetaOAuthCompleteRequestSchema = z.object({
  assetId: z.string().trim().min(1).max(255),
});
export type MetaOAuthCompleteRequest = z.infer<
  typeof MetaOAuthCompleteRequestSchema
>;

/**
 * Peringatan non-fatal sesudah complete: koneksi berhasil (token & akun
 * valid) tetapi langkah pendamping gagal — saat ini hanya kegagalan
 * auto-subscribe webhook, yang bisa diulang dari "Hubungkan lagi".
 */
export const MetaOAuthWarningSchema = z.enum(["META_SUBSCRIBE_FAILED"]);
export type MetaOAuthWarning = z.infer<typeof MetaOAuthWarningSchema>;

export const MetaOAuthCompleteResponseSchema = z.object({
  channel: ChannelAccountResponseSchema,
  warnings: z.array(MetaOAuthWarningSchema),
});
export type MetaOAuthCompleteResponse = z.infer<
  typeof MetaOAuthCompleteResponseSchema
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
  /**
   * Slug growth link (Fase 13B): sesi yang dibuka dari tautan
   * /go/<slug> untuk channel webchat membawa slug ini agar kontak
   * teratribusi ke tautan itu (sumber + auto-tag + event konversi).
   * Diabaikan diam-diam bila slug tidak dikenal/tidak aktif/bukan
   * milik channel ini — sesi tidak pernah gagal karena atribusi.
   */
  src: z.string().trim().min(3).max(64).optional(),
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

export const AutomationKindSchema = z.enum([
  "keyword",
  "sequence",
  // Fase 10B: aturan komentar (comment-to-DM + moderasi).
  "comment",
]);
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

/**
 * Aturan komentar (Fase 10B): pemicu keyword yang sama, tetapi diterapkan
 * pada TEKS KOMENTAR publik di SATU akun Instagram/Messenger
 * (channelAccountId). Aksi dapat dikombinasikan (minimal satu aktif):
 * - sendDm: DM privat ke penulis komentar (private reply); teksnya
 *   `dmText` — wajib terisi bila sendDm true.
 * - publicReplyText: balasan publik pada komentar; null/kosong = mati.
 * - hideComment: sembunyikan komentar (mode moderasi murni =
 *   sendDm false + publicReplyText kosong + hideComment true).
 */
export const CreateCommentAutomationRequestSchema = z
  .object({
    kind: z.literal("comment"),
    name: AutomationNameSchema,
    keywords: AutomationKeywordsSchema,
    match: AutomationMatchSchema.default("exact"),
    channelAccountId: z.string().uuid(),
    sendDm: z.boolean().default(false),
    dmText: z.string().trim().max(4096).optional(),
    publicReplyText: z.string().trim().max(4096).nullable().optional(),
    hideComment: z.boolean().default(false),
  })
  .refine((v) => !v.sendDm || (v.dmText && v.dmText.length > 0), {
    message: "dmText is required when sendDm is true",
    path: ["dmText"],
  })
  .refine(
    (v) =>
      v.sendDm ||
      (v.publicReplyText != null && v.publicReplyText.length > 0) ||
      v.hideComment,
    { message: "At least one comment action must be enabled" },
  );
export type CreateCommentAutomationRequest = z.infer<
  typeof CreateCommentAutomationRequestSchema
>;

export const CreateAutomationRequestSchema = z.union([
  CreateKeywordAutomationRequestSchema,
  CreateSequenceAutomationRequestSchema,
  CreateCommentAutomationRequestSchema,
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
    /** Fase 10B — hanya bermakna untuk aturan kind='comment'. */
    sendDm: z.boolean().optional(),
    publicReplyText: z.string().trim().max(4096).nullable().optional(),
    hideComment: z.boolean().optional(),
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
  triggerType: z.enum(["keyword", "comment"]),
  /** Jenis automation (Fase 2C): 'keyword' (balasan langsung) | 'sequence' | 'comment' (Fase 10B). */
  kind: AutomationKindSchema,
  keywords: z.array(z.string()),
  match: AutomationMatchSchema,
  actionType: z.literal("send_message"),
  /** Isi balasan untuk kind='keyword'; untuk sequence selalu string kosong. */
  text: z.string(),
  /**
   * Fase 10B — akun terikat aturan komentar (uuid channel_accounts);
   * null untuk aturan pesan. Field komentar lain hanya bermakna untuk
   * kind='comment' dan selalu terisi default aman untuk aturan lama.
   */
  channelAccountId: z.string().uuid().nullable(),
  /** Fase 10B: aksi DM privat aktif (teks DM-nya ada di `text`). */
  sendDm: z.boolean(),
  /** Fase 10B: teks balasan publik; null = aksi mati. */
  publicReplyText: z.string().nullable(),
  /** Fase 10B: aksi sembunyikan komentar aktif. */
  hideComment: z.boolean(),
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
// Comments (Fase 10B) — komentar publik Instagram/Messenger yang tercatat
// dari webhook Meta, beserta jejak aksi aturan comment-to-DM/moderasi.
// Daftar bersifat baca-saja dari sisi API; satu-satunya tulis adalah
// moderasi manual sembunyikan/tampilkan (POST .../hide | .../unhide).
// ---------------------------------------------------------------------------

export const CommentModerationStatusSchema = z.enum(["visible", "hidden"]);
export type CommentModerationStatus = z.infer<
  typeof CommentModerationStatusSchema
>;

/** Jejak hasil satu aksi pada sebuah komentar (comments.actions di DB). */
export const CommentActionTraceSchema = z.object({
  dm: z
    .object({
      status: z.enum(["queued", "skipped", "failed"]),
      messageId: z.string().uuid().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  publicReply: z
    .object({
      status: z.enum(["sent", "failed"]),
      replyId: z.string().nullable().optional(),
      errorCode: z.string().optional(),
    })
    .optional(),
  hide: z
    .object({
      status: z.enum(["hidden", "failed"]),
      errorCode: z.string().optional(),
    })
    .optional(),
  skipped: z.literal("own_comment").optional(),
  evaluatedAt: z.string().optional(),
});
export type CommentActionTrace = z.infer<typeof CommentActionTraceSchema>;

export const CommentResponseSchema = z.object({
  id: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  /** Nama tampilan akun pemilik komentar (untuk label daftar). */
  channelDisplayName: z.string(),
  provider: z.enum(["instagram", "messenger"]),
  providerCommentId: z.string(),
  mediaId: z.string().nullable(),
  postId: z.string().nullable(),
  parentId: z.string().nullable(),
  authorExternalId: z.string(),
  authorUsername: z.string().nullable(),
  text: z.string(),
  providerCreatedAt: z.string().datetime().nullable(),
  moderationStatus: CommentModerationStatusSchema,
  contactId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  matchedAutomationId: z.string().uuid().nullable(),
  actions: CommentActionTraceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CommentResponse = z.infer<typeof CommentResponseSchema>;

export const CommentListResponseSchema = z.object({
  comments: z.array(CommentResponseSchema),
});
export type CommentListResponse = z.infer<typeof CommentListResponseSchema>;

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
// AI Playground (Fase 12E) — uji KERING agent dari dashboard hub /agents.
// Balasan dihitung lewat jalur yang sama persis seperti runtime
// (prompt agent + retrieval KB hibrida + provider LLM), tetapi tool call
// TIDAK dieksekusi — dikembalikan sebagai "niat" terstruktur — dan tidak
// ada percakapan/pesan/kontak/saran yang ditulis. Pemakaian token tetap
// tercatat di usage_ledger dengan refType khusus `agent_playground`,
// TERPISAH dari `agent_response`: tidak mengonsumsi cap 200 respons/hari
// dan tidak masuk agregat analytics (dasbor 9B menyaring agent_response).
// ---------------------------------------------------------------------------

export const AgentPlaygroundHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
});
export type AgentPlaygroundHistoryMessage = z.infer<
  typeof AgentPlaygroundHistoryMessageSchema
>;

export const AgentPlaygroundRequestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  /** Riwayat uji sebelumnya (hanya hidup di klien; maks 20 giliran). */
  history: z.array(AgentPlaygroundHistoryMessageSchema).max(20).optional(),
});
export type AgentPlaygroundRequest = z.infer<
  typeof AgentPlaygroundRequestSchema
>;

export const AgentPlaygroundIntentKindSchema = z.enum([
  "add_tag",
  "set_stage",
  "handoff",
  "create_payment_link",
  "unknown",
]);
export type AgentPlaygroundIntentKind = z.infer<
  typeof AgentPlaygroundIntentKindSchema
>;

export const AgentPlaygroundIntentSchema = z.object({
  kind: AgentPlaygroundIntentKindSchema,
  /** add_tag: tag (ternormalisasi seperti executor) yang AKAN dipasang. */
  tag: z.string().nullable().optional(),
  /** set_stage: tahap tujuan yang diusulkan model. */
  stage: z.string().nullable().optional(),
  /** handoff: alasan yang diusulkan model. */
  reason: z.string().nullable().optional(),
  /**
   * create_payment_link: produk yang AKAN dipakai, dari pencocokan
   * BACA-SAJA yang sama seperti executor; null = tidak ada produk aktif.
   */
  productId: z.string().uuid().nullable().optional(),
  productName: z.string().nullable().optional(),
  /** create_payment_link: nama produk yang diminta model (query mentah). */
  query: z.string().nullable().optional(),
  /** unknown: nama tool mentah dari model yang tidak dikenal runtime. */
  toolName: z.string().nullable().optional(),
});
export type AgentPlaygroundIntent = z.infer<
  typeof AgentPlaygroundIntentSchema
>;

export const AgentPlaygroundKbHitSchema = z.object({
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentTitle: z.string(),
  chunkIndex: z.number().int(),
  /** Cuplikan isi chunk (dipotong server, maks 280 karakter). */
  snippet: z.string(),
  /** Jalur retrieval yang menemukan chunk ini (Fase 12D). */
  sources: z.array(z.enum(["fts", "vector"])),
});
export type AgentPlaygroundKbHit = z.infer<
  typeof AgentPlaygroundKbHitSchema
>;

export const AgentPlaygroundUsageSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  /** Biaya aktual provider (USD); null = provider tidak melaporkannya. */
  costUsd: z.number().nullable(),
});
export type AgentPlaygroundUsage = z.infer<
  typeof AgentPlaygroundUsageSchema
>;

export const AgentPlaygroundResponseSchema = z.object({
  /** Teks balasan yang AKAN dikirim agent (mode auto) / diusulkan (suggest). */
  replyText: z.string(),
  mode: AgentModeSchema,
  /** Mode retrieval yang benar-benar terjadi pada lari ini. */
  retrieval: z.enum(["hybrid", "fts"]),
  kbHits: z.array(AgentPlaygroundKbHitSchema),
  intents: z.array(AgentPlaygroundIntentSchema),
  usage: AgentPlaygroundUsageSchema,
});
export type AgentPlaygroundResponse = z.infer<
  typeof AgentPlaygroundResponseSchema
>;

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

/**
 * Berkas lampiran KB (Fase 12C): byte asli tersimpan di
 * `kb_source_documents`; teks hasil ekstraksinya menjadi satu entri
 * `KbDocumentResponse` biasa (`documentId` di sini) yang ter-chunk
 * untuk retrieval. Respons ini TIDAK pernah membawa byte berkas —
 * unduh berkas asli tidak dibuat di v1.
 */
export const KbFileDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  /** Jumlah chunk entri KB turunan berkas ini. */
  chunkCount: z.number().int().nonnegative(),
  /** Id entri KB (kb_documents) yang lahir dari berkas ini. */
  documentId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type KbFileDocumentResponse = z.infer<
  typeof KbFileDocumentResponseSchema
>;

export const KbFileDocumentListResponseSchema = z.object({
  files: z.array(KbFileDocumentResponseSchema),
});
export type KbFileDocumentListResponse = z.infer<
  typeof KbFileDocumentListResponseSchema
>;

/**
 * Statistik indeks KB (Fase 12D): cakupan embedding chunk + status
 * pencarian semantik SEBAGAIMANA di-resolve proses API (provider yang
 * sama dengan yang dipakai worker: mock paksa via env, atau OpenRouter
 * dari kunci Panel Admin → env; tanpa kunci → active=false dan agent
 * mencari full-text saja). `provider`/`model` null bila nonaktif.
 */
export const KbStatsResponseSchema = z.object({
  totalChunks: z.number().int().nonnegative(),
  embeddedChunks: z.number().int().nonnegative(),
  semanticSearch: z.object({
    active: z.boolean(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
  }),
});
export type KbStatsResponse = z.infer<typeof KbStatsResponseSchema>;

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
  // Fase 10B: permukaan publik komentar (aturan sinkronisasi kontrak).
  "comments:read",
  "comments:write",
  // Fase 13B: permukaan BACA publik growth links (tulis tetap
  // dashboard-only — slug publik + branding adalah artefak kurasi UI;
  // lihat docs/COVERAGE-MATRIX.md).
  "growth_links:read",
  // Fase 13C: permukaan BACA publik segmen (tulis tetap dashboard-only
  // — segmen adalah artefak kurasi UI dengan definisi kondisi kompleks;
  // lihat docs/COVERAGE-MATRIX.md).
  "segments:read",
  // Fase 15A: permukaan BACA publik untuk sumber daya yang sebelumnya
  // hanya dashboard (aturan sinkronisasi kontrak dijalankan retrospektif).
  // Tulis untuk sumber daya ini tetap dashboard-only — lihat
  // docs/COVERAGE-MATRIX.md untuk alasan per sumber daya.
  "broadcasts:read",
  "flows:read",
  "automations:read",
  "agents:read",
  "channels:read",
  "whatsapp_templates:read",
  "knowledge:read",
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const API_KEY_SCOPES: readonly ApiKeyScope[] = [
  "contacts:read",
  "contacts:write",
  "conversations:read",
  "messages:write",
  "products:read",
  "comments:read",
  "comments:write",
  "broadcasts:read",
  "flows:read",
  "automations:read",
  "agents:read",
  "channels:read",
  "whatsapp_templates:read",
  "knowledge:read",
  "growth_links:read",
  "segments:read",
] as const;

/** Default aman saat pembuatan tidak menyebut scope: hanya baca. */
export const API_KEY_DEFAULT_SCOPES: readonly ApiKeyScope[] = [
  "contacts:read",
  "conversations:read",
  "products:read",
  "comments:read",
  "broadcasts:read",
  "flows:read",
  "automations:read",
  "agents:read",
  "channels:read",
  "whatsapp_templates:read",
  "knowledge:read",
  "growth_links:read",
  "segments:read",
] as const;

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  scopes: z.array(ApiKeyScopeSchema).max(16).optional(),
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

/** Query daftar komentar API publik /v1 (Fase 10B). */
export const V1ListCommentsQuerySchema = z.object({
  channelAccountId: z.string().uuid().optional(),
  automationId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type ListCommentsQuery = z.infer<typeof V1ListCommentsQuerySchema>;

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
  // Fase 7D: identifier PUBLIK Meta untuk OAuth — BUKAN rahasia (App ID
  // tampil di setiap URL dialog; config ID diakui Meta bukan rahasia).
  // Berbeda dari kunci lain, nilainya DITAMPILKAN di UI admin lewat
  // PlatformMetaInfo agar bisa diverifikasi pemilik platform.
  "meta_app_id",
  "meta_ig_config_id",
  "meta_wa_config_id",
  // Fase 11B: email transaksional via Resend (keputusan user 2026-11-02).
  // `resend_api_key` adalah RAHASIA (pola kunci lain: status saja yang
  // dipertukarkan). `resend_from_email` / `resend_from_name` adalah
  // identitas pengirim — BUKAN rahasia; nilai efektifnya ditampilkan di
  // panel lewat PlatformEmailInfo agar bisa diverifikasi pemilik.
  "resend_api_key",
  "resend_from_email",
  "resend_from_name",
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

/**
 * Info Meta BUKAN rahasia (Fase 7D): nilai efektif App ID + config ID
 * (panel → env) DITAMPILKAN agar pemilik bisa memverifikasinya — ketiganya
 * identifier publik, bukan kredensial. `oauthRedirectUri` adalah callback
 * tunggal yang harus didaftarkan persis di Meta App (Facebook Login /
 * konfigurasi Login for Business).
 */
export const PlatformMetaInfoSchema = z.object({
  appId: z.string().nullable(),
  igConfigId: z.string().nullable(),
  waConfigId: z.string().nullable(),
  oauthRedirectUri: z.string(),
});
export type PlatformMetaInfo = z.infer<typeof PlatformMetaInfoSchema>;

/**
 * Info email BUKAN rahasia (Fase 11B): identitas pengirim Resend efektif
 * (panel → env) DITAMPILKAN agar pemilik bisa memverifikasinya. Kunci
 * API Resend sendiri rahasia dan tidak pernah muncul di kontrak mana pun
 * (hanya statusnya, seperti kunci lain).
 */
export const PlatformEmailInfoSchema = z.object({
  fromEmail: z.string().nullable(),
  fromName: z.string().nullable(),
});
export type PlatformEmailInfo = z.infer<typeof PlatformEmailInfoSchema>;

export const PlatformSettingsResponseSchema = z.object({
  settings: z.array(PlatformSettingStatusSchema),
  r2: PlatformR2InfoSchema,
  meta: PlatformMetaInfoSchema,
  email: PlatformEmailInfoSchema,
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

// ---------------------------------------------------------------------------
// Penelusur log audit (Fase 7B.4) — pembacaan `audit_logs` (read-only)
// ---------------------------------------------------------------------------

/**
 * Jenis pelaku audit — persis enum DB `audit_actor_type` dan nilai yang
 * benar-benar ditulis penulis audit di core: `user` (operator dashboard
 * & admin platform), `agent` (runtime agent AI, termasuk tool-nya),
 * `system` (komponen: poller/webhook/purge/halaman bayar), `api_key`
 * (API publik /v1 — saat ini hanya `message.queued`).
 */
export const AuditActorTypeSchema = z.enum([
  "user",
  "agent",
  "system",
  "api_key",
]);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

/**
 * Kategori audit = awalan `action` sebelum titik pertama, dari taksonomi
 * NYATA penulis audit di core (tenant.*, channel.*, message.*,
 * automation.*, sequence.*, agent.*, contact.* — dua aksi tool agent,
 * payment_link.*, payment.*, api_key.*, telegram.*, integration.*,
 * platform_settings.*). Dipakai sebagai filter daftar.
 */
export const AuditCategorySchema = z.enum([
  "tenant",
  "channel",
  "message",
  "automation",
  "sequence",
  "agent",
  "contact",
  "payment_link",
  "payment",
  "api_key",
  "telegram",
  "integration",
  "platform_settings",
  "broadcast",
  "whatsapp_template",
  "flow",
  "kb_document",
]);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

/** Target ringkas satu baris audit, diturunkan server dari meta. */
export const AuditLogTargetSchema = z.object({
  /** Jenis entitas, mis. `channel_account`, `message`, `api_key`. */
  type: z.string(),
  /** Id entitas (uuid) atau pengenal stabil lain (mis. nama kunci panel). */
  id: z.string(),
});
export type AuditLogTarget = z.infer<typeof AuditLogTargetSchema>;

/**
 * Satu baris audit sebagaimana tampil di penelusur. Berbeda dari log
 * integrasi (payload ±32KB → endpoint detail terpisah), `meta` audit
 * kecil (id referensi + fakta berkode) sehingga ikut di respons daftar
 * dan baris UI dapat diperluas tanpa panggilan kedua. `actorLabel`
 * adalah resolusi server sebisa mungkin: user → nama/email; api_key →
 * nama kunci + prefix; agent → nama agent; system → nama komponen
 * (actorId itu sendiri). Null bila pelaku tak lagi dapat di-resolve
 * (mis. agent sudah dihapus) — UI jatuh ke actorId mentah.
 */
export const AuditLogResponseSchema = z.object({
  id: z.string().uuid(),
  /** Null = baris tingkat platform (hanya pandangan admin platform). */
  tenantId: z.string().uuid().nullable(),
  actorType: AuditActorTypeSchema,
  actorId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  action: z.string(),
  category: z.string(),
  target: AuditLogTargetSchema.nullable(),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

export const AuditLogListResponseSchema = z.object({
  entries: z.array(AuditLogResponseSchema),
  /** Kursor opaque halaman berikutnya; null = habis. */
  nextCursor: z.string().nullable(),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

/**
 * Query penelusur audit: filter actor/kategori/rentang tanggal +
 * pencarian teks bebas pada kolom `action` (substring, wildcard LIKE
 * di-escape server) + paginasi kursor (pola log integrasi).
 */
export const AuditLogListQuerySchema = z.object({
  actorType: AuditActorTypeSchema.optional(),
  category: AuditCategorySchema.optional(),
  q: z.string().min(1).max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;

// ---------------------------------------------------------------------------
// Fase 9B — Analitik pemakaian AI (dasbor /analytics)
// ---------------------------------------------------------------------------

/**
 * Laporan pemakaian AI satu tenant dari usage_ledger (type='ai_token').
 * Kejujuran angka adalah bagian kontrak:
 * - `tokensIn`/`tokensOut` hanya menjumlah baris BER-RINCIAN (meta Fase
 *   9B); baris warisan tanpa rincian dihitung di `undetailedResponses`
 *   dan hanya menyumbang `responses` + `tokensTotal` (dari kolom qty).
 * - `costUsd` adalah biaya AKTUAL yang dilaporkan provider (OpenRouter);
 *   null bila tak satu pun respons pada periode melaporkan biaya.
 *   `costReportedResponses` menunjukkan cakupan biayanya. Tidak ada
 *   estimasi harga karangan di mana pun pada kontrak ini.
 */
export const AiUsageDayPointSchema = z.object({
  /** Tanggal UTC (YYYY-MM-DD). */
  date: z.string(),
  responses: z.number().int().nonnegative(),
  tokensIn: z.number().nonnegative(),
  tokensOut: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type AiUsageDayPoint = z.infer<typeof AiUsageDayPointSchema>;

export const AiUsageAgentPointSchema = z.object({
  /** Null untuk keranjang baris warisan tanpa rincian agent. */
  agentId: z.string().uuid().nullable(),
  agentName: z.string().nullable(),
  responses: z.number().int().nonnegative(),
  tokensIn: z.number().nonnegative(),
  tokensOut: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  models: z.array(z.string()),
});
export type AiUsageAgentPoint = z.infer<typeof AiUsageAgentPointSchema>;

export const AiUsageReportResponseSchema = z.object({
  days: z.number().int().positive(),
  responses: z.number().int().nonnegative(),
  tokensTotal: z.number().nonnegative(),
  tokensIn: z.number().nonnegative(),
  tokensOut: z.number().nonnegative(),
  detailedResponses: z.number().int().nonnegative(),
  undetailedResponses: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  costReportedResponses: z.number().int().nonnegative(),
  daily: z.array(AiUsageDayPointSchema),
  perAgent: z.array(AiUsageAgentPointSchema),
  cap: z.object({
    dailyLimit: z.number().int().positive(),
    usedToday: z.number().int().nonnegative(),
    remainingToday: z.number().int().nonnegative(),
  }),
});
export type AiUsageReportResponse = z.infer<typeof AiUsageReportResponseSchema>;

// ---------------------------------------------------------------------------
// Fase 7C — Broadcasts v1
// ---------------------------------------------------------------------------

/**
 * Status broadcast. `draft` hanya hidup di dashboard; `scheduled`
 * menunggu job worker `broadcast.dispatch` (delayed sampai
 * scheduled_at); `sending` selama dispatch berjalan dan penerima belum
 * semuanya terminal; status akhir dihitung dari baris penerima:
 * completed (tanpa failed), partially_failed (ada failed), failed
 * (semua penerima gagal / dispatch gagal), cancelled (dibatalkan
 * sebelum atau saat pengiriman — sisa queued dihapus).
 */
export const BroadcastStatusSchema = z.enum([
  "draft",
  "scheduled",
  "sending",
  "completed",
  "partially_failed",
  "failed",
  "cancelled",
]);
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;

/**
 * Status satu penerima. queued/sent/delivered/read/failed mengikuti
 * status pesan keluarnya; skipped adalah terminal lokal saat dispatch
 * (skipReason wajib menyertainya); cancelled = pesan queued-nya
 * dihapus oleh pembatalan broadcast.
 */
export const BroadcastRecipientStatusSchema = z.enum([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
  "cancelled",
]);
export type BroadcastRecipientStatus = z.infer<
  typeof BroadcastRecipientStatusSchema
>;

/** Alasan penerima dilewati saat dispatch (tidak dicoba kirim). */
export const BroadcastSkipReasonSchema = z.enum([
  "opted_out",
  // Fase 13C: broadcast require_opt_in dan status opt-in efektif
  // kontak bukan "opted_in".
  "not_opted_in",
  "outside_24h_window",
  "message_deleted",
  // Fase 10A: variabel template WhatsApp penerima tidak terpetakan,
  // atau identitas penerima tidak membawa alamat (nomor) tujuan.
  "template_variable_missing",
  "missing_phone_number",
]);
export type BroadcastSkipReason = z.infer<typeof BroadcastSkipReasonSchema>;

/**
 * Filter audiens broadcast. Mode ditentukan `audience`:
 * - "all"     : semua kontak beridentitas di channel itu.
 * - "tag"     : kontak cocok bila punya SALAH SATU tag pada `tags`
 *               (OR dalam kelompok) DAN stage pipeline-nya termasuk
 *               salah satu `stages`; antar-kelompok digabung AND.
 * - "segment" : keanggotaan ditentukan evaluator segmen (Fase 13C)
 *               atas segmen `segmentId`.
 * Baris lama tanpa `audience` diturunkan modenya server dari isi
 * filter (segmentId → segment; tags/stages non-kosong → tag; selain
 * itu all) — perilaku tag yang ada tidak berubah (regresi nol).
 */
export const BroadcastAudienceFilterSchema = z.object({
  audience: z.enum(["all", "tag", "segment"]).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  stages: z.array(z.string().min(1).max(64)).max(20).optional(),
  segmentId: z.string().uuid().optional(),
});
export type BroadcastAudienceFilter = z.infer<
  typeof BroadcastAudienceFilterSchema
>;

/** Statistik penerima — SELALU dihitung server dari broadcast_recipients. */
export const BroadcastStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});
export type BroadcastStats = z.infer<typeof BroadcastStatsSchema>;

export const BroadcastResponseSchema = z.object({
  id: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  /** Provider + label channel diturunkan server untuk daftar UI. */
  provider: ChannelProviderSchema,
  channelDisplayName: z.string().nullable(),
  name: z.string(),
  messageText: z.string(),
  /**
   * Template WhatsApp untuk broadcast provider whatsapp (Fase 10A):
   * id baris cermin lokal; null untuk provider lain (dan untuk
   * broadcast WA yang templatenya sudah terhapus — wajib memilih
   * ulang sebelum bisa dijadwalkan lagi).
   */
  whatsappTemplateId: z.string().uuid().nullable(),
  /**
   * Sumber nilai variabel BODY template per posisi (Fase 10A):
   * "name" = nama kontak; nilai lain = kunci custom_fields kontak.
   */
  templateVariableSources: z.array(z.string()),
  audienceFilter: BroadcastAudienceFilterSchema,
  /**
   * Gerbang opt-in (Fase 13C): true = hanya kontak berstatus opt-in
   * efektif yang dikirimi; sisanya dicatat skipped `not_opted_in`.
   * Bawaan server saat buat: true untuk WhatsApp, false selain itu.
   */
  requireOptIn: z.boolean(),
  status: BroadcastStatusSchema,
  scheduledAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  /** Kode kegagalan tingkat dispatch (CHANNEL_DISCONNECTED / AUDIENCE_EMPTY). */
  errorCode: z.string().nullable(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  stats: BroadcastStatsSchema,
});
export type BroadcastResponse = z.infer<typeof BroadcastResponseSchema>;

export const BroadcastListResponseSchema = z.object({
  broadcasts: z.array(BroadcastResponseSchema),
  nextCursor: z.string().nullable(),
});
export type BroadcastListResponse = z.infer<typeof BroadcastListResponseSchema>;

export const BroadcastListQuerySchema = z.object({
  status: BroadcastStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type BroadcastListQuery = z.infer<typeof BroadcastListQuerySchema>;

export const CreateBroadcastRequestSchema = z.object({
  name: z.string().min(1).max(255),
  channelAccountId: z.string().uuid(),
  /**
   * Isi pesan teks — wajib untuk telegram/messenger/instagram.
   * Untuk whatsapp kolom ini diabaikan (isi broadcast adalah template;
   * server menyimpan teks BODY template sebagai snapshot) dan
   * `whatsappTemplateId` yang wajib (422 BROADCAST_TEMPLATE_REQUIRED).
   */
  messageText: z.string().min(1).max(4096).optional(),
  /** Template WhatsApp (Fase 10A) — wajib & harus APPROVED untuk channel whatsapp. */
  whatsappTemplateId: z.string().uuid().optional(),
  /** Sumber variabel template per posisi (Fase 10A): "name" atau kunci custom_fields. */
  templateVariableSources: z
    .array(z.string().min(1).max(64))
    .max(25)
    .optional(),
  audienceFilter: BroadcastAudienceFilterSchema.optional(),
  /** Gerbang opt-in (Fase 13C); kosong = bawaan server per provider. */
  requireOptIn: z.boolean().optional(),
  /**
   * Uji A/B (Fase 13D): persen penerima yang masuk varian B (1..99).
   * Mengisinya MENYALAKAN A/B dan mewajibkan isi varian B: teks
   * `variantBMessageText` untuk provider teks, atau
   * `variantBWhatsappTemplateId` untuk WhatsApp (gerbang template
   * yang sama seperti varian A). Tidak diisi = tanpa A/B.
   */
  abSplitPercentB: z.number().int().min(1).max(99).optional(),
  /** Isi varian B untuk provider teks (Fase 13D). */
  variantBMessageText: z.string().min(1).max(4096).optional(),
  /** Template WhatsApp varian B (Fase 13D) — wajib & APPROVED untuk channel whatsapp ber-A/B. */
  variantBWhatsappTemplateId: z.string().uuid().optional(),
  /** Sumber variabel template B per posisi (Fase 13D). */
  variantBTemplateVariableSources: z
    .array(z.string().min(1).max(64))
    .max(25)
    .optional(),
});
export type CreateBroadcastRequest = z.infer<
  typeof CreateBroadcastRequestSchema
>;

/** Edit hanya sah selama broadcast masih `draft`. */
export const UpdateBroadcastRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  channelAccountId: z.string().uuid().optional(),
  messageText: z.string().min(1).max(4096).optional(),
  whatsappTemplateId: z.string().uuid().nullable().optional(),
  templateVariableSources: z
    .array(z.string().min(1).max(64))
    .max(25)
    .optional(),
  audienceFilter: BroadcastAudienceFilterSchema.optional(),
  /** Gerbang opt-in (Fase 13C) — hanya bisa diubah selama draft. */
  requireOptIn: z.boolean().optional(),
  /**
   * Uji A/B (Fase 13D) — hanya selama draft. `null` eksplisit =
   * MATIKAN A/B (semua kolom varian B dibersihkan); tidak diisi =
   * biarkan seperti tersimpan. Keadaan akhir selalu divalidasi utuh:
   * A/B menyala wajib punya isi varian B yang sah untuk provider-nya.
   */
  abSplitPercentB: z.number().int().min(1).max(99).nullable().optional(),
  variantBMessageText: z.string().min(1).max(4096).nullable().optional(),
  variantBWhatsappTemplateId: z.string().uuid().nullable().optional(),
  variantBTemplateVariableSources: z
    .array(z.string().min(1).max(64))
    .max(25)
    .optional(),
});
export type UpdateBroadcastRequest = z.infer<
  typeof UpdateBroadcastRequestSchema
>;

/**
 * Jadwalkan broadcast. `scheduledAt` kosong/null = kirim sekarang
 * (dispatch secepatnya lewat antrean worker yang sama). Waktu lampau
 * diperlakukan sebagai sekarang — server tidak menolak jam user.
 */
export const ScheduleBroadcastRequestSchema = z.object({
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type ScheduleBroadcastRequest = z.infer<
  typeof ScheduleBroadcastRequestSchema
>;

/**
 * Pratinjau audiens broadcast (Fase 13C — menggantikan estimasi 7C):
 * dihitung dengan KLASIFIKASI YANG SAMA seperti materialisasi
 * penerima saat dispatch (satu fungsi inti di core — tidak ada dua
 * logika), jadi angka pratinjau = angka hasil dispatch untuk audiens
 * dan keadaan yang sama, kecuali perubahan data di antaranya.
 * `totalCandidates` = kontak beridentitas di channel yang cocok
 * filter audiens; `willSend` = yang lolos semua gerbang;
 * sisanya rincian per alasan skip. Jendela 24 jam Meta dievaluasi
 * terhadap waktu pratinjau (bisa bergeser sedikit sampai dispatch).
 */
export const BroadcastAudiencePreviewResponseSchema = z.object({
  totalCandidates: z.number().int().nonnegative(),
  willSend: z.number().int().nonnegative(),
  skippedOptedOut: z.number().int().nonnegative(),
  skippedNotOptedIn: z.number().int().nonnegative(),
  skippedOutside24hWindow: z.number().int().nonnegative(),
  skippedMissingPhoneNumber: z.number().int().nonnegative(),
  skippedTemplateVariableMissing: z.number().int().nonnegative(),
});
export type BroadcastAudiencePreviewResponse = z.infer<
  typeof BroadcastAudiencePreviewResponseSchema
>;

export const BroadcastAudiencePreviewQuerySchema = z.object({
  channelAccountId: z.string().uuid(),
  /** Daftar tag terpisah koma (mengikuti pola query daftar kontak). */
  tags: z.string().max(1024).optional(),
  stages: z.string().max(1024).optional(),
  /** Mode audiens segmen (Fase 13C): id segmen milik tenant. */
  segmentId: z.string().uuid().optional(),
  /** Gerbang opt-in yang akan dipakai broadcast ("true"/"false"). */
  requireOptIn: z.enum(["true", "false"]).optional(),
  /** Template WhatsApp terpilih — untuk klasifikasi variabel (Fase 13C). */
  whatsappTemplateId: z.string().uuid().optional(),
  /** Sumber variabel template terpisah koma, sejajar posisi template. */
  templateVariableSources: z.string().max(2048).optional(),
});
export type BroadcastAudiencePreviewQuery = z.infer<
  typeof BroadcastAudiencePreviewQuerySchema
>;

export const BroadcastRecipientResponseSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string(),
  conversationId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  status: BroadcastRecipientStatusSchema,
  /**
   * Varian uji A/B penerima (Fase 13D): "a" untuk semua penerima
   * broadcast tanpa A/B; penugasan deterministik per
   * (broadcast, kontak) dan tidak berubah pada materialisasi ulang.
   */
  variant: z.enum(["a", "b"]),
  skipReason: BroadcastSkipReasonSchema.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BroadcastRecipientResponse = z.infer<
  typeof BroadcastRecipientResponseSchema
>;

export const BroadcastRecipientListResponseSchema = z.object({
  recipients: z.array(BroadcastRecipientResponseSchema),
  nextCursor: z.string().nullable(),
});
export type BroadcastRecipientListResponse = z.infer<
  typeof BroadcastRecipientListResponseSchema
>;

export const BroadcastRecipientListQuerySchema = z.object({
  status: BroadcastRecipientStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type BroadcastRecipientListQuery = z.infer<
  typeof BroadcastRecipientListQuerySchema
>;

/**
 * Konfigurasi uji A/B broadcast sebagaimana tersimpan (gema untuk
 * formulir edit + panel hasil). `null` pada respons hasil = broadcast
 * tanpa A/B. Untuk WhatsApp `variantBMessageText` adalah snapshot
 * BODY template B; untuk provider teks ia isi pesan B itu sendiri.
 */
export const BroadcastAbConfigSchema = z.object({
  splitPercentB: z.number().int().min(1).max(99),
  variantBMessageText: z.string().nullable(),
  variantBWhatsappTemplateId: z.string().uuid().nullable(),
  variantBTemplateVariableSources: z.array(z.string()),
});
export type BroadcastAbConfig = z.infer<typeof BroadcastAbConfigSchema>;

/** Rincian alasan skip per varian — alasan 13C dipertahankan utuh. */
export const BroadcastVariantSkipReasonsSchema = z.object({
  opted_out: z.number().int().nonnegative(),
  not_opted_in: z.number().int().nonnegative(),
  outside_24h_window: z.number().int().nonnegative(),
  template_variable_missing: z.number().int().nonnegative(),
  missing_phone_number: z.number().int().nonnegative(),
  message_deleted: z.number().int().nonnegative(),
});
export type BroadcastVariantSkipReasons = z.infer<
  typeof BroadcastVariantSkipReasonsSchema
>;

/**
 * Statistik satu varian broadcast — SELALU dihitung server dari
 * broadcast_recipients (sumber kebenaran yang sama seperti statistik
 * broadcast keseluruhan). `assigned` = semua baris penerima varian
 * ini (termasuk yang skipped). TANPA putusan pemenang: broadcast
 * tidak punya metrik hasil per penerima yang sebanding antar varian
 * (atribusi balasan sengaja tidak ditebak — lihat matriks cakupan).
 */
export const BroadcastVariantStatsSchema = z.object({
  variant: z.enum(["a", "b"]),
  assigned: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  skippedByReason: BroadcastVariantSkipReasonsSchema,
});
export type BroadcastVariantStats = z.infer<typeof BroadcastVariantStatsSchema>;

/** Respons GET /tenants/:tenantId/broadcasts/:id/ab-results (dashboard). */
export const BroadcastAbResultsResponseSchema = z.object({
  broadcastId: z.string().uuid(),
  abTest: BroadcastAbConfigSchema.nullable(),
  variants: z.array(BroadcastVariantStatsSchema),
});
export type BroadcastAbResultsResponse = z.infer<
  typeof BroadcastAbResultsResponseSchema
>;

// ---------------------------------------------------------------------------
// Fase 10A — Template WhatsApp (cermin lokal template resmi Meta)
// ---------------------------------------------------------------------------

/** Kategori template Meta. */
export const WhatsAppTemplateCategorySchema = z.enum([
  "UTILITY",
  "MARKETING",
  "AUTHENTICATION",
]);
export type WhatsAppTemplateCategory = z.infer<
  typeof WhatsAppTemplateCategorySchema
>;

/**
 * Status persetujuan Meta sebagaimana terakhir disinkronkan. Nilai di
 * luar tiga status utama diteruskan apa adanya (varchar di cermin) —
 * skema membatasi pada yang dikenal agar UI punya chip yang pasti;
 * status asing dari Meta jatuh ke string mentahnya lewat validasi
 * longgar di serializer (lihat routes).
 */
export const WhatsAppTemplateStatusSchema = z.enum([
  "APPROVED",
  "PENDING",
  "REJECTED",
]);
export type WhatsAppTemplateStatus = z.infer<
  typeof WhatsAppTemplateStatusSchema
>;

/** Satu tombol template sederhana (URL / QUICK_REPLY) untuk formulir buat. */
export const WhatsAppTemplateButtonSchema = z.object({
  type: z.enum(["URL", "QUICK_REPLY"]),
  text: z.string().min(1).max(25),
  /** Wajib untuk tombol URL (maks 2000 mengikuti batas Meta). */
  url: z.string().url().max(2000).optional(),
});
export type WhatsAppTemplateButton = z.infer<
  typeof WhatsAppTemplateButtonSchema
>;

/**
 * Satu baris cermin template. `components` adalah komponen Meta apa
 * adanya (array objek bebas) — bentuk tampilan diturunkan dari
 * `bodyText` + `variableCount` yang dihitung server.
 */
export const WhatsAppTemplateResponseSchema = z.object({
  id: z.string().uuid(),
  channelAccountId: z.string().uuid(),
  metaTemplateId: z.string().nullable(),
  name: z.string(),
  language: z.string(),
  category: z.string(),
  status: z.string(),
  components: z.array(z.record(z.string(), z.unknown())),
  bodyText: z.string().nullable(),
  variableCount: z.number().int().nonnegative(),
  syncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WhatsAppTemplateResponse = z.infer<
  typeof WhatsAppTemplateResponseSchema
>;

export const WhatsAppTemplateListResponseSchema = z.object({
  templates: z.array(WhatsAppTemplateResponseSchema),
});
export type WhatsAppTemplateListResponse = z.infer<
  typeof WhatsAppTemplateListResponseSchema
>;

export const WhatsAppTemplateListQuerySchema = z.object({
  channelAccountId: z.string().uuid(),
});
export type WhatsAppTemplateListQuery = z.infer<
  typeof WhatsAppTemplateListQuerySchema
>;

/** Sinkronisasi cermin dari Meta untuk satu akun WhatsApp. */
export const SyncWhatsAppTemplatesRequestSchema = z.object({
  channelAccountId: z.string().uuid(),
});
export type SyncWhatsAppTemplatesRequest = z.infer<
  typeof SyncWhatsAppTemplatesRequestSchema
>;

export const SyncWhatsAppTemplatesResponseSchema = z.object({
  /** Jumlah template yang kini tercermin untuk akun (sesudah sinkron). */
  synced: z.number().int().nonnegative(),
  templates: z.array(WhatsAppTemplateResponseSchema),
});
export type SyncWhatsAppTemplatesResponse = z.infer<
  typeof SyncWhatsAppTemplatesResponseSchema
>;

/**
 * Buat template baru (diteruskan ke Meta `POST /{waba-id}/message_templates`).
 * Bentuk formulir sederhana v1: HEADER teks polos opsional (tanpa
 * variabel), BODY wajib (variabel {{n}} wajib disertai contoh di
 * `bodyExamples` agar lolos tinjauan Meta), FOOTER opsional, tombol
 * URL/QUICK_REPLY sederhana (maks 3). Nama mengikuti aturan Meta:
 * huruf kecil, angka, garis bawah.
 */
export const CreateWhatsAppTemplateRequestSchema = z.object({
  channelAccountId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "template name must be lowercase letters, digits and underscores"),
  language: z.string().min(2).max(32),
  category: WhatsAppTemplateCategorySchema,
  headerText: z.string().min(1).max(60).optional(),
  bodyText: z.string().min(1).max(1024),
  /** Contoh nilai variabel BODY secara berurutan ({{1}}, {{2}}, …). */
  bodyExamples: z.array(z.string().min(1).max(200)).max(25).optional(),
  footerText: z.string().min(1).max(60).optional(),
  buttons: z.array(WhatsAppTemplateButtonSchema).max(3).optional(),
});
export type CreateWhatsAppTemplateRequest = z.infer<
  typeof CreateWhatsAppTemplateRequestSchema
>;

// ---------------------------------------------------------------------------
// Fase 8A — Flow Engine
// ---------------------------------------------------------------------------

/**
 * FORMAT GRAF FLOW — kontrak sumber kebenaran (dipakai API, eksekutor
 * worker, dan Flow Builder UI Fase 8B):
 *
 *   graph = { nodes: FlowNode[], edges: FlowEdge[] }
 *   FlowNode = { id: string, type: FlowNodeType, config: object,
 *                position?: { x: number, y: number } }
 *   FlowEdge = { from: nodeId, to: nodeId,
 *                branch?: "yes" | "no" | "a" | "b" | "replied" |
 *                         "timeout" }
 *
 * `position` adalah metadata TAMPILAN milik builder (Fase 8B): disimpan
 * apa adanya di graf yang sama (satu sumber kebenaran), diterima
 * validasi bentuk, dan DIABAIKAN eksekutor — flow 8A tanpa position
 * tetap sah dan berjalan persis sama.
 *
 * Tepat SATU node `trigger` per flow; eksekusi mulai dari node yang
 * ditunjuk edge keluar trigger. Node tanpa edge keluar = akhir run
 * (node `end` adalah penanda eksplisit untuk hal yang sama). Edge
 * `branch` hanya sah keluar dari node bercabang, dan himpunan cabang
 * yang wajib lengkap ditegakkan saat aktivasi (bukan di skema bentuk):
 * `condition` → "yes"+"no", `ab_split` → "a"+"b",
 * `wait_reply` → "replied"+"timeout". Node lain tidak boleh membawa
 * branch.
 *
 * Tipe node v1 dan config-nya:
 * - trigger       { kind: "keyword", keywords: string[], match:
 *                   "exact"|"contains" } | { kind: "any_message" }
 * - send_message  { text } — teks keluar `queued`, variabel {name}.
 * - condition     { predicate: "has_tag", tag }
 *                 | { predicate: "stage_equals", stage }
 *                 | { predicate: "field_equals", field:
 *                   "name"|"phone"|"email", value }
 *                 | { predicate: "message_contains", text } — memakai
 *                   teks pesan pemicu run.
 * - delay         { amount: int ≥ 0, unit: "seconds"|"minutes"|"hours",
 *                   random?: { min: int, max: int } } — Smart Delay
 *                   (Fase 9A): bila `random` ada, durasi dipilih acak
 *                   bilangan bulat dalam [min, max] pada satuan node
 *                   yang sama dan `amount` diabaikan; min ≥ 1,
 *                   min ≤ max (ditegakkan validasi aktivasi).
 * - add_tag       { tag }    remove_tag { tag }    set_stage { stage }
 * - enroll_sequence { automationId } — sequence AKTIF milik tenant
 *                   yang sama (divalidasi saat aktivasi & eksekusi).
 * - ai_response   {} — memanggil jalur agent.respond yang ada.
 * - handoff       {} — agent_enabled=false pada percakapan + audit.
 * - end           {}
 *
 * Tipe node tambahan (Fase 12A):
 * - set_field     { field, value } — field: "name"|"phone"|"email"|
 *                   "custom:<key>"; value dirender persis seperti
 *                   send_message ({name} + spintax) lalu ditulis ke
 *                   kontak run (kolom atau custom_fields); terlihat
 *                   oleh condition field_equals pada langkah berikutnya.
 * - http_request  { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", url,
 *                   headers?: { [nama]: nilai }, body?: string,
 *                   saveToField?: "custom:<key>" } — permintaan HTTP
 *                   dari worker dengan timeout 10 detik. Substitusi
 *                   variabel pada url/headers/body SENGAJA SEMPIT dan
 *                   TANPA spintax: hanya `{name}` (nama kontak) dan
 *                   `{{field:<key>}}` (nilai contacts.custom_fields).
 *                   Status + potongan respons dicatat di detail
 *                   langkah; saveToField menyimpan body respons
 *                   (terpotong 2000 char) HANYA bila status 2xx.
 *                   Kegagalan jaringan/non-2xx tercatat sebagai langkah
 *                   gagal di detail tetapi RUN TERUS ke node berikutnya
 *                   (keputusan desain 12A — webhook pihak ketiga yang
 *                   mati tidak boleh membunuh percakapan).
 * - goto_flow     { flowId } — memulai run BARU pada flow tujuan
 *                   (harus ACTIVE, tenant sama; flow itu sendiri sah
 *                   sebagai tujuan) untuk kontak/percakapan yang sama;
 *                   run asal selesai `completed` dengan detail goto.
 *                   Kedalaman rantai dibawa di context run
 *                   (`gotoDepth`, mulai 0); goto yang akan membuat
 *                   kedalaman > 5 GAGAL: langkah `goto_depth_exceeded`,
 *                   run asal `failed`. Run goto TIDAK lahir dari pesan
 *                   masuk sehingga `triggerMessageId`-nya null (konteks
 *                   menyimpan `rootTriggerMessageId` untuk node yang
 *                   membutuhkannya, mis. ai_response).
 * - ab_split      { percentA: int 1..99 } — cabang edge "a"/"b";
 *                   pilihan acak per run dicatat di detail langkah.
 *                   Mode EKSPERIMEN (Fase 13D): config tambahan
 *                   opsional { experiment: true, experimentLabel?,
 *                   conversionNodeId? } — penugasan menjadi
 *                   DETERMINISTIK per (flow, node, kontak) dari hash
 *                   stabil yang dibucket oleh percentA dan dicatat
 *                   SATU KALI di flow_experiment_assignments
 *                   (penugasan pertama menang selamanya, jadi kontak
 *                   selalu masuk varian yang sama di semua run).
 *                   conversionNodeId menamai SATU node lain di graf
 *                   yang sama sebagai titik konversi: run yang
 *                   langkahnya melewati node itu (langkah sukses
 *                   SESUDAH langkah split) terhitung terkonversi
 *                   untuk variannya. Tanpa experiment:true perilaku
 *                   tetap persis acak per run (12A). Hasil eksperimen
 *                   (per varian + uji dua-proporsi) hanya permukaan
 *                   dashboard — tidak ada rute v1/SDK/MCP.
 * - send_payment_link { productId } — memakai layanan payment link
 *                   yang sama dengan tool agent (link SIMULASI
 *                   berlabel) lalu mengirimkannya sebagai pesan keluar
 *                   pada percakapan run. Produk tak ditemukan/arsip:
 *                   langkah gagal tercatat, run `failed`
 *                   (payment_product_unavailable) — kegagalan keras,
 *                   karena mengirim link yang salah/ tidak ada lebih
 *                   buruk daripada menghentikan run.
 * - wait_reply    { amount: int ≥ 0, unit } — run parkir `waiting`
 *                   PADA node ini (seperti delay, tetapi menunggu
 *                   balasan): pesan masuk berikutnya dari kontak pada
 *                   percakapan itu melanjutkan run lewat branch
 *                   "replied"; tenggat lewat tanpa balasan → job
 *                   resume menjalankan branch "timeout". Pesan yang
 *                   melanjutkan wait_reply TETAP diproses pemicu lain
 *                   seperti biasa (keyword/sequence/flow lain boleh
 *                   ikut menembak — tidak ada penekanan ganda selain
 *                   bahwa run yang sama tidak dilanjutkan dua kali).
 *                   Satu pesan masuk melanjutkan SEMUA run wait_reply
 *                   yang parkir di percakapan itu. Opt-out membatalkan
 *                   run parkir seperti delay.
 */
export const FlowStatusSchema = z.enum(["draft", "active", "archived"]);
export type FlowStatus = z.infer<typeof FlowStatusSchema>;

export const FlowRunStatusSchema = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type FlowRunStatus = z.infer<typeof FlowRunStatusSchema>;

export const FlowNodeTypeSchema = z.enum([
  "trigger",
  "send_message",
  "condition",
  "delay",
  "add_tag",
  "remove_tag",
  "set_stage",
  "enroll_sequence",
  "ai_response",
  "handoff",
  "end",
  // Fase 12A
  "set_field",
  "http_request",
  "goto_flow",
  "ab_split",
  "send_payment_link",
  "wait_reply",
]);
export type FlowNodeType = z.infer<typeof FlowNodeTypeSchema>;

export const FlowTriggerConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("keyword"),
    keywords: z.array(z.string().min(1).max(128)).max(20),
    match: z.enum(["exact", "contains"]),
  }),
  z.object({ kind: z.literal("any_message") }),
]);
export type FlowTriggerConfig = z.infer<typeof FlowTriggerConfigSchema>;

export const FlowConditionConfigSchema = z.discriminatedUnion("predicate", [
  z.object({ predicate: z.literal("has_tag"), tag: z.string().min(1).max(64) }),
  z.object({
    predicate: z.literal("stage_equals"),
    stage: z.string().min(1).max(64),
  }),
  z.object({
    predicate: z.literal("field_equals"),
    field: z.enum(["name", "phone", "email"]),
    value: z.string().min(1).max(255),
  }),
  z.object({
    predicate: z.literal("message_contains"),
    text: z.string().min(1).max(255),
  }),
]);
export type FlowConditionConfig = z.infer<typeof FlowConditionConfigSchema>;

export const FlowNodeConfigSchema = z.union([
  FlowTriggerConfigSchema,
  z.object({ text: z.string().min(1).max(4096) }),
  FlowConditionConfigSchema,
  z.object({
    amount: z.number().int().min(0).max(100_000),
    unit: z.enum(["seconds", "minutes", "hours"]),
    // Smart Delay (Fase 9A): rentang acak opsional dalam satuan yang
    // sama; keabsahan rentang (min ≥ 1, min ≤ max) ditegakkan validasi
    // aktivasi di core, bukan di skema bentuk ini.
    random: z
      .object({
        min: z.number().int(),
        max: z.number().int(),
      })
      .optional(),
  }),
  z.object({ tag: z.string().min(1).max(64) }),
  z.object({ stage: z.string().min(1).max(64) }),
  z.object({ automationId: z.string().uuid() }),
  // Fase 12A — bentuk kasar; keabsahan rinci (rentang persen, rujukan
  // flow/produk aktif, format field) ditegakkan validasi aktivasi.
  z.object({
    field: z.string().min(1).max(128),
    value: z.string().max(4096),
  }),
  z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().min(1).max(2048),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(8192).optional(),
    saveToField: z.string().min(1).max(128).optional(),
  }),
  z.object({ flowId: z.string().uuid() }),
  z.object({
    percentA: z.number().int().min(1).max(99),
    // Fase 13D — mode eksperimen (semua opsional; tanpa
    // experiment:true node berperilaku persis 12A). Keabsahan rinci
    // (conversionNodeId harus menunjuk node yang ada di graf yang
    // sama) ditegakkan validasi aktivasi di core.
    experiment: z.boolean().optional(),
    experimentLabel: z.string().min(1).max(128).optional(),
    conversionNodeId: z.string().min(1).max(128).optional(),
  }),
  z.object({ productId: z.string().uuid() }),
  z.object({
    amount: z.number().int().min(0).max(100_000),
    unit: z.enum(["seconds", "minutes", "hours"]),
  }),
  // ai_response / handoff / end: config kosong.
  z.object({}),
]);
export type FlowNodeConfig = z.infer<typeof FlowNodeConfigSchema>;

/**
 * Posisi node di canvas builder (Fase 8B) — koordinat piksel relatif
 * kanvas, boleh negatif (pan bebas). Murni metadata tampilan.
 */
export const FlowNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type FlowNodePosition = z.infer<typeof FlowNodePositionSchema>;

export const FlowNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: FlowNodeTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  position: FlowNodePositionSchema.optional(),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

/** Cabang edge: condition yes/no, ab_split a/b, wait_reply replied/timeout. */
export const FlowEdgeBranchSchema = z.enum([
  "yes",
  "no",
  "a",
  "b",
  "replied",
  "timeout",
]);
export type FlowEdgeBranch = z.infer<typeof FlowEdgeBranchSchema>;

export const FlowEdgeSchema = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  branch: FlowEdgeBranchSchema.optional(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowGraphSchema = z.object({
  nodes: z.array(FlowNodeSchema).max(200),
  edges: z.array(FlowEdgeSchema).max(400),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

/** Satu masalah validasi graf (aktivasi) — kode stabil + konteks. */
export const FlowGraphIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  nodeId: z.string().nullable(),
  message: z.string(),
});
export type FlowGraphIssue = z.infer<typeof FlowGraphIssueSchema>;

export const FlowResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: FlowStatusSchema,
  graph: FlowGraphSchema,
  runCount: z.number().int().nonnegative(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FlowResponse = z.infer<typeof FlowResponseSchema>;

export const FlowListResponseSchema = z.object({
  flows: z.array(FlowResponseSchema),
  nextCursor: z.string().nullable(),
});
export type FlowListResponse = z.infer<typeof FlowListResponseSchema>;

export const FlowListQuerySchema = z.object({
  status: FlowStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type FlowListQuery = z.infer<typeof FlowListQuerySchema>;

export const CreateFlowRequestSchema = z.object({
  name: z.string().min(1).max(255),
  graph: FlowGraphSchema.optional(),
});
export type CreateFlowRequest = z.infer<typeof CreateFlowRequestSchema>;

/**
 * Edit hanya sah selama flow masih `draft` (mengubah graf flow aktif
 * di tengah jalan akan mengubah arti run yang sedang berjalan — flow
 * aktif harus dinonaktifkan dulu, yang mengembalikannya ke draft).
 */
export const UpdateFlowRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  graph: FlowGraphSchema.optional(),
});
export type UpdateFlowRequest = z.infer<typeof UpdateFlowRequestSchema>;

/** Hasil validasi graf (respons aktivasi yang gagal maupun endpoint validasi). */
export const FlowValidationResponseSchema = z.object({
  valid: z.boolean(),
  issues: z.array(FlowGraphIssueSchema),
});
export type FlowValidationResponse = z.infer<
  typeof FlowValidationResponseSchema
>;

export const FlowRunResponseSchema = z.object({
  id: z.string().uuid(),
  flowId: z.string().uuid(),
  conversationId: z.string().uuid(),
  contactId: z.string().uuid(),
  contactName: z.string(),
  // Null untuk run yang lahir dari goto_flow (Fase 12A) — run semacam
  // itu tidak dipicu pesan masuk.
  triggerMessageId: z.string().uuid().nullable(),
  status: FlowRunStatusSchema,
  currentNodeId: z.string().nullable(),
  stepCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FlowRunResponse = z.infer<typeof FlowRunResponseSchema>;

export const FlowRunListResponseSchema = z.object({
  runs: z.array(FlowRunResponseSchema),
  nextCursor: z.string().nullable(),
});
export type FlowRunListResponse = z.infer<typeof FlowRunListResponseSchema>;

export const FlowRunListQuerySchema = z.object({
  status: FlowRunStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type FlowRunListQuery = z.infer<typeof FlowRunListQuerySchema>;

export const FlowRunStepResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  seq: z.number().int().positive(),
  nodeId: z.string(),
  nodeType: z.string(),
  detail: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type FlowRunStepResponse = z.infer<typeof FlowRunStepResponseSchema>;

export const FlowRunStepListResponseSchema = z.object({
  steps: z.array(FlowRunStepResponseSchema),
  nextCursor: z.string().nullable(),
});
export type FlowRunStepListResponse = z.infer<
  typeof FlowRunStepListResponseSchema
>;

export const FlowRunStepListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type FlowRunStepListQuery = z.infer<typeof FlowRunStepListQuerySchema>;

// ---------------------------------------------------------------------------
// Fase 13D — Eksperimen A/B (hasil). PERMUKAAN DASHBOARD SAJA:
// skema-skema di bawah dipakai endpoint dashboard
// GET /tenants/:tenantId/flows/:id/experiments dan
// GET /tenants/:tenantId/broadcasts/:id/ab-results. SENGAJA tidak ada
// rute v1 / scope / SDK / MCP untuk hasil eksperimen (artefak
// kurasi builder & pelaporan operator — preseden yang sama seperti
// flow & broadcast itu sendiri di matriks cakupan 15A).
// ---------------------------------------------------------------------------

/** Statistik satu varian eksperimen flow (per node ab_split). */
export const FlowExperimentVariantStatsSchema = z.object({
  branch: z.enum(["a", "b"]),
  /** Kontak unik yang pernah ditugaskan ke varian ini. */
  assignedContacts: z.number().int().nonnegative(),
  /** Run yang melewati node split dan masuk varian ini. */
  runs: z.number().int().nonnegative(),
  /** Run di atas yang berakhir `completed`. */
  completedRuns: z.number().int().nonnegative(),
  /**
   * Run yang langkah suksesnya melewati node konversi SESUDAH
   * langkah split (hanya bermakna bila conversionNodeId diisi;
   * tanpa titik konversi selalu 0 dan conversionRate null).
   */
  conversions: z.number().int().nonnegative(),
  /** conversions / runs; null bila runs = 0 atau tanpa titik konversi. */
  conversionRate: z.number().min(0).max(1).nullable(),
});
export type FlowExperimentVariantStats = z.infer<
  typeof FlowExperimentVariantStatsSchema
>;

/**
 * Putusan statistik hasil eksperimen — KEJUJURAN STATISTIK (pola
 * kejujuran biaya 9B): petunjuk pemenang HANYA muncul bila uji
 * dua-proporsi (z-test pooled, dua sisi) atas tingkat konversi
 * menghasilkan p < 0.05 DAN kedua varian mencapai sampel minimum;
 * nilai z dan p selalu dikirim agar bisa ditampilkan apa adanya.
 */
export const FlowExperimentVerdictSchema = z.object({
  status: z.enum([
    "not_enough_data",
    "no_significant_difference",
    "winner",
  ]),
  /** Cabang pemenang; hanya terisi saat status = "winner". */
  winnerBranch: z.enum(["a", "b"]).nullable(),
  /** Statistik z uji dua-proporsi; null bila belum dihitung. */
  z: z.number().nullable(),
  /** Nilai p dua sisi; null bila belum dihitung. */
  pValue: z.number().min(0).max(1).nullable(),
  /** Sampel minimum (run per varian) sebelum putusan dihitung. */
  minSamplePerVariant: z.number().int().positive(),
});
export type FlowExperimentVerdict = z.infer<typeof FlowExperimentVerdictSchema>;

/** Hasil satu node ab_split mode eksperimen pada satu flow. */
export const FlowExperimentResultSchema = z.object({
  nodeId: z.string(),
  /** Label eksperimen dari config node; null bila tidak diisi. */
  label: z.string().nullable(),
  percentA: z.number().int().min(1).max(99),
  /** Node titik konversi dari config; null bila tidak diisi. */
  conversionNodeId: z.string().nullable(),
  variants: z.array(FlowExperimentVariantStatsSchema),
  verdict: FlowExperimentVerdictSchema,
});
export type FlowExperimentResult = z.infer<typeof FlowExperimentResultSchema>;

export const FlowExperimentsResponseSchema = z.object({
  flowId: z.string().uuid(),
  experiments: z.array(FlowExperimentResultSchema),
});
export type FlowExperimentsResponse = z.infer<
  typeof FlowExperimentsResponseSchema
>;

// ---------------------------------------------------------------------------
// Fase 12B — Galeri Template Flow
// ---------------------------------------------------------------------------

/**
 * KATALOG TEMPLATE FLOW — definisi statis di kontrak sebagai sumber
 * kebenaran bersama (API daftar/instantiate; builder menerimanya lewat
 * API). Template adalah graf LENGKAP (termasuk `position` builder)
 * yang disalin apa adanya saat instantiate; id node diregenerasi di
 * server agar dua hasil instantiate tidak pernah bertabrakan.
 *
 * `nameKey`/`descriptionKey` adalah kunci i18n (paket i18n) — nama &
 * deskripsi katalog dwibahasa tanpa string katalog ter-hardcode di
 * klien. `defaultName` adalah nama flow bawaan BAHASA INDONESIA yang
 * dipakai API bila klien tidak mengirim nama (nama flow adalah data
 * pengguna; klien web mengirim nama dari terjemahan sesuai locale).
 *
 * Teks node di dalam graf ditulis dalam Bahasa Indonesia yang netral
 * (audiens utama kreator Indonesia); graf memang hanya menyimpan SATU
 * teks per node — pemilik flow mengeditnya di builder.
 *
 * `needs` = daftar hal yang WAJIB dilengkapi pemilik sebelum flow bisa
 * diaktifkan. Satu-satunya nilai v1: "product" — node
 * `send_payment_link` pada template sengaja membawa `productId`
 * KOSONG (placeholder): aktivasi menolaknya dengan issue
 * PAYMENT_PRODUCT_ID_REQUIRED yang menunjuk node itu sampai pemilik
 * memilih produk aslinya di builder.
 */
export const FlowTemplateCategorySchema = z.enum([
  "onboarding",
  "sales",
  "support",
  "event",
  "lead",
]);
export type FlowTemplateCategory = z.infer<typeof FlowTemplateCategorySchema>;

export const FlowTemplateNeedSchema = z.enum(["product"]);
export type FlowTemplateNeed = z.infer<typeof FlowTemplateNeedSchema>;

export interface FlowTemplateDefinition {
  slug: string;
  nameKey: string;
  descriptionKey: string;
  category: FlowTemplateCategory;
  needs: FlowTemplateNeed[];
  defaultName: string;
  graph: FlowGraph;
}

export const FLOW_TEMPLATES: FlowTemplateDefinition[] = [
  {
    slug: "sambutan-tag-minat",
    nameKey: "flows.tplSambutanName",
    descriptionKey: "flows.tplSambutanDesc",
    category: "onboarding",
    needs: [],
    defaultName: "Sambutan + Tag Minat",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: { kind: "any_message" },
          position: { x: 0, y: 0 },
        },
        {
          id: "sambutan",
          type: "send_message",
          config: {
            text: "{Halo|Hai|Halo kak} {name}! Selamat datang — senang bisa menyapa. Saya bantu carikan yang kamu butuhkan ya.",
          },
          position: { x: 290, y: 0 },
        },
        {
          id: "tag",
          type: "add_tag",
          config: { tag: "lead-baru" },
          position: { x: 580, y: 0 },
        },
        {
          id: "tanya",
          type: "send_message",
          config: {
            text: "Boleh tahu, {name} sedang cari apa? Balas saja dengan kata kunci: produk, harga, atau jadwal — nanti saya arahkan.",
          },
          position: { x: 870, y: 0 },
        },
        { id: "end", type: "end", config: {}, position: { x: 1160, y: 0 } },
      ],
      edges: [
        { from: "trigger", to: "sambutan" },
        { from: "sambutan", to: "tag" },
        { from: "tag", to: "tanya" },
        { from: "tanya", to: "end" },
      ],
    },
  },
  {
    slug: "checkout-link-bayar",
    nameKey: "flows.tplCheckoutName",
    descriptionKey: "flows.tplCheckoutDesc",
    category: "sales",
    needs: ["product"],
    defaultName: "Checkout — Kirim Link Bayar",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: {
            kind: "keyword",
            keywords: ["beli", "order", "checkout"],
            match: "contains",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "bayar",
          type: "send_payment_link",
          // Placeholder SENGAJA kosong: pemilik wajib memilih produk
          // asli sebelum aktivasi (lihat `needs`).
          config: { productId: "" },
          position: { x: 290, y: 0 },
        },
        {
          id: "tunggu",
          type: "wait_reply",
          config: { amount: 24, unit: "hours" },
          position: { x: 580, y: 0 },
        },
        { id: "end", type: "end", config: {}, position: { x: 870, y: 0 } },
        {
          id: "ingat",
          type: "send_message",
          config: {
            text: "Halo {name}, pesananmu masih kami simpan. Kalau masih ingin lanjut, cukup balas pesan ini ya — atau abaikan saja bila sudah tidak perlu.",
          },
          position: { x: 870, y: 180 },
        },
      ],
      edges: [
        { from: "trigger", to: "bayar" },
        { from: "bayar", to: "tunggu" },
        { from: "tunggu", to: "end", branch: "replied" },
        { from: "tunggu", to: "ingat", branch: "timeout" },
        { from: "ingat", to: "end" },
      ],
    },
  },
  {
    slug: "tanya-jawab-ai",
    nameKey: "flows.tplTanyaJawabName",
    descriptionKey: "flows.tplTanyaJawabDesc",
    category: "support",
    needs: [],
    defaultName: "Tanya-Jawab AI",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: { kind: "any_message" },
          position: { x: 0, y: 0 },
        },
        {
          id: "ai",
          type: "ai_response",
          config: {},
          position: { x: 290, y: 0 },
        },
        { id: "end", type: "end", config: {}, position: { x: 580, y: 0 } },
      ],
      edges: [
        { from: "trigger", to: "ai" },
        { from: "ai", to: "end" },
      ],
    },
  },
  {
    slug: "pengingat-webinar",
    nameKey: "flows.tplWebinarName",
    descriptionKey: "flows.tplWebinarDesc",
    category: "event",
    needs: [],
    defaultName: "Pengingat Webinar",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: {
            kind: "keyword",
            keywords: ["webinar", "kelas"],
            match: "contains",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "info",
          type: "send_message",
          config: {
            text: "Siap, {name}! Kamu masuk daftar info webinar/kelas kami. Detail acara akan kami kirim di sini — sampai jumpa di kelasnya!",
          },
          position: { x: 290, y: 0 },
        },
        {
          id: "sumber",
          type: "set_field",
          config: { field: "custom:sumber", value: "webinar" },
          position: { x: 580, y: 0 },
        },
        {
          id: "jeda1",
          type: "delay",
          config: { amount: 24, unit: "hours" },
          position: { x: 870, y: 0 },
        },
        {
          id: "ingat",
          type: "send_message",
          config: {
            text: "Pengingat untuk {name}: webinar/kelas kita dimulai besok. Siapkan pertanyaanmu dari sekarang ya.",
          },
          position: { x: 1160, y: 0 },
        },
        {
          id: "jeda2",
          type: "delay",
          config: { amount: 2, unit: "hours" },
          position: { x: 1450, y: 0 },
        },
        {
          id: "rekaman",
          type: "send_message",
          config: {
            text: "Terima kasih sudah ikut, {name}! Ini tautan rekamannya: https://contoh.id/rekaman — silakan ganti dengan tautan aslimu.",
          },
          position: { x: 1740, y: 0 },
        },
        { id: "end", type: "end", config: {}, position: { x: 2030, y: 0 } },
      ],
      edges: [
        { from: "trigger", to: "info" },
        { from: "info", to: "sumber" },
        { from: "sumber", to: "jeda1" },
        { from: "jeda1", to: "ingat" },
        { from: "ingat", to: "jeda2" },
        { from: "jeda2", to: "rekaman" },
        { from: "rekaman", to: "end" },
      ],
    },
  },
  {
    slug: "lead-magnet-ebook",
    nameKey: "flows.tplEbookName",
    descriptionKey: "flows.tplEbookDesc",
    category: "lead",
    needs: [],
    defaultName: "Lead Magnet — Ebook Gratis",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: {
            kind: "keyword",
            keywords: ["ebook", "gratis"],
            match: "contains",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "pembuka",
          type: "send_message",
          config: {
            text: "Halo {name}! Ebook gratisnya sudah siap. Balas MAU untuk menerima tautan unduhnya ya.",
          },
          position: { x: 290, y: 0 },
        },
        {
          id: "tunggu",
          type: "wait_reply",
          config: { amount: 48, unit: "hours" },
          position: { x: 580, y: 0 },
        },
        {
          id: "unduh",
          type: "send_message",
          config: {
            text: "Ini tautan unduh ebook-mu, {name}: https://contoh.id/ebook — selamat membaca! (Ganti tautan ini dengan tautan aslimu.)",
          },
          position: { x: 870, y: 0 },
        },
        {
          id: "tag",
          type: "add_tag",
          config: { tag: "lead-ebook" },
          position: { x: 1160, y: 0 },
        },
        {
          id: "ingat",
          type: "send_message",
          config: {
            text: "Halo {name}, ebook gratisnya masih menunggu lho. Balas MAU kapan saja untuk menerimanya.",
          },
          position: { x: 870, y: 180 },
        },
        { id: "end", type: "end", config: {}, position: { x: 1450, y: 0 } },
      ],
      edges: [
        { from: "trigger", to: "pembuka" },
        { from: "pembuka", to: "tunggu" },
        { from: "tunggu", to: "unduh", branch: "replied" },
        { from: "unduh", to: "tag" },
        { from: "tag", to: "end" },
        { from: "tunggu", to: "ingat", branch: "timeout" },
        { from: "ingat", to: "end" },
      ],
    },
  },
  {
    slug: "eskalasi-admin",
    nameKey: "flows.tplEskalasiName",
    descriptionKey: "flows.tplEskalasiDesc",
    category: "support",
    needs: [],
    defaultName: "Eskalasi ke Admin",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          config: {
            kind: "keyword",
            keywords: ["admin", "manusia", "cs"],
            match: "contains",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "info",
          type: "send_message",
          config: {
            text: "Baik, {name} — saya sambungkan ke admin manusia ya. Mohon tunggu sebentar, admin akan membalas langsung dari sini.",
          },
          position: { x: 290, y: 0 },
        },
        {
          id: "serah",
          type: "handoff",
          config: {},
          position: { x: 580, y: 0 },
        },
        { id: "end", type: "end", config: {}, position: { x: 870, y: 0 } },
      ],
      edges: [
        { from: "trigger", to: "info" },
        { from: "info", to: "serah" },
        { from: "serah", to: "end" },
      ],
    },
  },
];

/** Template menurut slug stabilnya; null bila tidak dikenal. */
export function findFlowTemplate(slug: string): FlowTemplateDefinition | null {
  return FLOW_TEMPLATES.find((tpl) => tpl.slug === slug) ?? null;
}

export const FlowTemplateSummarySchema = z.object({
  slug: z.string(),
  nameKey: z.string(),
  descriptionKey: z.string(),
  category: FlowTemplateCategorySchema,
  nodeCount: z.number().int().positive(),
  needs: z.array(FlowTemplateNeedSchema),
});
export type FlowTemplateSummary = z.infer<typeof FlowTemplateSummarySchema>;

export const FlowTemplateListResponseSchema = z.object({
  templates: z.array(FlowTemplateSummarySchema),
});
export type FlowTemplateListResponse = z.infer<
  typeof FlowTemplateListResponseSchema
>;

export const InstantiateFlowTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
});
export type InstantiateFlowTemplateRequest = z.infer<
  typeof InstantiateFlowTemplateRequestSchema
>;

// ---------------------------------------------------------------------------
// Fase 9A — Saved Replies (macro `/` di composer Inbox)
// ---------------------------------------------------------------------------

/**
 * Satu balasan tersimpan milik workspace. `body` boleh memuat {name};
 * substitusinya dilakukan klien saat penyisipan ke composer (WYSIWYG).
 * `createdByUserId` adalah dasar gerbang edit/hapus di server: hanya
 * pembuat atau owner/admin workspace yang boleh mengubah/menghapus;
 * membaca & membuat boleh semua member.
 */
export const SavedReplyResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedReplyResponse = z.infer<typeof SavedReplyResponseSchema>;

export const SavedReplyListResponseSchema = z.object({
  replies: z.array(SavedReplyResponseSchema),
});
export type SavedReplyListResponse = z.infer<
  typeof SavedReplyListResponseSchema
>;

export const CreateSavedReplyRequestSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(4096),
});
export type CreateSavedReplyRequest = z.infer<
  typeof CreateSavedReplyRequestSchema
>;

/** Edit parsial: minimal satu field (ditegakkan di route). */
export const UpdateSavedReplyRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(4096).optional(),
});
export type UpdateSavedReplyRequest = z.infer<
  typeof UpdateSavedReplyRequestSchema
>;

// ---------------------------------------------------------------------------
// Fase 13B — Growth Tools: tautan publik per channel (/go/:slug),
// halaman arahan pemilih channel, dan analitik per tautan.
//
// Bentuk publik: GET /go/:slug (tanpa autentikasi) mencatat klik lalu
// 302 ke URL platform; picker me-render halaman arahan. Atribusi
// kontak terjadi di jalur inbound (Telegram /start <slug>, referral
// Meta, sesi webchat ?src=) — WhatsApp memang tidak punya jalur
// payload, jadi untuk WA hanya klik yang tercatat (dinyatakan jujur
// di UI). Permukaan v1 untuk sumber daya ini BACA saja
// (growth_links:read); tulis = kurasi UI dashboard (slug publik +
// branding), lihat docs/COVERAGE-MATRIX.md.
// ---------------------------------------------------------------------------

export const GrowthLinkKindSchema = z.enum(["single", "picker"]);
export type GrowthLinkKind = z.infer<typeof GrowthLinkKindSchema>;

/**
 * Slug publik: 3–64 karakter huruf kecil/angka/strip, tidak diawali
 * atau diakhiri strip. Batas 64 juga menjaga payload `/start` Telegram
 * (maks 64 karakter) tetap sah.
 */
export const GrowthLinkSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/,
    "Slug must be 3-64 chars of lowercase letters, digits and hyphens",
  );
export type GrowthLinkSlug = z.infer<typeof GrowthLinkSlugSchema>;

/** Ringkasan akun channel sebagaimana dirujuk tautan growth. */
export const GrowthLinkChannelSummarySchema = z.object({
  id: z.string().uuid(),
  provider: ChannelProviderSchema,
  displayName: z.string().nullable(),
  /** Username Page (messenger) / akun IG / nomor tampil WhatsApp. */
  publicHandle: z.string().nullable(),
  /** Username bot Telegram (tanpa '@'); provider lain null. */
  botUsername: z.string().nullable(),
  status: ChannelAccountStatusSchema,
});
export type GrowthLinkChannelSummary = z.infer<
  typeof GrowthLinkChannelSummarySchema
>;

/** Angka analitik yang DITURUNKAN dari growth_link_events (bukan penghitung tersimpan). */
export const GrowthLinkStatsSchema = z.object({
  clicks: z.number().int(),
  pickerViews: z.number().int(),
  conversions: z.number().int(),
});
export type GrowthLinkStats = z.infer<typeof GrowthLinkStatsSchema>;

export const GrowthLinkResponseSchema = z.object({
  id: z.string().uuid(),
  kind: GrowthLinkKindSchema,
  label: z.string(),
  slug: z.string(),
  /** Path publik tautan ini (origin dashboard + path ini = URL utuh). */
  publicPath: z.string(),
  channelAccountId: z.string().uuid().nullable(),
  /** Akun tujuan untuk kind 'single'; null untuk picker. */
  channel: GrowthLinkChannelSummarySchema.nullable(),
  pickerChannelIds: z.array(z.string().uuid()),
  /** Ringkasan akun picker, urut seperti pickerChannelIds. */
  pickerChannels: z.array(GrowthLinkChannelSummarySchema),
  autoTag: z.string().nullable(),
  prefillText: z.string().nullable(),
  isActive: z.boolean(),
  stats: GrowthLinkStatsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GrowthLinkResponse = z.infer<typeof GrowthLinkResponseSchema>;

export const GrowthLinkListResponseSchema = z.object({
  links: z.array(GrowthLinkResponseSchema),
});
export type GrowthLinkListResponse = z.infer<
  typeof GrowthLinkListResponseSchema
>;

export const CreateGrowthLinkRequestSchema = z.object({
  kind: GrowthLinkKindSchema,
  label: z.string().trim().min(1).max(128),
  /** Kosongkan untuk digenerate server dari label. */
  slug: GrowthLinkSlugSchema.optional(),
  /** Wajib untuk kind 'single' (ditegakkan layanan: 422 bila absen/salah). */
  channelAccountId: z.string().uuid().optional(),
  /** Wajib >= 2 untuk kind 'picker' (ditegakkan layanan). */
  pickerChannelIds: z.array(z.string().uuid()).max(10).optional(),
  autoTag: z.string().trim().min(1).max(64).nullable().optional(),
  prefillText: z.string().trim().min(1).max(1000).nullable().optional(),
});
export type CreateGrowthLinkRequest = z.infer<
  typeof CreateGrowthLinkRequestSchema
>;

/** Edit parsial: hanya field yang disebut yang berubah (route menolak objek kosong). */
export const UpdateGrowthLinkRequestSchema = z.object({
  label: z.string().trim().min(1).max(128).optional(),
  slug: GrowthLinkSlugSchema.optional(),
  channelAccountId: z.string().uuid().optional(),
  pickerChannelIds: z.array(z.string().uuid()).max(10).optional(),
  autoTag: z.string().trim().min(1).max(64).nullable().optional(),
  prefillText: z.string().trim().min(1).max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateGrowthLinkRequest = z.infer<
  typeof UpdateGrowthLinkRequestSchema
>;

/** Satu kontak teratribusi (event conversion terbaru dulu). */
export const GrowthLinkAttributedContactSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string(),
  /** Nilai kolom sumber kontak (mis. "growth:promo"), null bila kontak sudah terhapus sumbernya. */
  source: z.string().nullable(),
  convertedAt: z.string().datetime(),
});
export type GrowthLinkAttributedContact = z.infer<
  typeof GrowthLinkAttributedContactSchema
>;

export const GrowthLinkAttributedContactsResponseSchema = z.object({
  contacts: z.array(GrowthLinkAttributedContactSchema),
});
export type GrowthLinkAttributedContactsResponse = z.infer<
  typeof GrowthLinkAttributedContactsResponseSchema
>;

// ---------------------------------------------------------------------------
// Fase 13C — Segmentasi audiens & pengaturan opt-in broadcast.
//
// Segmen = definisi kondisi bernama atas kontak tenant, dievaluasi
// SATU evaluator di core untuk tiga konsumen: filter daftar kontak,
// pratinjau audiens broadcast, dan materialisasi penerima broadcast.
// Permukaan v1 untuk segmen BACA saja (segments:read); tulis =
// dashboard-only (artefak kurasi UI + definisi kompleks — lihat
// docs/COVERAGE-MATRIX.md). Pengaturan opt-in adalah permukaan
// dashboard saja (konfigurasi tenant, bukan sumber daya integrasi).
// ---------------------------------------------------------------------------

/**
 * Satu kondisi segmen. `last_active_within_days` memakai definisi
 * aktivitas: waktu pesan MASUK terakhir kontak di semua percakapan
 * 1:1-nya; bila kontak belum pernah mengirim pesan, jatuh ke
 * `updated_at` percakapan 1:1 terbarunya; kontak tanpa percakapan
 * sama sekali tidak pernah "aktif".
 */
export const SegmentConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tag"),
    tag: z.string().trim().min(1).max(64),
  }),
  z.object({
    type: z.literal("stage"),
    stage: z.string().trim().min(1).max(64),
  }),
  z.object({
    type: z.literal("source_prefix"),
    prefix: z.string().trim().min(1).max(128),
  }),
  z.object({
    type: z.literal("opt_in_status"),
    status: EffectiveOptInStatusSchema,
  }),
  z.object({
    type: z.literal("custom_field"),
    key: z.string().trim().min(1).max(64),
    op: z.enum(["eq", "contains"]),
    value: z.string().max(1000),
  }),
  z.object({
    type: z.literal("created_within_days"),
    days: z.number().int().min(1).max(3650),
  }),
  z.object({
    type: z.literal("last_active_within_days"),
    days: z.number().int().min(1).max(3650),
  }),
  z.object({
    type: z.literal("has_channel"),
    provider: ChannelProviderSchema,
  }),
]);
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;

export const SegmentDefinitionSchema = z.object({
  /** "all" = semua kondisi harus cocok (AND); "any" = salah satu (OR). */
  match: z.enum(["all", "any"]),
  conditions: z.array(SegmentConditionSchema).min(1).max(20),
});
export type SegmentDefinition = z.infer<typeof SegmentDefinitionSchema>;

export const SegmentResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  definition: SegmentDefinitionSchema,
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SegmentResponse = z.infer<typeof SegmentResponseSchema>;

export const SegmentListResponseSchema = z.object({
  segments: z.array(SegmentResponseSchema),
});
export type SegmentListResponse = z.infer<typeof SegmentListResponseSchema>;

export const CreateSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  definition: SegmentDefinitionSchema,
});
export type CreateSegmentRequest = z.infer<typeof CreateSegmentRequestSchema>;

export const UpdateSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  definition: SegmentDefinitionSchema.optional(),
});
export type UpdateSegmentRequest = z.infer<typeof UpdateSegmentRequestSchema>;

/** Pratinjau hitungan anggota untuk definisi (tersimpan atau draf). */
export const SegmentPreviewRequestSchema = z.object({
  definition: SegmentDefinitionSchema,
});
export type SegmentPreviewRequest = z.infer<
  typeof SegmentPreviewRequestSchema
>;

export const SegmentPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type SegmentPreviewResponse = z.infer<
  typeof SegmentPreviewResponseSchema
>;

/**
 * Pengaturan mesin opt-in per tenant (Fase 13C). `defaultOptOutKeywords`
 * adalah kata bawaan sistem (konstanta core, hanya-baca di UI);
 * `optOutExtraKeywords` adalah tambahan tenant yang digabung di atasnya.
 */
export const OptInSettingsResponseSchema = z.object({
  optInKeywords: z.array(z.string()),
  /** Teks konfirmasi opt-in; null = opt-in diam (tanpa balasan). */
  optInConfirmationText: z.string().nullable(),
  optOutExtraKeywords: z.array(z.string()),
  defaultOptOutKeywords: z.array(z.string()),
});
export type OptInSettingsResponse = z.infer<
  typeof OptInSettingsResponseSchema
>;

export const UpdateOptInSettingsRequestSchema = z.object({
  optInKeywords: z
    .array(z.string().trim().min(1).max(64))
    .max(20)
    .optional(),
  optInConfirmationText: z.string().trim().max(1000).nullable().optional(),
  optOutExtraKeywords: z
    .array(z.string().trim().min(1).max(64))
    .max(20)
    .optional(),
});
export type UpdateOptInSettingsRequest = z.infer<
  typeof UpdateOptInSettingsRequestSchema
>;

// ---------------------------------------------------------------------------
// Fase 15A — Permukaan publik v1: query tambahan + REGISTRY permukaan.
//
// Aturan sinkronisasi kontrak (keputusan user 2026-11-02 22:10):
// packages/contracts adalah sumber kebenaran tunggal; setiap kemampuan
// yang masuk permukaan publik WAJIB punya pemetaan kontrak → API v1 →
// SDK → MCP dalam fase yang sama. PUBLIC_V1_SURFACE di bawah adalah
// registry pemetaan itu — satu entri per rute publik. Skrip
// `check:drift` (packages/sdk/scripts/check-drift.ts, jalankan
// `pnpm check:drift`) memeriksa registry ini terhadap implementasi
// nyata (rute di modul public-v1, metode SDK, tool MCP) dan GAGAL
// bila ada rute publik tanpa pemetaan atau pemetaan yang menunjuk
// nama yang tidak ada. Matriks cakupan lengkap (termasuk permukaan
// dashboard-only yang disengaja) hidup di docs/COVERAGE-MATRIX.md.
//
// Seksi ini sengaja di AKHIR file: skema query broadcast/flow merujuk
// skema status yang didefinisikan di seksi sumber dayanya masing-masing.
// ---------------------------------------------------------------------------

/** Query daftar broadcast API publik /v1 (Fase 15A) — paginasi kursor seperti dashboard. */
export const V1ListBroadcastsQuerySchema = z.object({
  status: BroadcastStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListBroadcastsQuery = z.infer<typeof V1ListBroadcastsQuerySchema>;

/** Query daftar flow API publik /v1 (Fase 15A) — paginasi kursor seperti dashboard. */
export const V1ListFlowsQuerySchema = z.object({
  status: FlowStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListFlowsQuery = z.infer<typeof V1ListFlowsQuerySchema>;

/** Query daftar template WhatsApp API publik /v1 (Fase 15A) — cermin selalu per akun channel. */
export const V1ListWhatsAppTemplatesQuerySchema = z.object({
  channelAccountId: z.string().uuid(),
});
export type ListWhatsAppTemplatesQuery = z.infer<
  typeof V1ListWhatsAppTemplatesQuerySchema
>;

/** Tier tool MCP untuk satu rute: read = jalan selalu; write = butuh MCP_ALLOW_WRITES=1. */
export type PublicSurfaceMcpTier = "read" | "write";

/**
 * Satu rute API publik v1 dan pemetaannya ke permukaan lain.
 *
 * - `scope`: scope API key yang dituntut rute; null = cukup kunci sah
 *   apa pun (hanya /v1/me).
 * - `contractSchemas`: nama ekspor skema kontrak yang membentuk
 *   request/response rute ini — diverifikasi check:drift benar-benar
 *   ada di paket ini.
 * - `sdkMethod`: nama metode pada SahabatKreatorClient; null hanya
 *   bila disengaja dan `exclusionReason` terisi.
 * - `mcpTool`/`mcpTier`: nama tool MCP + tiernya; null hanya bila
 *   disengaja dan `exclusionReason` terisi.
 */
export interface PublicV1RouteMapping {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  scope: ApiKeyScope | null;
  contractSchemas: string[];
  sdkMethod: string | null;
  mcpTool: string | null;
  mcpTier: PublicSurfaceMcpTier | null;
  exclusionReason?: string;
}

/**
 * REGISTRY permukaan publik v1 — daftar kanonis semua rute /v1.
 * Menambah rute publik = menambah entri di sini pada fase yang sama,
 * atau check:drift gagal.
 */
export const PUBLIC_V1_SURFACE: readonly PublicV1RouteMapping[] = [
  {
    method: "GET",
    path: "/v1/me",
    scope: null,
    contractSchemas: ["PublicMeResponseSchema"],
    sdkMethod: "me",
    mcpTool: "whoami",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/contacts",
    scope: "contacts:read",
    contractSchemas: ["V1ListContactsQuerySchema", "ContactListResponseSchema"],
    sdkMethod: "listContacts",
    mcpTool: "list_contacts",
    mcpTier: "read",
  },
  {
    method: "POST",
    path: "/v1/contacts",
    scope: "contacts:write",
    contractSchemas: ["CreateContactRequestSchema", "ContactResponseSchema"],
    sdkMethod: "createContact",
    mcpTool: "create_contact",
    mcpTier: "write",
  },
  {
    method: "PATCH",
    path: "/v1/contacts/:id",
    scope: "contacts:write",
    contractSchemas: ["UpdateContactRequestSchema", "ContactResponseSchema"],
    sdkMethod: "updateContact",
    mcpTool: "update_contact",
    mcpTier: "write",
  },
  {
    method: "GET",
    path: "/v1/conversations",
    scope: "conversations:read",
    contractSchemas: [
      "V1ListConversationsQuerySchema",
      "ConversationListResponseSchema",
    ],
    sdkMethod: "listConversations",
    mcpTool: "list_conversations",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/conversations/:id/messages",
    scope: "conversations:read",
    contractSchemas: ["V1ListMessagesQuerySchema", "MessageListResponseSchema"],
    sdkMethod: "listMessages",
    mcpTool: "list_messages",
    mcpTier: "read",
  },
  {
    method: "POST",
    path: "/v1/conversations/:id/messages",
    scope: "messages:write",
    contractSchemas: ["SendMessageRequestSchema", "MessageResponseSchema"],
    sdkMethod: "sendMessage",
    mcpTool: "send_message",
    mcpTier: "write",
  },
  {
    method: "GET",
    path: "/v1/products",
    scope: "products:read",
    contractSchemas: ["ProductListResponseSchema"],
    sdkMethod: "listProducts",
    mcpTool: "list_products",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/comments",
    scope: "comments:read",
    contractSchemas: ["V1ListCommentsQuerySchema", "CommentListResponseSchema"],
    sdkMethod: "listComments",
    mcpTool: "list_comments",
    mcpTier: "read",
  },
  {
    method: "POST",
    path: "/v1/comments/:id/hide",
    scope: "comments:write",
    contractSchemas: ["CommentResponseSchema"],
    sdkMethod: "hideComment",
    mcpTool: "hide_comment",
    mcpTier: "write",
  },
  {
    method: "POST",
    path: "/v1/comments/:id/unhide",
    scope: "comments:write",
    contractSchemas: ["CommentResponseSchema"],
    sdkMethod: "unhideComment",
    mcpTool: "unhide_comment",
    mcpTier: "write",
  },
  // --- Fase 15A: permukaan BACA baru (sebelumnya dashboard-only) -------
  {
    method: "GET",
    path: "/v1/broadcasts",
    scope: "broadcasts:read",
    contractSchemas: ["V1ListBroadcastsQuerySchema", "BroadcastListResponseSchema"],
    sdkMethod: "listBroadcasts",
    mcpTool: "list_broadcasts",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/broadcasts/:id",
    scope: "broadcasts:read",
    contractSchemas: ["BroadcastResponseSchema"],
    sdkMethod: "getBroadcast",
    mcpTool: "get_broadcast",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/flows",
    scope: "flows:read",
    contractSchemas: ["V1ListFlowsQuerySchema", "FlowListResponseSchema"],
    sdkMethod: "listFlows",
    mcpTool: "list_flows",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/flows/:id",
    scope: "flows:read",
    contractSchemas: ["FlowResponseSchema"],
    sdkMethod: "getFlow",
    mcpTool: "get_flow",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/flow-templates",
    scope: "flows:read",
    contractSchemas: ["FlowTemplateListResponseSchema"],
    sdkMethod: "listFlowTemplates",
    mcpTool: "list_flow_templates",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/automations",
    scope: "automations:read",
    contractSchemas: ["AutomationListResponseSchema"],
    sdkMethod: "listAutomations",
    mcpTool: "list_automations",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/automations/:id",
    scope: "automations:read",
    contractSchemas: ["AutomationResponseSchema"],
    sdkMethod: "getAutomation",
    mcpTool: "get_automation",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/agents",
    scope: "agents:read",
    contractSchemas: ["AgentListResponseSchema"],
    sdkMethod: "listAgents",
    mcpTool: "list_agents",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/agents/:id",
    scope: "agents:read",
    contractSchemas: ["AgentResponseSchema"],
    sdkMethod: "getAgent",
    mcpTool: "get_agent",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/channels",
    scope: "channels:read",
    contractSchemas: ["ChannelAccountListResponseSchema"],
    sdkMethod: "listChannels",
    mcpTool: "list_channels",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/channels/:id",
    scope: "channels:read",
    contractSchemas: ["ChannelAccountResponseSchema"],
    sdkMethod: "getChannel",
    mcpTool: "get_channel",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/whatsapp-templates",
    scope: "whatsapp_templates:read",
    contractSchemas: [
      "V1ListWhatsAppTemplatesQuerySchema",
      "WhatsAppTemplateListResponseSchema",
    ],
    sdkMethod: "listWhatsAppTemplates",
    mcpTool: "list_whatsapp_templates",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/knowledge/documents",
    scope: "knowledge:read",
    contractSchemas: ["KbDocumentListResponseSchema"],
    sdkMethod: "listKnowledgeDocuments",
    mcpTool: "list_knowledge_documents",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/knowledge/documents/:id",
    scope: "knowledge:read",
    contractSchemas: ["KbDocumentResponseSchema"],
    sdkMethod: "getKnowledgeDocument",
    mcpTool: "get_knowledge_document",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/knowledge/stats",
    scope: "knowledge:read",
    contractSchemas: ["KbStatsResponseSchema"],
    sdkMethod: "getKnowledgeStats",
    mcpTool: "get_knowledge_stats",
    mcpTier: "read",
  },
  // --- Fase 13B: growth links — permukaan BACA (tulis dashboard-only) --
  {
    method: "GET",
    path: "/v1/growth-links",
    scope: "growth_links:read",
    contractSchemas: ["GrowthLinkListResponseSchema"],
    sdkMethod: "listGrowthLinks",
    mcpTool: "list_growth_links",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/growth-links/:id",
    scope: "growth_links:read",
    contractSchemas: ["GrowthLinkResponseSchema"],
    sdkMethod: "getGrowthLink",
    mcpTool: "get_growth_link",
    mcpTier: "read",
  },
  // --- Fase 13C: segmen — permukaan BACA (tulis dashboard-only) --
  {
    method: "GET",
    path: "/v1/segments",
    scope: "segments:read",
    contractSchemas: ["SegmentListResponseSchema"],
    sdkMethod: "listSegments",
    mcpTool: "list_segments",
    mcpTier: "read",
  },
  {
    method: "GET",
    path: "/v1/segments/:id",
    scope: "segments:read",
    contractSchemas: ["SegmentResponseSchema"],
    sdkMethod: "getSegment",
    mcpTool: "get_segment",
    mcpTier: "read",
  },
];
