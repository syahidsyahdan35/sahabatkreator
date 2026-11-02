import { Hono } from "hono";
import { z } from "zod";
import {
  IntegrationLogDetailResponseSchema,
  IntegrationLogListQuerySchema,
  IntegrationLogListResponseSchema,
  IntegrationLogResponseSchema,
  type IntegrationLogDetailResponse,
  type IntegrationLogListQuery,
  type IntegrationLogResponse,
} from "@sahabat-kreator/contracts";
import {
  getIntegrationLog,
  getUnresolvedIntegrationLog,
  isPlatformAdminEmail,
  listIntegrationLogs,
  listUnresolvedIntegrationLogs,
  type ListIntegrationLogsInput,
} from "@sahabat-kreator/core";
import type { IntegrationLogRow } from "@sahabat-kreator/db";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

export interface LogsRoutesOptions {
  /** Allowlist mentah env PLATFORM_ADMIN_EMAILS (koma-terpisah). */
  platformAdminEmails?: string;
}

function serializeLog(row: IntegrationLogRow): IntegrationLogResponse {
  return IntegrationLogResponseSchema.parse({
    id: row.id,
    direction: row.direction,
    provider: row.provider,
    tenantId: row.tenantId,
    channelAccountId: row.channelAccountId,
    messageId: row.messageId,
    signatureValid: row.signatureValid,
    outcome: row.outcome,
    errorCode: row.errorCode,
    summary: row.summary,
    hasPayload: row.payload !== null && row.payload !== undefined,
    createdAt: row.createdAt.toISOString(),
  });
}

function serializeLogDetail(row: IntegrationLogRow): IntegrationLogDetailResponse {
  return IntegrationLogDetailResponseSchema.parse({
    ...serializeLog(row),
    payload: row.payload ?? null,
  });
}

function toListInput(query: IntegrationLogListQuery): ListIntegrationLogsInput {
  return {
    provider: query.provider,
    direction: query.direction,
    outcome: query.outcome,
    channelAccountId: query.channelAccountId,
    cursor: query.cursor,
    limit: query.limit,
  };
}

/**
 * Modul log integrasi (Fase 7B.1) — pembacaan tabel `integration_log`:
 *   GET /tenants/:tenantId/logs              daftar log tenant (tanpa payload)
 *   GET /tenants/:tenantId/logs/:logId       detail (payload tersimpan)
 *   GET /logs/unresolved                     baris platform (tenant NULL)
 *   GET /logs/unresolved/:logId              detail baris platform
 *
 * AKSES (payload memuat isi pesan pelanggan — sensitif):
 * - Route tenant: sesi + membership; non-member 404 TENANT_NOT_FOUND
 *   (pola Fase 1B). Membaca dibatasi role OWNER/ADMIN — member biasa
 *   (agent/viewer) mendapat 403 FORBIDDEN, lebih ketat dari daftar
 *   API key (5A) yang boleh dibaca semua member.
 * - Route unresolved: baris tak ber-tenant (akun tak dikenal dst.) hanya
 *   untuk sesi PLATFORM ADMIN (allowlist env PLATFORM_ADMIN_EMAILS);
 *   non-admin 404 NOT_FOUND agar eksistensinya tidak dibocorkan (pola
 *   Panel Admin 6C). Baris ini di luar tenant mana pun — tidak ada
 *   konteks tenant yang bisa membukanya.
 * Penulisan log terjadi di route webhook & poller (core
 * `recordIntegrationLog`, best-effort) — modul ini murni membaca.
 */
export function createLogsRoutes(
  bundle: AuthBundle | null,
  opts: LogsRoutesOptions = {},
) {
  const app = new Hono<{ Variables: AppVariables }>();
  const tenantBase = "/tenants/:tenantId/logs";

  if (!bundle) {
    app.get(tenantBase, (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get(`${tenantBase}/:logId`, (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get("/logs/unresolved", (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get("/logs/unresolved/:logId", (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    return app;
  }

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);
  app.use("/logs/*", auth);

  app.get(tenantBase, async (c) => {
    const appUser = c.get("appUser");
    const tenant = await resolveTenantForUser(
      bundle,
      c.req.param("tenantId"),
      appUser.id,
    );
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.role !== "owner" && tenant.role !== "admin") {
      return apiError(
        c,
        403,
        "FORBIDDEN",
        "Only workspace owners and admins can view integration logs",
      );
    }
    const parsed = IntegrationLogListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid log list query");
    }
    const page = await listIntegrationLogs(
      bundle.db,
      tenant.id,
      toListInput(parsed.data),
    );
    const body = IntegrationLogListResponseSchema.parse({
      logs: page.logs.map(serializeLog),
      nextCursor: page.nextCursor,
    });
    return c.json(body);
  });

  app.get(`${tenantBase}/:logId`, async (c) => {
    const appUser = c.get("appUser");
    const tenant = await resolveTenantForUser(
      bundle,
      c.req.param("tenantId"),
      appUser.id,
    );
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.role !== "owner" && tenant.role !== "admin") {
      return apiError(
        c,
        403,
        "FORBIDDEN",
        "Only workspace owners and admins can view integration logs",
      );
    }
    const logId = c.req.param("logId");
    if (!z.string().uuid().safeParse(logId).success) {
      return apiError(c, 404, "NOT_FOUND", "Log entry not found");
    }
    const row = await getIntegrationLog(bundle.db, tenant.id, logId);
    if (!row) return apiError(c, 404, "NOT_FOUND", "Log entry not found");
    return c.json(serializeLogDetail(row));
  });

  app.get("/logs/unresolved", async (c) => {
    const appUser = c.get("appUser");
    if (!isPlatformAdminEmail(appUser.email, opts.platformAdminEmails)) {
      return apiError(c, 404, "NOT_FOUND", "Not found");
    }
    const parsed = IntegrationLogListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid log list query");
    }
    const page = await listUnresolvedIntegrationLogs(
      bundle.db,
      toListInput(parsed.data),
    );
    const body = IntegrationLogListResponseSchema.parse({
      logs: page.logs.map(serializeLog),
      nextCursor: page.nextCursor,
    });
    return c.json(body);
  });

  app.get("/logs/unresolved/:logId", async (c) => {
    const appUser = c.get("appUser");
    if (!isPlatformAdminEmail(appUser.email, opts.platformAdminEmails)) {
      return apiError(c, 404, "NOT_FOUND", "Not found");
    }
    const logId = c.req.param("logId");
    if (!z.string().uuid().safeParse(logId).success) {
      return apiError(c, 404, "NOT_FOUND", "Log entry not found");
    }
    const row = await getUnresolvedIntegrationLog(bundle.db, logId);
    if (!row) return apiError(c, 404, "NOT_FOUND", "Log entry not found");
    return c.json(serializeLogDetail(row));
  });

  return app;
}
