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
export {
  createTenant,
  listTenantsForUser,
  getTenantForUser,
  slugifyWorkspaceName,
  type MemberRole,
  type TenantWithRole,
} from "./tenants";
export { withTenantDb, type DbTx } from "./tx";
export {
  createContact,
  listContacts,
  getContact,
  updateContact,
  type CreateContactInput,
  type UpdateContactInput,
  type ListContactsInput,
} from "./contacts";
export {
  listConversations,
  getConversation,
  listMessages,
  queueOutboundMessage,
  getConversationDeliveryTarget,
  markOutboundMessageSent,
  type ConversationWithSummary,
  type ConversationDeliveryTarget,
} from "./conversations";
export {
  createWebchatChannelAccount,
  listChannelAccounts,
  generateWebchatSiteKey,
} from "./channels";
export {
  resolveWebchatAccountBySiteKey,
  openWebchatSession,
  recordWebchatInboundMessage,
  flushQueuedWebchatMessages,
  type WebchatAccountRef,
  type OpenWebchatSessionResult,
} from "./webchat";
