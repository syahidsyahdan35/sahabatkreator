import { Hono } from "hono";
import { z } from "zod";
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  ConversationStatusSchema,
  MessageListResponseSchema,
  SendMessageRequestSchema,
  type ConversationResponse,
} from "@sahabat-kreator/contracts";
import {
  getConversationDeliveryTarget,
  listConversations,
  listMessages,
  markOutboundMessageSent,
  queueOutboundMessage,
  type ConversationWithSummary,
} from "@sahabat-kreator/core";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { serializeMessage } from "../messages-serialize";
import type { WebchatHub } from "../webchat/hub";
import { resolveTenantForUser } from "../tenants/guard";

function serializeConversation(row: ConversationWithSummary): ConversationResponse {
  return ConversationResponseSchema.parse({
    id: row.id,
    channelAccountId: row.channelAccountId,
    contactId: row.contactId,
    contactName: row.contactName,
    provider: row.provider,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    agentEnabled: row.agentEnabled,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

const ListConversationsQuerySchema = z.object({
  status: ConversationStatusSchema.optional(),
});

const ListMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Modul inbox (Fase 1D) — route bersarang di workspace:
 *   GET  /tenants/:tenantId/conversations                 daftar + nama kontak + cuplikan pesan terakhir (?status=)
 *   GET  /tenants/:tenantId/conversations/:id/messages    pesan kronologis (?limit=)
 *   POST /tenants/:tenantId/conversations/:id/messages    balasan manual → pesan outbound status `queued`
 * POST adalah fondasi inbox manual: pesan diantrekan + diaudit
 * (message.queued). Sejak Fase 1F, untuk percakapan WEBCHAT API langsung
 * mencoba mengirim lewat hub WebSocket: pengunjung yang sedang terhubung
 * menerima saat itu juga dan status menjadi `sent`; pengunjung offline
 * tetap `queued` dan terkirim saat ia connect berikutnya. Channel lain
 * tetap `queued` sampai adapter channel-nya tiba.
 * Wajib sesi + membership (pola Fase 1B/1D).
 */
export function createInboxRoutes(bundle: AuthBundle | null, webchatHub?: WebchatHub) {
  const app = new Hono<{ Variables: AppVariables }>();
  const base = "/tenants/:tenantId/conversations";

  if (!bundle) {
    app.get(base, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    app.get(`${base}/:id/messages`, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    app.post(`${base}/:id/messages`, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    return app;
  }

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  app.get(base, async (c) => {
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), c.get("appUser").id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const query = ListConversationsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid query parameters");
    }
    const rows = await listConversations(bundle.db, { tenantId: tenant.id }, query.data);
    const body = ConversationListResponseSchema.parse({
      conversations: rows.map(serializeConversation),
    });
    return c.json(body);
  });

  app.get(`${base}/:id/messages`, async (c) => {
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), c.get("appUser").id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    }
    const query = ListMessagesQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid query parameters");
    }
    const rows = await listMessages(bundle.db, { tenantId: tenant.id }, id, query.data);
    if (!rows) return apiError(c, 404, "NOT_FOUND", "Conversation not found");
    const body = MessageListResponseSchema.parse({
      messages: rows.map(serializeMessage),
    });
    return c.json(body);
  });

  app.post(`${base}/:id/messages`, async (c) => {
    const appUser = c.get("appUser");
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), appUser.id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
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
    const queued = await queueOutboundMessage(
      bundle.db,
      { tenantId: tenant.id, userId: appUser.id },
      id,
      parsed.data,
    );
    if (!queued) return apiError(c, 404, "NOT_FOUND", "Conversation not found");

    // Fase 1F: coba kirim sungguhan untuk channel webchat lewat hub WS.
    let message = queued;
    if (webchatHub) {
      const target = await getConversationDeliveryTarget(
        bundle.db,
        { tenantId: tenant.id },
        id,
      );
      if (target?.provider === "webchat") {
        const delivered = webchatHub.deliverMessage(id, serializeMessage(queued));
        if (delivered > 0) {
          const sent = await markOutboundMessageSent(
            bundle.db,
            { tenantId: tenant.id },
            queued.id,
            "webchat-hub",
          );
          if (sent) message = sent;
        }
      }
    }
    return c.json(serializeMessage(message), 201);
  });

  return app;
}
