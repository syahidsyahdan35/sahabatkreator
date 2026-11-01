import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { contacts, conversations } from "./inbox";

/**
 * Kelompok Produk & Tautan Bayar (Fase 4A, RANCANGAN §6 & §9):
 * - products      : katalog produk digital milik tenant (segmen pertama:
 *                   kreator produk digital & course). `price_idr` adalah
 *                   harga dalam Rupiah penuh (bigint, tanpa sen) dan
 *                   TIDAK boleh negatif (check constraint di DB).
 * - payment_links : satu tautan bayar untuk satu produk (+ opsional kontak
 *                   & percakapan asal). `amount_idr` adalah SNAPSHOT harga
 *                   produk saat tautan dibuat — mengubah harga produk tidak
 *                   mengubah tautan yang sudah beredar. `code` adalah
 *                   kredensial publik tautan (`pay_...`), sama seperti
 *                   siteKey webchat: dirancang untuk disebar ke pembeli.
 *                   `provider` fase ini selalu 'simulation' — BELUM ada
 *                   gerbang pembayaran sungguhan (Midtrans/Xendit menyusul
 *                   bersama kredensial sandbox-nya); halaman /pay WAJIB
 *                   berlabel simulasi secara jujur di UI.
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS (migrasi
 * 0012 — termasuk lengan SELECT sempit `app.payment_code` pada
 * payment_links agar halaman bayar publik bisa me-resolve code → tenant,
 * meniru pola siteKey webchat migrasi 0006).
 */

export const paymentLinkStatusEnum = pgEnum("payment_link_status", [
  "pending",
  "paid",
  "expired",
  "cancelled",
]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** Harga dalam Rupiah penuh (mode number: aman sampai 2^53). */
    priceIdr: bigint("price_idr", { mode: "number" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("products_tenant_id_idx").on(t.tenantId),
    index("products_tenant_active_idx").on(t.tenantId, t.isActive),
    check("products_price_idr_nonnegative", sql`${t.priceIdr} >= 0`),
  ],
);

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Kontak pembeli bila tautan dibuat untuk kontak tertentu. */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    /** Percakapan asal bila tautan dibuat dari dalam percakapan/agent. */
    conversationId: uuid("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    /** Kredensial publik tautan: `pay_` + 16 karakter acak. */
    code: varchar("code", { length: 64 }).notNull(),
    /** Snapshot harga produk saat tautan dibuat (Rupiah penuh). */
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull(),
    status: paymentLinkStatusEnum("status").notNull().default("pending"),
    /** Gerbang pembayaran; fase ini selalu 'simulation' (BUKAN pembayaran sungguhan). */
    provider: varchar("provider", { length: 32 }).notNull().default("simulation"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Kedaluwarsa default 7 hari sejak dibuat (di-set service, bukan DB default). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payment_links_tenant_id_idx").on(t.tenantId),
    index("payment_links_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("payment_links_product_idx").on(t.productId),
    uniqueIndex("payment_links_code_unique").on(t.code),
    check("payment_links_amount_idr_nonnegative", sql`${t.amountIdr} >= 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type PaymentLink = typeof paymentLinks.$inferSelect;
export type NewPaymentLink = typeof paymentLinks.$inferInsert;
