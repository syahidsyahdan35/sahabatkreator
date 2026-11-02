import { Hono } from "hono";
import { z } from "zod";
import {
  AgentListResponseSchema,
  AgentResponseSchema,
  AgentSuggestionListResponseSchema,
  AgentSuggestionResponseSchema,
  AgentSuggestionStatusSchema,
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
  type AgentResponse,
  type AgentSuggestionResponse,
} from "@sahabat-kreator/contracts";
import {
  approveSuggestion,
  createAgent,
  listAgents,
  listSuggestions,
  rejectSuggestion,
  updateAgent,
} from "@sahabat-kreator/core";
import type { Agent, AgentSuggestion } from "@sahabat-kreator/db";
import type { RealtimePublisher } from "@sahabat-kreator/queue";
import type { AuthBundle } from "../../auth";
import { apiError, type AppContext, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

function serializeAgent(row: Agent): AgentResponse {
  return AgentResponseSchema.parse({
    id: row.id,
    name: row.name,
    systemPrompt: row.systemPrompt,
    model: row.model,
    mode: row.mode,
    isActive: row.isActive,
    config: row.config,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function serializeSuggestion(row: AgentSuggestion): AgentSuggestionResponse {
  return AgentSuggestionResponseSchema.parse({
    id: row.id,
    agentId: row.agentId,
    conversationId: row.conversationId,
    triggerMessageId: row.triggerMessageId,
    contactId: row.contactId,
    suggestedText: row.suggestedText,
    status: row.status,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Modul agents (Fase 3A) — manajemen agent AI workspace + antrean draf
 * balasan mode 'suggest':
 *   POST  /tenants/:tenantId/agents                  buat → 201
 *   GET   /tenants/:tenantId/agents                  daftar
 *   PATCH /tenants/:tenantId/agents/:id              ubah name/systemPrompt/model/mode/isActive/config
 *   GET   /tenants/:tenantId/suggestions?status=     draf balasan agent
 *   POST  /tenants/:tenantId/suggestions/:id/approve kirim teks saran sbg pesan agent
 *   POST  /tenants/:tenantId/suggestions/:id/reject  tolak draf
 * Wajib sesi + membership workspace (non-member → 404 TENANT_NOT_FOUND,
 * pola Fase 1B/1D). Runtime agent berjalan di worker (job `agent.respond`),
 * bukan di proses API ini.
 */
export function createAgentsRoutes(
  bundle: AuthBundle | null,
  publisher?: RealtimePublisher | null,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  const agentsBase = "/tenants/:tenantId/agents";
  const suggestionsBase = "/tenants/:tenantId/suggestions";

  if (!bundle) {
    const notConfigured = (c: Parameters<typeof apiError>[0]) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    app.post(agentsBase, notConfigured);
    app.get(agentsBase, notConfigured);
    app.patch(`${agentsBase}/:id`, notConfigured);
    app.get(suggestionsBase, notConfigured);
    app.post(`${suggestionsBase}/:id/approve`, notConfigured);
    app.post(`${suggestionsBase}/:id/reject`, notConfigured);
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

  const parseJson = async (c: AppContext): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  };

  app.post(agentsBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const json = await parseJson(c);
    if (json === undefined) {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreateAgentRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid agent payload");
    }
    const created = await createAgent(
      bundle.db,
      { tenantId: tenant.id },
      parsed.data,
    );
    return c.json(serializeAgent(created), 201);
  });

  app.get(agentsBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listAgents(bundle.db, { tenantId: tenant.id });
    const body = AgentListResponseSchema.parse({
      agents: rows.map(serializeAgent),
    });
    return c.json(body);
  });

  app.patch(`${agentsBase}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Agent not found");
    }
    const json = await parseJson(c);
    if (json === undefined) {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = UpdateAgentRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid agent payload");
    }
    const updated = await updateAgent(
      bundle.db,
      { tenantId: tenant.id },
      id,
      parsed.data,
    );
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Agent not found");
    return c.json(serializeAgent(updated));
  });

  app.get(suggestionsBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const statusRaw = c.req.query("status");
    let status: AgentSuggestion["status"] | undefined;
    if (statusRaw !== undefined) {
      const statusParsed = AgentSuggestionStatusSchema.safeParse(statusRaw);
      if (!statusParsed.success) {
        return apiError(c, 400, "VALIDATION_ERROR", "Invalid status filter");
      }
      status = statusParsed.data;
    }
    const rows = await listSuggestions(
      bundle.db,
      { tenantId: tenant.id },
      { status, limit: 100 },
    );
    const body = AgentSuggestionListResponseSchema.parse({
      suggestions: rows.map(serializeSuggestion),
    });
    return c.json(body);
  });

  app.post(`${suggestionsBase}/:id/approve`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Suggestion not found");
    }
    const outcome = await approveSuggestion(
      bundle.db,
      { tenantId: tenant.id, userId: c.get("appUser").id },
      id,
    );
    if (outcome.kind === "not_found") {
      return apiError(c, 404, "NOT_FOUND", "Suggestion not found");
    }
    if (outcome.kind === "not_pending") {
      return apiError(
        c,
        400,
        "VALIDATION_ERROR",
        "Suggestion is not pending",
      );
    }
    // Fase 6G: approve mengirim pesan outbound sungguhan — nudge agar
    // realtime mem-flush ke pengunjung webchat & dashboard menyegar.
    if (publisher) {
      await publisher.publishNudge({
        kind: "message.queued",
        tenantId: tenant.id,
        conversationId: outcome.suggestion.conversationId,
      });
    }
    return c.json(serializeSuggestion(outcome.suggestion));
  });

  app.post(`${suggestionsBase}/:id/reject`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Suggestion not found");
    }
    const outcome = await rejectSuggestion(
      bundle.db,
      { tenantId: tenant.id, userId: c.get("appUser").id },
      id,
    );
    if (outcome.kind === "not_found") {
      return apiError(c, 404, "NOT_FOUND", "Suggestion not found");
    }
    if (outcome.kind === "not_pending") {
      return apiError(
        c,
        400,
        "VALIDATION_ERROR",
        "Suggestion is not pending",
      );
    }
    return c.json(serializeSuggestion(outcome.suggestion));
  });

  return app;
}
