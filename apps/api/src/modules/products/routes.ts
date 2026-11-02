import { Hono } from "hono";
import { z } from "zod";
import {
  CreatePaymentLinkRequestSchema,
  CreateProductRequestSchema,
  PaymentLinkListResponseSchema,
  PaymentLinkResponseSchema,
  ProductListResponseSchema,
  ProductResponseSchema,
  UpdateProductRequestSchema,
  type PaymentLinkResponse,
  type ProductResponse,
} from "@sahabat-kreator/contracts";
import {
  buildPaymentUrl,
  createPaymentLink,
  createProduct,
  deleteProduct,
  getContact,
  getProduct,
  listPaymentLinks,
  listProducts,
  updateProduct,
  type PaymentLinkWithNames,
} from "@sahabat-kreator/core";
import type { Product } from "@sahabat-kreator/db";
import type { AuthBundle } from "../../auth";
import { apiError, type AppContext, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { resolveTenantForUser } from "../tenants/guard";

export interface ProductsModuleOptions {
  /** Base URL publik aplikasi (env BETTER_AUTH_URL) untuk merangkai url tautan bayar. */
  publicBaseUrl?: string;
}

export function serializeProduct(row: Product): ProductResponse {
  return ProductResponseSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    priceIdr: row.priceIdr,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Modul products (Fase 4A) — katalog produk + tautan bayar per workspace:
 *   POST   /tenants/:tenantId/products          buat produk → 201
 *   GET    /tenants/:tenantId/products          daftar produk
 *   PATCH  /tenants/:tenantId/products/:id      ubah produk
 *   DELETE /tenants/:tenantId/products/:id      hapus → 204; 409
 *          PRODUCT_HAS_LINKS bila produk sudah punya tautan bayar
 *   POST   /tenants/:tenantId/payment-links     buat tautan bayar → 201
 *   GET    /tenants/:tenantId/payment-links     daftar tautan terbaru
 * Wajib sesi + membership workspace (non-member → 404 TENANT_NOT_FOUND).
 * Tautan bayar fase ini ber-provider 'simulation' — halaman publiknya di
 * modul `pay`. Logika domain di @sahabat-kreator/core (products.ts).
 */
export function createProductsRoutes(
  bundle: AuthBundle | null,
  opts: ProductsModuleOptions,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  const productsBase = "/tenants/:tenantId/products";
  const linksBase = "/tenants/:tenantId/payment-links";

  if (!bundle) {
    const notConfigured = (c: Parameters<typeof apiError>[0]) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured");
    app.post(productsBase, notConfigured);
    app.get(productsBase, notConfigured);
    app.patch(`${productsBase}/:id`, notConfigured);
    app.delete(`${productsBase}/:id`, notConfigured);
    app.post(linksBase, notConfigured);
    app.get(linksBase, notConfigured);
    return app;
  }

  const serializeLink = (row: PaymentLinkWithNames): PaymentLinkResponse =>
    PaymentLinkResponseSchema.parse({
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      contactId: row.contactId,
      contactName: row.contactName,
      conversationId: row.conversationId,
      code: row.code,
      url: buildPaymentUrl(opts.publicBaseUrl, row.code),
      amountIdr: row.amountIdr,
      status: row.status,
      provider: row.provider,
      paidAt: row.paidAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });

  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  const resolveTenant = async (c: AppContext) =>
    resolveTenantForUser(
      bundle,
      c.req.param("tenantId") ?? "",
      c.get("appUser").id,
    );

  const parseJson = async (c: AppContext): Promise<unknown | null> => {
    try {
      return await c.req.json();
    } catch {
      return null;
    }
  };

  // ------------------------------------------------------------- products
  app.post(productsBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const json = await parseJson(c);
    if (json === null) {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreateProductRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid product payload");
    }
    const created = await createProduct(
      bundle.db,
      { tenantId: tenant.id },
      parsed.data,
    );
    return c.json(serializeProduct(created), 201);
  });

  app.get(productsBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listProducts(bundle.db, { tenantId: tenant.id });
    return c.json(
      ProductListResponseSchema.parse({ products: rows.map(serializeProduct) }),
    );
  });

  app.patch(`${productsBase}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Product not found");
    }
    const json = await parseJson(c);
    if (json === null) {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = UpdateProductRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid product payload");
    }
    const updated = await updateProduct(
      bundle.db,
      { tenantId: tenant.id },
      id,
      parsed.data,
    );
    if (!updated) return apiError(c, 404, "NOT_FOUND", "Product not found");
    return c.json(serializeProduct(updated));
  });

  app.delete(`${productsBase}/:id`, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) {
      return apiError(c, 404, "NOT_FOUND", "Product not found");
    }
    const result = await deleteProduct(bundle.db, { tenantId: tenant.id }, id);
    if (result === "not_found") {
      return apiError(c, 404, "NOT_FOUND", "Product not found");
    }
    if (result === "has_links") {
      return apiError(
        c,
        409,
        "PRODUCT_HAS_LINKS",
        "Product already has payment links; deactivate it instead of deleting",
      );
    }
    return c.body(null, 204);
  });

  // --------------------------------------------------------- payment-links
  app.post(linksBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const json = await parseJson(c);
    if (json === null) {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = CreatePaymentLinkRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid payment link payload");
    }
    const result = await createPaymentLink(
      bundle.db,
      { tenantId: tenant.id },
      parsed.data,
      { actorType: "user", actorId: c.get("appUser").id },
    );
    if (result.kind === "product_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Product not found");
    }
    if (result.kind === "contact_not_found") {
      return apiError(c, 404, "NOT_FOUND", "Contact not found");
    }
    // Rangkai respons dari baris yang baru dibuat + nama produk/kontak.
    const product = await getProduct(bundle.db, { tenantId: tenant.id }, result.link.productId);
    const contact = result.link.contactId
      ? await getContact(bundle.db, { tenantId: tenant.id }, result.link.contactId)
      : null;
    return c.json(
      serializeLink({
        ...result.link,
        productName: product?.name ?? "",
        contactName: contact?.name ?? null,
      }),
      201,
    );
  });

  app.get(linksBase, async (c) => {
    const tenant = await resolveTenant(c);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    const rows = await listPaymentLinks(bundle.db, { tenantId: tenant.id });
    return c.json(
      PaymentLinkListResponseSchema.parse({
        paymentLinks: rows.map(serializeLink),
      }),
    );
  });

  return app;
}
