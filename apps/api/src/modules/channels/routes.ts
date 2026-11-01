import { Hono } from "hono";
import {
  ChannelAccountListResponseSchema,
  ChannelAccountResponseSchema,
  CreateChannelRequestSchema,
  type ChannelAccountResponse,
} from "@sahabat-kreator/contracts";
import {
  createWebchatChannelAccount,
  listChannelAccounts,
} from "@sahabat-kreator/core";
import type { ChannelAccount } from "@sahabat-kreator/db";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

function serializeChannel(row: ChannelAccount): ChannelAccountResponse {
  return ChannelAccountResponseSchema.parse({
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Modul channels (Fase 1F) — route bersarang di workspace:
 *   POST /tenants/:tenantId/channels   buat channel (fase ini: webchat saja)
 *   GET  /tenants/:tenantId/channels   daftar channel workspace
 * Provider selain webchat belum bisa dihubungkan → 422
 * CHANNEL_NOT_AVAILABLE_YET (jujur; koneksi Meta/Telegram tiba di fase
 * channel masing-masing). Untuk webchat, respons POST memuat siteKey di
 * `externalId` — kunci publik yang dipasang tenant di situsnya.
 * Wajib sesi + membership (pola Fase 1B/1D).
 */
export function createChannelsRoutes(bundle: AuthBundle | null) {
  const app = new Hono<{ Variables: AppVariables }>();
  const base = "/tenants/:tenantId/channels";

  if (!bundle) {
    app.get(base, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    app.post(base, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
    return app;
  }

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  app.get(base, async (c) => {
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), c.get("appUser").id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listChannelAccounts(bundle.db, { tenantId: tenant.id });
    const body = ChannelAccountListResponseSchema.parse({
      channels: rows.map(serializeChannel),
    });
    return c.json(body);
  });

  app.post(base, async (c) => {
    const appUser = c.get("appUser");
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), appUser.id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreateChannelRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid channel payload");
    }
    if (parsed.data.provider !== "webchat") {
      return apiError(
        c,
        422,
        "CHANNEL_NOT_AVAILABLE_YET",
        `Provider ${parsed.data.provider} cannot be connected yet`,
      );
    }
    const row = await createWebchatChannelAccount(
      bundle.db,
      { tenantId: tenant.id, userId: appUser.id },
      { displayName: parsed.data.displayName },
    );
    return c.json(serializeChannel(row), 201);
  });

  return app;
}
