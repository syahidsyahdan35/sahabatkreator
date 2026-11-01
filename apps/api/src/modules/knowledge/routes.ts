import { Hono } from "hono";
import { z } from "zod";
import {
  CreateKbDocumentRequestSchema,
  KbDocumentListResponseSchema,
  KbDocumentResponseSchema,
  type KbDocumentResponse,
} from "@sahabat-kreator/contracts";
import {
  createKbDocument,
  deleteKbDocument,
  getKbDocument,
  listKbDocuments,
  type KbDocumentWithChunkCount,
} from "@sahabat-kreator/core";
import type { AuthBundle } from "../../auth";
import { apiError, type AppContext, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

function serializeDocument(row: KbDocumentWithChunkCount): KbDocumentResponse {
  return KbDocumentResponseSchema.parse({
    id: row.id,
    title: row.title,
    content: row.content,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Modul knowledge (Fase 3A) — basis pengetahuan agent per workspace:
 *   POST   /tenants/:tenantId/kb/documents        buat dokumen (+ chunking) → 201
 *   GET    /tenants/:tenantId/kb/documents        daftar + jumlah chunk
 *   GET    /tenants/:tenantId/kb/documents/:id    satu dokumen + jumlah chunk
 *   DELETE /tenants/:tenantId/kb/documents/:id    hapus (chunk ikut cascade) → 204
 * Wajib sesi + membership workspace (non-member → 404 TENANT_NOT_FOUND).
 * Retrieval-nya sendiri berjalan di worker saat agent menjawab
 * (full-text Postgres — lihat @sahabat-kreator/core kb.ts).
 */
export function createKnowledgeRoutes(bundle: AuthBundle | null) {
  const app = new Hono<{ Variables: AppVariables }>();
  const base = "/tenants/:tenantId/kb/documents";

  if (!bundle) {
    const notConfigured = (c: Parameters<typeof apiError>[0]) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    app.post(base, notConfigured);
    app.get(base, notConfigured);
    app.get(`${base}/:id`, notConfigured);
    app.delete(`${base}/:id`, notConfigured);
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
    const parsed = CreateKbDocumentRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid knowledge document payload");
    }
    const created = await createKbDocument(
      bundle.db,
      { tenantId: tenant.id },
      parsed.data,
    );
    return c.json(serializeDocument(created), 201);
  });

  app.get(base, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listKbDocuments(bundle.db, { tenantId: tenant.id });
    const body = KbDocumentListResponseSchema.parse({
      documents: rows.map(serializeDocument),
    });
    return c.json(body);
  });

  app.get(`${base}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Knowledge document not found");
    }
    const doc = await getKbDocument(bundle.db, { tenantId: tenant.id }, id);
    if (!doc) return apiError(c, 404, "NOT_FOUND", "Knowledge document not found");
    return c.json(serializeDocument(doc));
  });

  app.delete(`${base}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Knowledge document not found");
    }
    const deleted = await deleteKbDocument(
      bundle.db,
      { tenantId: tenant.id },
      id,
    );
    if (!deleted) {
      return apiError(c, 404, "NOT_FOUND", "Knowledge document not found");
    }
    return c.body(null, 204);
  });

  return app;
}
