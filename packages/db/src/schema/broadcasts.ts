import {
  boolean,
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
import { whatsappTemplates } from "./whatsapp-templates";

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
    /** Isi pesan teks; placeholder {name} disubstitusi per penerima. Untuk broadcast WhatsApp kolom ini menampung teks BODY template (snapshot saat dibuat). */
    messageText: varchar("message_text", { length: 4096 }).notNull(),
    /**
     * Template WhatsApp resmi untuk broadcast provider whatsapp
     * (Fase 10A): wajib terisi (dan berstatus APPROVED) untuk channel
     * WhatsApp; NULL untuk provider lain. SET NULL: template yang
     * dihapus dari cermin membuat broadcast-nya kembali wajib memilih
     * template (jadwal/dispatch menolak dengan kode template).
     */
    whatsappTemplateId: uuid("whatsapp_template_id").references(
      () => whatsappTemplates.id,
      { onDelete: "set null" },
    ),
    /**
     * Sumber nilai variabel BODY template per posisi (Fase 10A):
     * array sepanjang variable_count template; entri "name" = nama
     * kontak, entri lain = kunci `contacts.custom_fields` penerima.
     * Posisi tanpa sumber (array lebih pendek) membuat penerima
     * di-skip `template_variable_missing` saat dispatch — kecuali
     * posisi 1 yang jatuh kembali ke "name".
     */
    templateVariableSources: jsonb("template_variable_sources")
      .notNull()
      .default([])
      .$type<string[]>(),
    /**
     * Filter audiens: { audience?: "all"|"tag"|"segment", tags?,
     * stages?, segmentId? } — mode "tag": kontak cocok bila punya
     * SALAH SATU tag terdaftar (OR dalam kelompok tag) DAN stage-nya
     * termasuk salah satu stage terdaftar; kedua kelompok digabung
     * AND. Mode "segment" (Fase 13C): keanggotaan ditentukan evaluator
     * segmen tunggal di core. Baris lama tanpa `audience` diturunkan
     * modenya dari isi filter (segmentId → segment; tags/stages
     * non-kosong → tag; selain itu all) — regresi nol.
     */
    audienceFilter: jsonb("audience_filter").notNull().default({}),
    /**
     * Gerbang opt-in (Fase 13C): TRUE = hanya kontak berstatus opt-in
     * EFEKTIF ("opted_in") yang dikirimi; yang belum opt-in dicatat
     * sebagai penerima `skipped` beralasan `not_opted_in` saat
     * dispatch. Bawaan dihitung core saat buat: TRUE untuk broadcast
     * WhatsApp (selalu bertemplate resmi), FALSE selain itu; pemilik
     * bisa mengubahnya selama broadcast masih draft. NOT NULL — setiap
     * broadcast selalu punya keputusan gerbang yang eksplisit.
     */
    requireOptIn: boolean("require_opt_in").notNull().default(false),
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
    index("broadcast_recipients_contact_id_idx").on(t.contactId),
    index("broadcast_recipients_conversation_id_idx").on(t.conversationId),
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
