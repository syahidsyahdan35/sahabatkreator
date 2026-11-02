import { sql } from "drizzle-orm";
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
    /**
     * Handle publik akun Meta (Fase 7A): username Page Facebook
     * (messenger) / username akun IG Professional (instagram), dari
     * Graph saat connect. Bukan rahasia; dipakai kartu Channels sebagai
     * @handle + tautan publik m.me/ig.me. Null bila Page tak ber-username.
     */
    publicHandle: varchar("public_handle", { length: 255 }),
    /** Versi Graph API yang ter-pin untuk akun Meta ini (mis. 'v26.0', RANCANGAN §12.1). */
    graphApiVersion: varchar("graph_api_version", { length: 16 }),
    /**
     * Kapan akun dibuang ke Sampah (Fase 6I — hapus permanen BERPENJAGA);
     * NULL = akun hidup normal. Membuang selalu mendahului disconnect
     * (status berakhir 'disconnected' + kredensial kosong), jadi baris
     * Sampah tidak pernah aktif dan tidak menghalangi penjaga satu-bot.
     * Setelah `trashed_at` + 30 hari, worker menghapus baris ini beserta
     * percakapan/pesan/identitasnya secara permanen (purge); sebelum itu
     * akun bisa dipulihkan (restore) apa adanya.
     */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_accounts_tenant_provider_external_unique").on(
      t.tenantId,
      t.provider,
      t.externalId,
    ),
    // Penjaga "satu bot = satu koneksi" (hotfix Telegram, migrasi 0020):
    // (provider, external_id) unik di SEMUA tenant selama akunnya belum
    // 'disconnected' — satu bot Telegram hanya punya satu webhook, jadi
    // koneksi kedua di workspace mana pun harus mustahil di level data.
    // Baris 'disconnected' dikecualikan agar bot bisa dihubungkan lagi
    // (di workspace yang sama atau yang lain) setelah diputuskan.
    uniqueIndex("channel_accounts_provider_external_active_unique")
      .on(t.provider, t.externalId)
      .where(sql`${t.status} <> 'disconnected'`),
    index("channel_accounts_tenant_id_idx").on(t.tenantId),
    // Antrean purge worker (Fase 6I): pindai baris Sampah yang masa
    // tenggangnya lewat — index parsial hanya memuat baris trashed.
    index("channel_accounts_trashed_at_idx")
      .on(t.trashedAt)
      .where(sql`${t.trashedAt} IS NOT NULL`),
  ],
);

export type ChannelAccount = typeof channelAccounts.$inferSelect;
export type NewChannelAccount = typeof channelAccounts.$inferInsert;
