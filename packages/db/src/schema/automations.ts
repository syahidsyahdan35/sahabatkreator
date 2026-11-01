import { sql } from "drizzle-orm";
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
import { contacts, conversations, messages } from "./inbox";

/**
 * Kelompok Automation (Fase 2A, RANCANGAN §6):
 * - automations      : aturan otomatis milik tenant. Fase ini hanya
 *                      trigger_type='keyword' + action_type='send_message';
 *                      konfigurasi trigger/aksi disimpan sebagai jsonb agar
 *                      trigger & aksi berikutnya tidak mengubah skema inti.
 *                      trigger_config: { keywords: string[],
 *                                        match: 'exact' | 'contains' }
 *                      action_config : { text: string } — mendukung
 *                                        placeholder {name} (nama kontak).
 * - automation_runs  : satu baris per eksekusi automation untuk satu pesan
 *                      pemicu. Index unik parsial
 *                      (automation_id, trigger_message_id) adalah penjaga
 *                      idempotensi terakhir: relay/worker yang memproses
 *                      event yang sama dua kali tidak bisa menembak dua kali
 *                      untuk pesan pemicu yang sama.
 * Semua tabel tenant-scoped: tenant_id + index, dilindungi RLS (migrasi 0008).
 */

export const automationTriggerTypeEnum = pgEnum("automation_trigger_type", [
  "keyword",
]);

export const automationActionTypeEnum = pgEnum("automation_action_type", [
  "send_message",
]);

export const automationRunStatusEnum = pgEnum("automation_run_status", [
  "completed",
  "failed",
  "skipped",
]);

export interface AutomationTriggerConfig {
  keywords: string[];
  match: "exact" | "contains";
}

export interface AutomationActionConfig {
  text: string;
}

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    triggerType: automationTriggerTypeEnum("trigger_type")
      .notNull()
      .default("keyword"),
    triggerConfig: jsonb("trigger_config")
      .$type<AutomationTriggerConfig>()
      .notNull()
      .default({ keywords: [], match: "exact" }),
    actionType: automationActionTypeEnum("action_type")
      .notNull()
      .default("send_message"),
    actionConfig: jsonb("action_config")
      .$type<AutomationActionConfig>()
      .notNull()
      .default({ text: "" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("automations_tenant_id_idx").on(t.tenantId),
    index("automations_tenant_active_idx").on(t.tenantId, t.isActive),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Pesan inbound pemicu; NULL hanya untuk pemicu non-pesan di masa depan. */
    triggerMessageId: uuid("trigger_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    status: automationRunStatusEnum("status").notNull(),
    /** Konteks eksekusi: keyword yang cocok, id pesan balasan, alasan skip, dsb. */
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("automation_runs_tenant_id_idx").on(t.tenantId),
    index("automation_runs_automation_created_idx").on(
      t.automationId,
      t.createdAt,
    ),
    uniqueIndex("automation_runs_automation_trigger_message_unique")
      .on(t.automationId, t.triggerMessageId)
      .where(sql`${t.triggerMessageId} IS NOT NULL`),
  ],
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type NewAutomationRun = typeof automationRuns.$inferInsert;
