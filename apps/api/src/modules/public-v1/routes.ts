import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  ContactListResponseSchema,
  ConversationListResponseSchema,
  ConversationStatusSchema,
  CreateContactRequestSchema,
  MessageListResponseSchema,
  ProductListResponseSchema,
  PublicMeResponseSchema,
  SendMessageRequestSchema,
  type ApiKeyScope,
} from "@sahabat-kreator/contracts";
import {
  createContact,
  getTenantNameById,
  hashApiKey,
  listContacts,
  listConversations,
  listMessages,
  listProducts,
  queueOutboundMessageForApiKey,
  resolveApiKeyByHash,
  touchApiKeyLastUsed,
  API_KEY_DISPLAY_PREFIX,
} from "@sahabat-kreator/core";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";
import { apiError, type ApiKeyAuthContext, type AppVariables } from "../../http";
import { serializeContact } from "../contacts/routes";
import { serializeConversation } from "../inbox/routes";
import { serializeMessage } from "../messages-serialize";
import { serializeProduct } from "../products/routes";

const ListContactsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ListConversationsQuerySchema = z.object({
  status: ConversationStatusSchema.optional(),
});

const ListMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Mengambil kunci mentah dari `Authorization: Bearer ...` atau header `X-API-Key`. */
function extractPresentedKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const xKey = headers.get("x-api-key")?.trim();
  return xKey ? xKey : null;
}

/**
 * Modul API publik /v1 (Fase 5A, RANCANGAN §5.4) — permukaan untuk SDK,
 * MCP server, dan integrasi pihak ketiga. TIDAK memakai sesi dashboard:
 * autentikasi = API key per tenant (`Authorization: Bearer sk_live_...`
 * atau `X-API-Key`). Tenant TIDAK PERNAH datang dari URL — selalu
 * diturunkan dari baris kunci, dan semua data dibaca lewat service core
 * dalam konteks RLS tenant pemilik kunci.
 *   GET  /v1/me                                  identitas tenant + scopes kunci
 *   GET  /v1/contacts          (contacts:read)   daftar + ?search=&limit=&offset=
 *   POST /v1/contacts          (contacts:write)  buat kontak → 201
 *   GET  /v1/conversations     (conversations:read)
 *   GET  /v1/conversations/:id/messages          (conversations:read)
 *   POST /v1/conversations/:id/messages          (messages:write) → pesan queued
 *   GET  /v1/products          (products:read)
 * Penolakan: tanpa/bukan kunci → 401 API_KEY_INVALID; kunci dicabut → 401
 * API_KEY_REVOKED; scope kurang → 403 API_KEY_SCOPE_DENIED.
 */
export function createPublicV1Routes(
  bundle: AuthBundle | null,
  publisher?: RealtimePublisher | null,
) {
  const app = new Hono<{ Variables: AppVariables }>();

  if (!bundle) {
    app.all("/v1/*", (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    return app;
  }

  const requireApiKey: MiddlewareHandler<{ Variables: AppVariables }> =
    async (c, next) => {
      const presented = extractPresentedKey(c.req.raw.headers);
      if (!presented || !presented.startsWith(API_KEY_DISPLAY_PREFIX)) {
        return apiError(c, 401, "API_KEY_INVALID", "Missing or malformed API key");
      }
      const row = await resolveApiKeyByHash(bundle.db, hashApiKey(presented));
      if (!row) {
        return apiError(c, 401, "API_KEY_INVALID", "API key not recognized");
      }
      if (row.revokedAt) {
        return apiError(c, 401, "API_KEY_REVOKED", "API key has been revoked");
      }
      c.set("apiKeyAuth", {
        apiKey: row,
        tenantId: row.tenantId,
        scopes: row.scopes as ApiKeyScope[],
      });
      // last_used_at best-effort: kegagalan update tidak boleh menggagalkan request.
      void touchApiKeyLastUsed(bundle.db, row.tenantId, row.id).catch(() => {});
      await next();
    };

  app.use("/v1/*", requireApiKey);

  function requireScope(
    c: { get: (k: "apiKeyAuth") => ApiKeyAuthContext },
    scope: ApiKeyScope,
  ) {
    return c.get("apiKeyAuth").scopes.includes(scope)
      ? null
      : apiError(c as Parameters<typeof apiError>[0], 403, "API_KEY_SCOPE_DENIED", `Missing scope: ${scope}`);
  }

  app.get("/v1/me", async (c) => {
    const auth = c.get("apiKeyAuth");
    const tenantName = await getTenantNameById(bundle.db, auth.tenantId);
    const body = PublicMeResponseSchema.parse({
      tenantId: auth.tenantId,
      tenantName: tenantName ?? "",
      scopes: auth.scopes,
    });
    return c.json(body);
  });

  app.get("/v1/contacts", async (c) => {
    const denied = requireScope(c, "contacts:read");
    if (denied) return denied;
    const query = ListContactsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid query parameters");
    }
    const auth = c.get("apiKeyAuth");
    const result = await listContacts(bundle.db, { tenantId: auth.tenantId }, query.data);
    const body = ContactListResponseSchema.parse({
      contacts: result.contacts.map((row) => serializeContact(row)),
      total: result.total,
    });
    return c.json(body);
  });

  app.post("/v1/contacts", async (c) => {
    const denied = requireScope(c, "contacts:write");
    if (denied) return denied;
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreateContactRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid contact payload");
    }
    const auth = c.get("apiKeyAuth");
    const contact = await createContact(bundle.db, { tenantId: auth.tenantId }, parsed.data);
    return c.json(serializeContact(contact), 201);
  });

  app.get("/v1/conversations", async (c) => {
    const denied = requireScope(c, "conversations:read");
    if (denied) return denied;
    const query = ListConversationsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid query parameters");
    }
    const auth = c.get("apiKeyAuth");
    const rows = await listConversations(bundle.db, { tenantId: auth.tenantId }, query.data);
    const body = ConversationListResponseSchema.parse({
      conversations: rows.map((row) => serializeConversation(row)),
    });
    return c.json(body);
  });

  app.get("/v1/conversations/:id/messages", async (c) => {
    const denied = requireScope(c, "conversations:read");
    if (denied) return denied;
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    }
    const query = ListMessagesQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid query parameters");
    }
    const auth = c.get("apiKeyAuth");
    // Jalur mesin: membaca riwayat TIDAK menandai percakapan terbaca —
    // itu semantik khusus inbox manusia (perbaikan QA-1).
    const rows = await listMessages(bundle.db, { tenantId: auth.tenantId }, id, query.data);
    if (!rows) return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    const body = MessageListResponseSchema.parse({
      messages: rows.map(serializeMessage),
    });
    return c.json(body);
  });

  app.post("/v1/conversations/:id/messages", async (c) => {
    const denied = requireScope(c, "messages:write");
    if (denied) return denied;
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = SendMessageRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid message payload");
    }
    const auth = c.get("apiKeyAuth");
    const result = await queueOutboundMessageForApiKey(
      bundle.db,
      { tenantId: auth.tenantId },
      id,
      parsed.data,
      auth.apiKey.id,
    );
    if (result.kind === "conversation_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    }
    if (result.kind === "reply_target_invalid") {
      // Fase 7B.5: paritas dengan endpoint balas dashboard.
      return apiError(
        c,
        422,
        "MESSAGE_REPLY_TARGET_INVALID",
        "Reply target must be a message in this conversation",
      );
    }
    const queued = result.message;

    // Jalur pengiriman sama persis dengan balasan dashboard: Fase 6G
    // menerbitkan nudge `message.queued` — apps/realtime mem-flush ke
    // pengunjung webchat yang terhubung (→ `sent`); selain itu pesan
    // tetap `queued` sampai pengunjung reconnect / poller Telegram.
    if (publisher) {
      await publisher.publishNudge({
        kind: "message.queued",
        tenantId: auth.tenantId,
        conversationId: id,
      });
    }
    return c.json(serializeMessage(queued), 201);
  });

  app.get("/v1/products", async (c) => {
    const denied = requireScope(c, "products:read");
    if (denied) return denied;
    const auth = c.get("apiKeyAuth");
    const rows = await listProducts(bundle.db, { tenantId: auth.tenantId });
    const body = ProductListResponseSchema.parse({
      products: rows.map(serializeProduct),
    });
    return c.json(body);
  });

  return app;
}
