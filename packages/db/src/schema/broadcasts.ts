import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./identity";
import { channelAccounts } from "./channels";
import { contacts, conversations, messages } from "./inbox";

/**
 * Kelompok Campaign (Fase 7C — Broadcasts v1):
 * - broadcasts           : satu kampanye siaran teks ke audiens kontak pada
 *                          SATU akun channel (telegram/messenger/instagram
 *                          di v1; WhatsApp menunggu manajemen template,
 *                          webchat tidak punya semantik push).
 * - broadcast_recipients : baris per penerima, dimaterialisasi SAAT
 *                          dispatch oleh worker (bukan saat dibuat) —
 *                          sumber kebenaran statistik broadcast. Statusnya
 *                          mengikuti status pesan keluarnya (disinkronkan
 *                          worker), kecuali terminal lokal: skipped
 *                          (opt-out / di luar jendela 24 jam Meta) dan
 *                          cancelled (pesan queued-nya dihapus).
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS
 * (migrasi 0030).
 */

export const broadcastStatusEnum = pgEnum("broadcast_status", [
  "draft",
  "scheduled",
  "sending",
  "completed",
  "partially_failed",
  "failed",
  "cancelled",
]);

export const broadcastRecipientStatusEnum = pgEnum(
  "broadcast_recipient_status",
  [
    "queued",
    "sent",
    "delivered",
    "read",
    "failed",
    "skipped",
    "cancelled",
  ],
);

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    /** Judul internal kampanye (tidak dikirim ke penerima). */
    name: varchar("name", { length: 255 }).notNull(),
    /** Isi pesan teks; placeholder {name} disubstitusi per penerima. */
    messageText: varchar("message_text", { length: 4096 }).notNull(),
    /**
     * Filter audiens: { tags?: string[], stages?: string[] } — kontak
     * cocok bila punya SALAH SATU tag terdaftar (OR dalam kelompok tag)
     * DAN stage-nya termasuk salah satu stage terdaftar; kedua kelompok
     * digabung AND. Kosong = semua kontak beridentitas di channel itu.
     */
    audienceFilter: jsonb("audience_filter").notNull().default({}),
    status: broadcastStatusEnum("status").notNull().default("draft"),
    /** Waktu kirim yang diminta; NULL selama draft. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** Kapan dispatch worker mulai mengeksekusi. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Kapan broadcast mencapai status terminal. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Kode kegagalan tingkat dispatch (mis. CHANNEL_DISCONNECTED, AUDIENCE_EMPTY). */
    errorCode: varchar("error_code", { length: 128 }),
    /** User pembuat (dibuat oleh) — informasional, SET NULL bila user hilang. */
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("broadcasts_tenant_id_idx").on(t.tenantId),
    index("broadcasts_tenant_status_idx").on(t.tenantId, t.status),
    index("broadcasts_channel_account_id_idx").on(t.channelAccountId),
  ],
);

export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /**
     * Percakapan 1:1 tujuan (yang sudah ada atau dibuat saat dispatch).
     * SET NULL: penghapusan percakapan tidak menghapus jejak penerima.
     */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /**
     * Pesan keluar yang dibuat untuk penerima ini. SET NULL disengaja:
     * cancel broadcast menghapus pesan `queued` yang belum terkirim —
     * baris penerima tetap ada sebagai cancelled, tautannya lepas.
     */
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    status: broadcastRecipientStatusEnum("status").notNull().default("queued"),
    /** Alasan skipped: 'opted_out' | 'outside_24h_window' | 'message_deleted'. */
    skipReason: varchar("skip_reason", { length: 64 }),
    /** Kode error provider untuk penerima failed (disalin dari pesan). */
    errorCode: varchar("error_code", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcast_recipients_broadcast_contact_unique").on(
      t.broadcastId,
      t.contactId,
    ),
    index("broadcast_recipients_tenant_id_idx").on(t.tenantId),
    index("broadcast_recipients_broadcast_status_idx").on(
      t.broadcastId,
      t.status,
    ),
    index("broadcast_recipients_message_id_idx").on(t.messageId),
  ],
);

export type Broadcast = typeof broadcasts.$inferSelect;
export type NewBroadcast = typeof broadcasts.$inferInsert;
export type BroadcastRecipient = typeof broadcastRecipients.$inferSelect;
export type NewBroadcastRecipient = typeof broadcastRecipients.$inferInsert;
