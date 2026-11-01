import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Tabel sistem fondasi (RANCANGAN §2 & §6):
 * - webhook_inbox : dedup webhook provider (unik provider + provider_event_id)
 * - outbox_events : Transactional Outbox — event ditulis dalam transaksi yang
 *                   sama dengan perubahan datanya, relay mem-publish yang
 *                   published_at-nya masih NULL.
 * - audit_logs    : jejak setiap aksi penting, terutama aksi otonom AI agent.
 * - usage_ledger  : metering APPEND-ONLY (sengaja tanpa updated_at) untuk
 *                   billing; mencatat qty + biaya model + biaya provider.
 */

export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "user",
  "agent",
  "system",
]);

export const usageTypeEnum = pgEnum("usage_type", [
  "message",
  "ai_token",
  "contact",
]);

export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Boleh NULL: webhook bisa tiba sebelum ter-resolve ke tenant tertentu. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | ... */
    provider: varchar("provider", { length: 32 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 255 }).notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_inbox_provider_event_unique").on(t.provider, t.providerEventId),
    index("webhook_inbox_tenant_id_idx").on(t.tenantId),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Boleh NULL untuk event tingkat sistem yang tidak terkait tenant. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Mis. 'message.received', 'payment.succeeded', 'contact.created'. */
    type: varchar("type", { length: 128 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    /** NULL = belum di-publish oleh relay. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outbox_events_published_at_idx").on(t.publishedAt),
    index("outbox_events_tenant_id_idx").on(t.tenantId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    /** ID user / agent / komponen sistem yang melakukan aksi. */
    actorId: varchar("actor_id", { length: 255 }),
    /** Mis. 'agent.message_sent', 'contact.tagged', 'billing.subscription_changed'. */
    action: varchar("action", { length: 128 }).notNull(),
    /** Konteks bebas: prompt_version, model, tokens, ref id, dsb. */
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_id_idx").on(t.tenantId),
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: usageTypeEnum("type").notNull(),
    /** Jumlah unit: pesan terkirim, token, atau kontak baru. */
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    /** Biaya model AI (LLM) untuk baris ini, dalam `currency`. */
    costModel: numeric("cost_model", { precision: 18, scale: 6 }).notNull().default("0"),
    /** Biaya provider (mis. tarif per-pesan WhatsApp, RANCANGAN §12.5) dalam `currency`. */
    costProvider: numeric("cost_provider", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
    /** Referensi sumber, mis. refType='message', refId=<message uuid>. */
    refType: varchar("ref_type", { length: 64 }),
    refId: varchar("ref_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // APPEND-ONLY: sengaja TIDAK ada updated_at.
  },
  (t) => [
    index("usage_ledger_tenant_id_idx").on(t.tenantId),
    index("usage_ledger_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export type WebhookInboxRow = typeof webhookInbox.$inferSelect;
export type NewWebhookInboxRow = typeof webhookInbox.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type UsageLedgerRow = typeof usageLedger.$inferSelect;
export type NewUsageLedgerRow = typeof usageLedger.$inferInsert;
