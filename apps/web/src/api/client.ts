import type {
  ChannelAccountListResponse,
  ChannelAccountResponse,
  ContactListResponse,
  ContactResponse,
  ConversationListResponse,
  ConversationResponse,
  CreateContactRequest,
  MessageListResponse,
  MessageResponse,
  TenantListResponse,
  TenantResponse,
  UpdateContactRequest,
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
    /** POST /api/tenants/:tenantId/channels {provider, displayName} (Fase 1F: webchat). */
    create(
      tenantId: string,
      input: { provider: string; displayName?: string },
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
};
