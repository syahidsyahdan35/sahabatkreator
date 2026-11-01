/**
 * @sahabat-kreator/core — logika bisnis murni Sahabat Kreator.
 * Transport-agnostic: tidak tahu Hono/HTTP/BullMQ/MCP/CLI.
 * Fase 1A: konteks tenant + helper transaksi RLS (`withTenant`).
 * Service domain (contacts, conversations, automations, agents, ...)
 * menyusul di fase berikutnya.
 */
export {
  withTenant,
  type TenantContext,
  type TenantDb,
  type TenantTx,
} from "./tenant";
