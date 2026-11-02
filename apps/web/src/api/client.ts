import type {
  AgentListResponse,
  ApiKeyListResponse,
  ApiKeyResponse,
  CreatedApiKeyResponse,
  CreateApiKeyRequest,
  AgentResponse,
  AgentSuggestionListResponse,
  AgentSuggestionResponse,
  AutomationListResponse,
  AutomationResponse,
  AutomationRunListResponse,
  AutomationRunResponse,
  ChannelAccountListResponse,
  ChannelAccountResponse,
  ContactListResponse,
  ContactResponse,
  ConversationListResponse,
  ConversationResponse,
  CreateAgentRequest,
  CreateAutomationRequest,
  CreateContactRequest,
  CreateKbDocumentRequest,
  CreatePaymentLinkRequest,
  CreateProductRequest,
  KbDocumentListResponse,
  KbDocumentResponse,
  MessageListResponse,
  MessageResponse,
  PaymentLinkListResponse,
  PaymentLinkResponse,
  ProductListResponse,
  ProductResponse,
  PublicPaymentResponse,
  SequenceEnrollmentListResponse,
  SequenceEnrollmentResponse,
  TenantListResponse,
  TenantResponse,
  UpdateAgentRequest,
  UpdateAutomationRequest,
  UpdateContactRequest,
  UpdateProductRequest,
} from "@sahabat-kreator/contracts";

/**
 * Klien API tipis untuk web (Fase 1C).
 *
 * - Satu origin dengan API: semua path berawalan "/api" (di staging diteruskan
 *   Vite preview ke API Hono; lihat vite.config.ts).
 * - Sesi adalah cookie httpOnly Better Auth → selalu `credentials: "include"`.
 * - Error dinormalisasi ke ApiClientError {status, code}: kode diambil dari
 *   format kontrak {error:{code,message}} (modul bisnis kita) ATAU format
 *   Better Auth {code,message} (endpoint /api/auth/*). UI menerjemahkan `code`
 *   ke teks lewat i18n (lihat errorText.ts) — pesan mentah server tidak pernah
 *   ditampilkan ke pengguna.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function fallbackCodeForStatus(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network request failed");
  }

  const raw = await res.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const contractError = record.error as Record<string, unknown> | undefined;
    const code =
      (typeof contractError?.code === "string" && contractError.code) ||
      (typeof record.code === "string" && record.code) ||
      fallbackCodeForStatus(res.status);
    const message =
      (typeof contractError?.message === "string" && contractError.message) ||
      (typeof record.message === "string" && record.message) ||
      res.statusText;
    throw new ApiClientError(res.status, code, message);
  }

  return body as T;
}

export const api = {
  auth: {
    /** GET /api/auth/get-session → user bila sesi valid, null bila belum login. */
    async getSessionUser(): Promise<SessionUser | null> {
      const body = await request<{ user?: SessionUser } | null>(
        "/api/auth/get-session",
        { method: "GET" },
      );
      return body?.user ?? null;
    },
    signIn(email: string, password: string): Promise<unknown> {
      return request("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },
    signUp(name: string, email: string, password: string): Promise<unknown> {
      return request("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
    },
    signOut(): Promise<unknown> {
      return request("/api/auth/sign-out", {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  },
  tenants: {
    async list(): Promise<TenantResponse[]> {
      const body = await request<TenantListResponse>("/api/tenants", {
        method: "GET",
      });
      return body.tenants;
    },
    create(name: string): Promise<TenantResponse> {
      return request<TenantResponse>("/api/tenants", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
  },
  contacts: {
    /** GET /api/tenants/:tenantId/contacts?search=&limit=&offset= → {contacts,total} */
    list(
      tenantId: string,
      opts?: { search?: string; limit?: number; offset?: number },
    ): Promise<ContactListResponse> {
      const q = new URLSearchParams();
      if (opts?.search) q.set("search", opts.search);
      if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
      if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
      const qs = q.toString();
      return request<ContactListResponse>(
        `/api/tenants/${tenantId}/contacts${qs ? `?${qs}` : ""}`,
        { method: "GET" },
      );
    },
    create(
      tenantId: string,
      input: CreateContactRequest,
    ): Promise<ContactResponse> {
      return request<ContactResponse>(`/api/tenants/${tenantId}/contacts`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    get(tenantId: string, contactId: string): Promise<ContactResponse> {
      return request<ContactResponse>(
        `/api/tenants/${tenantId}/contacts/${contactId}`,
        { method: "GET" },
      );
    },
    update(
      tenantId: string,
      contactId: string,
      input: UpdateContactRequest,
    ): Promise<ContactResponse> {
      return request<ContactResponse>(
        `/api/tenants/${tenantId}/contacts/${contactId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
    },
  },
  channels: {
    /** GET /api/tenants/:tenantId/channels */
    async list(tenantId: string): Promise<ChannelAccountResponse[]> {
      const body = await request<ChannelAccountListResponse>(
        `/api/tenants/${tenantId}/channels`,
        { method: "GET" },
      );
      return body.channels;
    },
    /** POST /api/tenants/:tenantId/channels {provider, displayName, botToken?} (1F webchat, 6A telegram). */
    create(
      tenantId: string,
      input: { provider: string; displayName?: string; botToken?: string },
    ): Promise<ChannelAccountResponse> {
      return request<ChannelAccountResponse>(
        `/api/tenants/${tenantId}/channels`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
  },
  conversations: {
    /** GET /api/tenants/:tenantId/conversations?status= */
    async list(
      tenantId: string,
      opts?: { status?: string },
    ): Promise<ConversationResponse[]> {
      const q = new URLSearchParams();
      if (opts?.status) q.set("status", opts.status);
      const qs = q.toString();
      const body = await request<ConversationListResponse>(
        `/api/tenants/${tenantId}/conversations${qs ? `?${qs}` : ""}`,
        { method: "GET" },
      );
      return body.conversations;
    },
    /** GET .../conversations/:id/messages?limit= → pesan kronologis menaik. */
    async listMessages(
      tenantId: string,
      conversationId: string,
      opts?: { limit?: number },
    ): Promise<MessageResponse[]> {
      const q = new URLSearchParams();
      if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
      const qs = q.toString();
      const body = await request<MessageListResponse>(
        `/api/tenants/${tenantId}/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`,
        { method: "GET" },
      );
      return body.messages;
    },
    /** POST .../conversations/:id/messages {contentText} → pesan outbound `queued`. */
    sendMessage(
      tenantId: string,
      conversationId: string,
      contentText: string,
    ): Promise<MessageResponse> {
      return request<MessageResponse>(
        `/api/tenants/${tenantId}/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({ contentText }) },
      );
    },
  },
  automations: {
    /** GET /api/tenants/:tenantId/automations → daftar + runCount (Fase 2A). */
    async list(tenantId: string): Promise<AutomationResponse[]> {
      const body = await request<AutomationListResponse>(
        `/api/tenants/${tenantId}/automations`,
        { method: "GET" },
      );
      return body.automations;
    },
    /** POST /api/tenants/:tenantId/automations → 201 automation baru. */
    create(
      tenantId: string,
      input: CreateAutomationRequest,
    ): Promise<AutomationResponse> {
      return request<AutomationResponse>(
        `/api/tenants/${tenantId}/automations`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    /** PATCH /api/tenants/:tenantId/automations/:id → automation terbarui. */
    update(
      tenantId: string,
      automationId: string,
      input: UpdateAutomationRequest,
    ): Promise<AutomationResponse> {
      return request<AutomationResponse>(
        `/api/tenants/${tenantId}/automations/${automationId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
    },
    /** GET /api/tenants/:tenantId/automations/:id/runs → riwayat eksekusi. */
    async listRuns(
      tenantId: string,
      automationId: string,
    ): Promise<AutomationRunResponse[]> {
      const body = await request<AutomationRunListResponse>(
        `/api/tenants/${tenantId}/automations/${automationId}/runs`,
        { method: "GET" },
      );
      return body.runs;
    },
    /** GET /api/tenants/:tenantId/automations/:id/enrollments → pendaftaran sequence (Fase 2C). */
    async listEnrollments(
      tenantId: string,
      automationId: string,
    ): Promise<SequenceEnrollmentResponse[]> {
      const body = await request<SequenceEnrollmentListResponse>(
        `/api/tenants/${tenantId}/automations/${automationId}/enrollments`,
        { method: "GET" },
      );
      return body.enrollments;
    },
  },
  agents: {
    /** GET /api/tenants/:tenantId/agents → daftar agent workspace (Fase 3A). */
    async list(tenantId: string): Promise<AgentResponse[]> {
      const body = await request<AgentListResponse>(
        `/api/tenants/${tenantId}/agents`,
        { method: "GET" },
      );
      return body.agents;
    },
    /** POST /api/tenants/:tenantId/agents → 201 agent baru. */
    create(
      tenantId: string,
      input: CreateAgentRequest,
    ): Promise<AgentResponse> {
      return request<AgentResponse>(`/api/tenants/${tenantId}/agents`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** PATCH /api/tenants/:tenantId/agents/:id → agent terbarui. */
    update(
      tenantId: string,
      agentId: string,
      input: UpdateAgentRequest,
    ): Promise<AgentResponse> {
      return request<AgentResponse>(
        `/api/tenants/${tenantId}/agents/${agentId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
    },
  },
  suggestions: {
    /** GET /api/tenants/:tenantId/suggestions?status=pending → draf balasan agent mode suggest. */
    async list(
      tenantId: string,
      opts?: { status?: string },
    ): Promise<AgentSuggestionResponse[]> {
      const q = new URLSearchParams();
      if (opts?.status) q.set("status", opts.status);
      const qs = q.toString();
      const body = await request<AgentSuggestionListResponse>(
        `/api/tenants/${tenantId}/suggestions${qs ? `?${qs}` : ""}`,
        { method: "GET" },
      );
      return body.suggestions;
    },
    /** POST .../suggestions/:id/approve → teks saran terkirim sebagai pesan agent. */
    approve(
      tenantId: string,
      suggestionId: string,
    ): Promise<AgentSuggestionResponse> {
      return request<AgentSuggestionResponse>(
        `/api/tenants/${tenantId}/suggestions/${suggestionId}/approve`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    /** POST .../suggestions/:id/reject → draf ditolak. */
    reject(
      tenantId: string,
      suggestionId: string,
    ): Promise<AgentSuggestionResponse> {
      return request<AgentSuggestionResponse>(
        `/api/tenants/${tenantId}/suggestions/${suggestionId}/reject`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
  },
  kb: {
    /** GET /api/tenants/:tenantId/kb/documents → daftar dokumen + chunkCount. */
    async listDocuments(tenantId: string): Promise<KbDocumentResponse[]> {
      const body = await request<KbDocumentListResponse>(
        `/api/tenants/${tenantId}/kb/documents`,
        { method: "GET" },
      );
      return body.documents;
    },
    /** POST /api/tenants/:tenantId/kb/documents → 201 dokumen baru (sudah ter-chunk). */
    createDocument(
      tenantId: string,
      input: CreateKbDocumentRequest,
    ): Promise<KbDocumentResponse> {
      return request<KbDocumentResponse>(
        `/api/tenants/${tenantId}/kb/documents`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    /** GET /api/tenants/:tenantId/kb/documents/:id → satu dokumen + chunkCount. */
    getDocument(
      tenantId: string,
      documentId: string,
    ): Promise<KbDocumentResponse> {
      return request<KbDocumentResponse>(
        `/api/tenants/${tenantId}/kb/documents/${documentId}`,
        { method: "GET" },
      );
    },
    /** DELETE /api/tenants/:tenantId/kb/documents/:id → 204 tanpa body. */
    async deleteDocument(
      tenantId: string,
      documentId: string,
    ): Promise<void> {
      await request<unknown>(
        `/api/tenants/${tenantId}/kb/documents/${documentId}`,
        { method: "DELETE" },
      );
    },
  },
  products: {
    /** GET /api/tenants/:tenantId/products → daftar produk workspace (Fase 4A). */
    async list(tenantId: string): Promise<ProductResponse[]> {
      const body = await request<ProductListResponse>(
        `/api/tenants/${tenantId}/products`,
        { method: "GET" },
      );
      return body.products;
    },
    /** POST /api/tenants/:tenantId/products → 201 produk baru. */
    create(
      tenantId: string,
      input: CreateProductRequest,
    ): Promise<ProductResponse> {
      return request<ProductResponse>(`/api/tenants/${tenantId}/products`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** PATCH /api/tenants/:tenantId/products/:id → produk terbarui. */
    update(
      tenantId: string,
      productId: string,
      input: UpdateProductRequest,
    ): Promise<ProductResponse> {
      return request<ProductResponse>(
        `/api/tenants/${tenantId}/products/${productId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
    },
    /** DELETE → 204; 409 PRODUCT_HAS_LINKS bila produk sudah punya tautan bayar. */
    async remove(tenantId: string, productId: string): Promise<void> {
      await request<unknown>(`/api/tenants/${tenantId}/products/${productId}`, {
        method: "DELETE",
      });
    },
  },
  paymentLinks: {
    /** GET /api/tenants/:tenantId/payment-links → tautan bayar terbaru workspace. */
    async list(tenantId: string): Promise<PaymentLinkResponse[]> {
      const body = await request<PaymentLinkListResponse>(
        `/api/tenants/${tenantId}/payment-links`,
        { method: "GET" },
      );
      return body.paymentLinks;
    },
    /** POST /api/tenants/:tenantId/payment-links {productId, contactId?} → 201 tautan baru. */
    create(
      tenantId: string,
      input: CreatePaymentLinkRequest,
    ): Promise<PaymentLinkResponse> {
      return request<PaymentLinkResponse>(
        `/api/tenants/${tenantId}/payment-links`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
  },
  apiKeys: {
    /** GET /api/tenants/:tenantId/api-keys → daftar kunci (tanpa nilai utuh). */
    async list(tenantId: string): Promise<ApiKeyResponse[]> {
      const body = await request<ApiKeyListResponse>(
        `/api/tenants/${tenantId}/api-keys`,
        { method: "GET" },
      );
      return body.apiKeys;
    },
    /** POST /api/tenants/:tenantId/api-keys → 201; `key` utuh hanya di respons ini. */
    create(
      tenantId: string,
      input: CreateApiKeyRequest,
    ): Promise<CreatedApiKeyResponse> {
      return request<CreatedApiKeyResponse>(`/api/tenants/${tenantId}/api-keys`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** DELETE /api/tenants/:tenantId/api-keys/:id → cabut kunci (204). */
    async revoke(tenantId: string, apiKeyId: string): Promise<void> {
      await request<unknown>(`/api/tenants/${tenantId}/api-keys/${apiKeyId}`, {
        method: "DELETE",
      });
    },
  },
  pay: {
    /** GET /api/pay/:code → ringkasan publik tautan bayar (tanpa sesi). */
    getPublic(code: string): Promise<PublicPaymentResponse> {
      return request<PublicPaymentResponse>(`/api/pay/${code}`, {
        method: "GET",
      });
    },
    /** POST /api/pay/:code/simulate-pay → SIMULASI pembayaran (bukan uang sungguhan). */
    simulatePay(code: string): Promise<PublicPaymentResponse> {
      return request<PublicPaymentResponse>(`/api/pay/${code}/simulate-pay`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  },
};
