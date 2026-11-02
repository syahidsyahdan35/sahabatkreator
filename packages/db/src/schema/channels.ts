import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Kelompok Channels (Fase 1D, RANCANGAN §6):
 * - channel_accounts   : akun channel milik tenant (satu baris per akun
 *                        WhatsApp/IG/Messenger/Telegram/Webchat yang terhubung).
 *                        Token akses disimpan TERENKRIPSI (kolom terpisah) dan
 *                        tidak pernah masuk log.
 * `channel_identities` (identitas kontak di akun channel) didefinisikan di
 * schema/inbox.ts bersama contacts — agar tidak ada impor sirkular antar
 * file skema (drizzle-kit memuat skema sebagai CJS).
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS
 * (migrasi RLS lanjutan setelah 0003).
 */

export const channelProviderEnum = pgEnum("channel_provider", [
  "whatsapp",
  "instagram",
  "messenger",
  "telegram",
  "webchat",
]);

export const channelAccountStatusEnum = pgEnum("channel_account_status", [
  "connected",
  "disconnected",
  "error",
]);

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: channelProviderEnum("provider").notNull(),
    /** Id akun di provider: nomor/WABA id, IG user id, Page id, bot id, dsb. */
    externalId: varchar("external_id", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    status: channelAccountStatusEnum("status").notNull().default("disconnected"),
    /** Token akses provider TERENKRIPSI (envelope encryption) — bukan token mentah. */
    accessTokenEncrypted: text("access_token_encrypted"),
    /** Secret untuk verifikasi signature webhook akun ini (bila provider mendukung). */
    webhookSecret: varchar("webhook_secret", { length: 255 }),
    /** Username bot Telegram (tanpa '@', dari getMe — Fase 6A). Bukan rahasia; untuk tampilan. */
    botUsername: varchar("bot_username", { length: 255 }),
    /** Versi Graph API yang ter-pin untuk akun Meta ini (mis. 'v26.0', RANCANGAN §12.1). */
    graphApiVersion: varchar("graph_api_version", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_accounts_tenant_provider_external_unique").on(
      t.tenantId,
      t.provider,
      t.externalId,
    ),
    index("channel_accounts_tenant_id_idx").on(t.tenantId),
  ],
);

export type ChannelAccount = typeof channelAccounts.$inferSelect;
export type NewChannelAccount = typeof channelAccounts.$inferInsert;
