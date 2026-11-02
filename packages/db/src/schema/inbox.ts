import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./identity";
import { channelAccounts, channelProviderEnum } from "./channels";

/**
 * Kelompok Audience & Inbox (Fase 1D, RANCANGAN §6):
 * - contacts      : audiens milik tenant (lintas channel).
 * - media         : file media yang disimpan di Cloudflare R2 (object key).
 * - conversations : satu utas percakapan kontak pada satu akun channel.
 * - messages      : pesan dalam percakapan; `provider_message_id` unik parsial
 *                   (hanya bila tidak NULL) untuk dedup pesan provider.
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS.
 */

export const optInStatusEnum = pgEnum("opt_in_status", [
  "unknown",
  "opted_in",
  "opted_out",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "pending",
  "closed",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageSenderTypeEnum = pgEnum("message_sender_type", [
  "contact",
  "user",
  "agent",
  "system",
]);

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "template",
  "other",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 32 }),
    avatarUrl: text("avatar_url"),
    tags: text("tags").array().notNull().default([]),
    customFields: jsonb("custom_fields").notNull().default({}),
    /** Tahap pipeline penjualan, mis. 'new' | 'engaged' | 'qualified' | 'customer'. */
    pipelineStage: varchar("pipeline_stage", { length: 64 }).notNull().default("new"),
    optInStatus: optInStatusEnum("opt_in_status").notNull().default("unknown"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_tenant_id_idx").on(t.tenantId),
    index("contacts_tenant_phone_idx").on(t.tenantId, t.phone),
    index("contacts_tenant_email_idx").on(t.tenantId, t.email),
  ],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Object key di bucket Cloudflare R2 tenant/lingkungan ini. */
    r2Key: varchar("r2_key", { length: 512 }).notNull(),
    fileName: varchar("file_name", { length: 255 }),
    mimeType: varchar("mime_type", { length: 128 }),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_tenant_id_idx").on(t.tenantId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Denormalisasi dari channel_accounts.provider agar daftar inbox murah. */
    provider: channelProviderEnum("provider").notNull(),
    /**
     * Id chat di sisi provider = ALAMAT BALASAN percakapan ini (Fase 6A.1).
     * Pada Telegram: `chat.id` sebagai string — positif untuk chat privat
     * (== id user), negatif untuk grup/supergrup. Sampai 6A poller
     * menganggap alamat balasan = identitas kontak, yang hanya benar untuk
     * privat; kolom ini memisahkan keduanya. NULL untuk baris lama /
     * provider lain — poller jatuh kembali ke external_id identitas kontak.
     */
    providerChatId: varchar("provider_chat_id", { length: 255 }),
    /**
     * Judul percakapan di provider (Fase 6A.1) — HANYA diisi untuk
     * percakapan grup Telegram (`chat.title`); percakapan privat & provider
     * lain NULL dan tampil memakai nama kontak. Kehadiran judul inilah
     * penanda percakapan grup bagi API/UI (`isGroup`).
     */
    title: varchar("title", { length: 255 }),
    status: conversationStatusEnum("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Apakah AI agent boleh membalas otomatis di percakapan ini. */
    agentEnabled: boolean("agent_enabled").notNull().default(true),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_tenant_id_idx").on(t.tenantId),
    index("conversations_tenant_status_last_message_idx").on(
      t.tenantId,
      t.status,
      t.lastMessageAt,
    ),
    index("conversations_contact_id_idx").on(t.contactId),
    index("conversations_channel_account_id_idx").on(t.channelAccountId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    senderType: messageSenderTypeEnum("sender_type").notNull(),
    /**
     * Nama pengirim per pesan (Fase 6A.1) — snapshot nama anggota saat
     * pesan grup Telegram masuk. Percakapan grup menampung banyak
     * pengirim, sedangkan baris percakapan hanya menunjuk SATU kontak,
     * jadi atribusi penulis per pesan hidup di sini. NULL di luar grup
     * (privat: pengirimnya ya kontak percakapan itu sendiri).
     */
    senderName: varchar("sender_name", { length: 255 }),
    type: messageTypeEnum("type").notNull().default("text"),
    contentText: text("content_text"),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    /** Id pesan di provider; dipakai untuk dedup webhook & rekonsiliasi status. */
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    status: messageStatusEnum("status").notNull().default("received"),
    /** Biaya provider untuk pesan ini (mis. tarif per-pesan WhatsApp, §12.5). */
    providerCost: numeric("provider_cost", { precision: 18, scale: 6 }),
    errorCode: varchar("error_code", { length: 128 }),
    /** User pengirim untuk pesan outbound manual dari inbox (sender_type='user'). */
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_tenant_id_idx").on(t.tenantId),
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_provider_message_id_unique")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    provider: channelProviderEnum("provider").notNull(),
    /** Id user di provider untuk akun channel ini (PSID/IGSID/wa_id/chat_id/...). */
    externalUserId: varchar("external_user_id", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_identities_account_external_user_unique").on(
      t.channelAccountId,
      t.externalUserId,
    ),
    index("channel_identities_tenant_id_idx").on(t.tenantId),
    index("channel_identities_contact_id_idx").on(t.contactId),
  ],
);

export type ChannelIdentity = typeof channelIdentities.$inferSelect;
export type NewChannelIdentity = typeof channelIdentities.$inferInsert;
