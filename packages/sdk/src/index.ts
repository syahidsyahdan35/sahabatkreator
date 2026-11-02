import type {
  ApiError,
  ContactListResponse,
  ContactResponse,
  ConversationListResponse,
  CreateContactRequest,
  ErrorCode,
  ListContactsQuery,
  ListConversationsQuery,
  ListMessagesQuery,
  MessageListResponse,
  MessageResponse,
  ProductListResponse,
  PublicMeResponse,
  SendMessageRequest,
} from "@sahabat-kreator/contracts";

/**
 * @sahabat-kreator/sdk — client TypeScript tipis untuk API publik v1
 * Sahabat Kreator (Fase 5B, RANCANGAN §2 & §8).
 *
 * Prinsip: SDK ini TIDAK mendefinisikan ulang bentuk data. Semua tipe
 * request/response diimpor dari @sahabat-kreator/contracts (sumber
 * kebenaran tunggal); yang ditulis tangan di sini hanya transport —
 * autentikasi API key, pemetaan error kontrak, dan pemanggilan endpoint.
 * Tanpa dependensi runtime: memakai `fetch` bawaan (Node 18+ / browser
 * modern / Bun / Deno).
 *
 * Autentikasi: API key per tenant (`sk_live_...`) dibuat dari dashboard
 * Settings → API Keys. Tenant TIDAK PERNAH disebut di URL — server
 * menurunkannya dari kunci, dan scope kunci membatasi metode yang boleh
 * dipanggil (mis. tanpa `messages:write`, sendMessage ditolak 403
 * `API_KEY_SCOPE_DENIED`).
 */

export type {
  ApiError,
  ContactListResponse,
  ContactResponse,
  ConversationListResponse,
  CreateContactRequest,
  ErrorCode,
  ListContactsQuery,
  ListConversationsQuery,
  ListMessagesQuery,
  MessageListResponse,
  MessageResponse,
  ProductListResponse,
  PublicMeResponse,
  SendMessageRequest,
};

/**
 * Error API yang dilempar semua metode client. Membawa `code` kontrak
 * (mis. `API_KEY_INVALID`, `API_KEY_SCOPE_DENIED`, `NOT_FOUND`) dan status
 * HTTP, sehingga pemanggil bisa bercabang pada kode — bukan pada kalimat.
 */
export class SahabatKreatorApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(init: {
    status: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "SahabatKreatorApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

export interface SahabatKreatorClientOptions {
  /**
   * Origin API, TANPA path — mis. `https://botara.my.id`. Client memanggil
   * `{baseUrl}/api/v1/...`.
   */
  baseUrl: string;
  /** API key tenant (`sk_live_...`). Simpan sebagai rahasia (env/secret store). */
  apiKey: string;
  /** Override `fetch` (test/injeksi runtime); default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export class SahabatKreatorClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SahabatKreatorClientOptions) {
    if (!options.apiKey) {
      throw new Error("SahabatKreatorClient: `apiKey` wajib diisi");
    }
    if (!options.baseUrl) {
      throw new Error("SahabatKreatorClient: `baseUrl` wajib diisi");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    init?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(init?.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(init?.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      // Kegagalan jaringan: tidak ada respons HTTP. Dibungkus sebagai error
      // bertipe dengan status 0 agar pemanggil punya satu jalur penanganan.
      throw new SahabatKreatorApiError({
        status: 0,
        code: "INTERNAL_ERROR",
        message: `Network request to ${url.origin} failed`,
        cause: err,
      });
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!response.ok) {
      const apiError = (parsed as ApiError | undefined)?.error;
      throw new SahabatKreatorApiError({
        status: response.status,
        code: apiError?.code ?? "INTERNAL_ERROR",
        message: apiError?.message ?? `Request failed with HTTP ${response.status}`,
        details: apiError?.details,
      });
    }
    return parsed as T;
  }

  /** GET /v1/me — identitas tenant pemilik kunci + scope kunci. */
  async me(): Promise<PublicMeResponse> {
    return this.request<PublicMeResponse>("GET", "/me");
  }

  /** GET /v1/contacts (scope `contacts:read`) — daftar + cari + pagination. */
  async listContacts(
    query: ListContactsQuery = {},
  ): Promise<ContactListResponse> {
    return this.request<ContactListResponse>("GET", "/contacts", {
      query: { search: query.search, limit: query.limit, offset: query.offset },
    });
  }

  /** POST /v1/contacts (scope `contacts:write`) — buat kontak baru. */
  async createContact(input: CreateContactRequest): Promise<ContactResponse> {
    return this.request<ContactResponse>("POST", "/contacts", { body: input });
  }

  /** GET /v1/conversations (scope `conversations:read`). */
  async listConversations(
    query: ListConversationsQuery = {},
  ): Promise<ConversationListResponse> {
    return this.request<ConversationListResponse>("GET", "/conversations", {
      query: { status: query.status },
    });
  }

  /** GET /v1/conversations/:id/messages (scope `conversations:read`). */
  async listMessages(
    conversationId: string,
    query: ListMessagesQuery = {},
  ): Promise<MessageListResponse> {
    return this.request<MessageListResponse>(
      "GET",
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      { query: { limit: query.limit } },
    );
  }

  /**
   * POST /v1/conversations/:id/messages (scope `messages:write`) — kirim
   * pesan keluar sebagai workspace. Pesan masuk antrean pengiriman yang
   * sama dengan balasan dashboard (webchat: didorong realtime lewat hub
   * bila pengunjung terhubung).
   */
  async sendMessage(
    conversationId: string,
    contentText: string,
  ): Promise<MessageResponse> {
    const body: SendMessageRequest = { contentText };
    return this.request<MessageResponse>(
      "POST",
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      { body },
    );
  }

  /** GET /v1/products (scope `products:read`). */
  async listProducts(): Promise<ProductListResponse> {
    return this.request<ProductListResponse>("GET", "/products");
  }
}
