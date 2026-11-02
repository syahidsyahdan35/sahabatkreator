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
  queueOutboundMessageForApiKey,
  listQueuedOutboundMessages,
  getConversationDeliveryTarget,
  markConversationRead,
  markOutboundMessageSent,
  type ConversationWithSummary,
  type ConversationDeliveryTarget,
} from "./conversations";
export {
  createAutomation,
  listAutomations,
  getAutomation,
  updateAutomation,
  listAutomationRuns,
  listSequenceEnrollments,
  keywordMatches,
  evaluateInboundMessageForAutomations,
  executeSequenceStep,
  type AutomationStepInput,
  type CreateAutomationInput,
  type UpdateAutomationInput,
  type AutomationWithRunCount,
  type AutomationFiredResult,
  type EvaluateInboundResult,
  type ExecuteSequenceStepResult,
  type SequenceEnrollmentWithTotal,
} from "./automations";
export {
  relayUnpublishedOutboxEvents,
  type UnpublishedOutboxEvent,
  type OutboxRelayHandler,
} from "./outbox";
export {
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  getActiveAgent,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "./agents";
export {
  chunkText,
  createKbDocument,
  listKbDocuments,
  getKbDocument,
  deleteKbDocument,
  searchKbChunks,
  buildFtsOrQuery,
  KB_CHUNK_SIZE,
  KB_CHUNK_OVERLAP,
  type KbDocumentWithChunkCount,
  type KbSearchHit,
} from "./kb";
export {
  respondToInboundMessage,
  executeAgentToolCall,
  AGENT_DAILY_RESPONSE_CAP,
  AGENT_USAGE_REF_TYPE,
  type AgentToolContext,
  type AgentToolOutcome,
  type AgentRespondResult,
  type AgentSkipReason,
} from "./agent-runtime";
export {
  listSuggestions,
  getSuggestion,
  approveSuggestion,
  rejectSuggestion,
  type ApproveSuggestionOutcome,
  type RejectSuggestionOutcome,
} from "./suggestions";
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
export {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  generatePaymentCode,
  buildPaymentUrl,
  createPaymentLink,
  listPaymentLinks,
  resolvePaymentLinkByCode,
  getPublicPaymentByCode,
  simulatePayByCode,
  matchActiveProductForPayment,
  PAYMENT_LINK_TTL_DAYS,
  PAYMENT_PROVIDER_SIMULATION,
  type CreateProductInput,
  type UpdateProductInput,
  type DeleteProductResult,
  type PaymentActor,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkResult,
  type PaymentLinkWithNames,
  type PublicPaymentView,
  type SimulatePayResult,
  type ProductMatch,
} from "./products";
export {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  resolveApiKeyByHash,
  touchApiKeyLastUsed,
  getTenantNameById,
  hashApiKey,
  generateApiKey,
  API_KEY_DISPLAY_PREFIX,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type GeneratedApiKey,
} from "./api-keys";
