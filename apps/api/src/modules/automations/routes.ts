import { Hono } from "hono";
import { z } from "zod";
import {
  AutomationListResponseSchema,
  AutomationResponseSchema,
  AutomationRunListResponseSchema,
  AutomationRunResponseSchema,
  CreateAutomationRequestSchema,
  UpdateAutomationRequestSchema,
  type AutomationResponse,
  type AutomationRunResponse,
} from "@sahabat-kreator/contracts";
import {
  createAutomation,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
  type AutomationWithRunCount,
} from "@sahabat-kreator/core";
import type { AutomationRun } from "@sahabat-kreator/db";
import type { AuthBundle } from "../../auth";
import { apiError, type AppContext, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

function serializeAutomation(row: AutomationWithRunCount): AutomationResponse {
  return AutomationResponseSchema.parse({
    id: row.id,
    name: row.name,
    triggerType: row.triggerType,
    keywords: row.triggerConfig.keywords,
    match: row.triggerConfig.match,
    actionType: row.actionType,
    text: row.actionConfig.text,
    isActive: row.isActive,
    runCount: row.runCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function serializeRun(row: AutomationRun): AutomationRunResponse {
  return AutomationRunResponseSchema.parse({
    id: row.id,
    automationId: row.automationId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    status: row.status,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * Modul automations (Fase 2A) — manajemen automation keyword workspace:
 *   POST  /tenants/:tenantId/automations            buat → 201
 *   GET   /tenants/:tenantId/automations            daftar + jumlah run
 *   PATCH /tenants/:tenantId/automations/:id        ubah isActive/name/keywords/match/text
 *   GET   /tenants/:tenantId/automations/:id/runs   riwayat eksekusi terbaru
 * Wajib sesi + membership workspace (non-member → 404 TENANT_NOT_FOUND,
 * pola Fase 1B/1D). Eksekusi automation sendiri berjalan di worker
 * (job `automation.evaluate`), bukan di proses API ini.
 */
export function createAutomationsRoutes(bundle: AuthBundle | null) {
  const app = new Hono<{ Variables: AppVariables }>();
  const base = "/tenants/:tenantId/automations";

  if (!bundle) {
    const notConfigured = (c: Parameters<typeof apiError>[0]) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    app.post(base, notConfigured);
    app.get(base, notConfigured);
    app.patch(`${base}/:id`, notConfigured);
    app.get(`${base}/:id/runs`, notConfigured);
    return app;
  }

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  const resolveTenant = async (c: AppContext) =>
    resolveTenantForUser(
      bundle,
      c.req.param("tenantId") ?? "",
      c.get("appUser").id,
    );

  app.post(base, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreateAutomationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid automation payload");
    }
    const created = await createAutomation(
      bundle.db,
      { tenantId: tenant.id },
      parsed.data,
    );
    return c.json(serializeAutomation({ ...created, runCount: 0 }), 201);
  });

  app.get(base, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listAutomations(bundle.db, { tenantId: tenant.id });
    const body = AutomationListResponseSchema.parse({
      automations: rows.map(serializeAutomation),
    });
    return c.json(body);
  });

  app.patch(`${base}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Automation not found");
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = UpdateAutomationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid automation payload");
    }
    const updated = await updateAutomation(
      bundle.db,
      { tenantId: tenant.id },
      id,
      parsed.data,
    );
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Automation not found");
    const rows = await listAutomations(bundle.db, { tenantId: tenant.id });
    const withCount =
      rows.find((r) => r.id === updated.id) ?? { ...updated, runCount: 0 };
    return c.json(serializeAutomation(withCount));
  });

  app.get(`${base}/:id/runs`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Automation not found");
    }
    const runs = await listAutomationRuns(
      bundle.db,
      { tenantId: tenant.id },
      id,
      { limit: 50 },
    );
    if (!runs) return apiError(c, 404, "NOT_FOUND", "Automation not found");
    const body = AutomationRunListResponseSchema.parse({
      runs: runs.map(serializeRun),
    });
    return c.json(body);
  });

  return app;
}
