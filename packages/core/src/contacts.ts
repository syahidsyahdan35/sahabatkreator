import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import {
  contacts,
  type Contact,
  type Database,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain kontak/audiens (Fase 1D, RANCANGAN §6).
 * Transport-agnostic; semua query berjalan dalam konteks RLS tenant
 * (`withTenantDb` → set_config('app.tenant_id')) dan sekaligus difilter
 * eksplisit tenant_id sebagai lapis kedua.
 */

export interface CreateContactInput {
  name: string;
  phone?: string;
  email?: string;
  tags?: string[];
}

export interface UpdateContactInput {
  name?: string;
  tags?: string[];
  pipelineStage?: string;
  optInStatus?: "unknown" | "opted_in" | "opted_out";
}

export interface ListContactsInput {
  search?: string;
  limit: number;
  offset: number;
}

export async function createContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: CreateContactInput,
): Promise<Contact> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        tags: input.tags ?? [],
      })
      .returning();
    return row;
  });
}

export async function listContacts(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: ListContactsInput,
): Promise<{ contacts: Contact[]; total: number }> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(contacts.tenantId, ctx.tenantId)];
    const search = input.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const found = or(
        ilike(contacts.name, pattern),
        ilike(contacts.phone, pattern),
        ilike(contacts.email, pattern),
      );
      if (found) conditions.push(found);
    }
    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.name))
      .limit(input.limit)
      .offset(input.offset);
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(where);
    return { contacts: rows, total: countRow?.count ?? 0 };
  });
}

/** Null bila kontak tidak ada DI tenant ini (API menerjemahkan ke 404). */
export async function getContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  contactId: string,
): Promise<Contact | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Null bila kontak tidak ada DI tenant ini (API menerjemahkan ke 404). */
export async function updateContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  contactId: string,
  input: UpdateContactInput,
): Promise<Contact | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const patch: Partial<Contact> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.pipelineStage !== undefined) patch.pipelineStage = input.pipelineStage;
    if (input.optInStatus !== undefined) {
      patch.optInStatus = input.optInStatus;
      // opted_in dicatat sebagai consent; opted_out mencabutnya.
      patch.consentAt = input.optInStatus === "opted_in" ? new Date() : null;
    }
    const [row] = await tx
      .update(contacts)
      .set(patch)
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)),
      )
      .returning();
    return row ?? null;
  });
}
