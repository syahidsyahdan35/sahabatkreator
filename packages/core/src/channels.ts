import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  auditLogs,
  channelAccounts,
  type ChannelAccount,
  type Database,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain akun channel workspace (Fase 1F, RANCANGAN §4 & §6).
 * Transport-agnostic; semua query dalam konteks RLS tenant.
 *
 * Fase ini provider yang bisa benar-benar dibuat hanya `webchat` — channel
 * milik sendiri yang identitas publiknya adalah siteKey acak
 * (`wc_` + 24 karakter) yang dipasang tenant di situsnya. Provider Meta/
 * Telegram dibuat di fase channel masing-masing; pemanggil (API) yang
 * menjawab CHANNEL_NOT_AVAILABLE_YET untuk provider selain webchat.
 */

/** Membuat siteKey publik webchat: `wc_` + 24 karakter base64url (144 bit entropi). */
export function generateWebchatSiteKey(): string {
  return `wc_${randomBytes(18).toString("base64url")}`;
}

export async function createWebchatChannelAccount(
  db: Database,
  ctx: Pick<TenantContext, "tenantId" | "userId"> & { userId: string },
  input: { displayName?: string },
): Promise<ChannelAccount> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(channelAccounts)
      .values({
        tenantId: ctx.tenantId,
        provider: "webchat",
        externalId: generateWebchatSiteKey(),
        displayName: input.displayName ?? null,
        status: "connected",
      })
      .returning();

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "channel.created",
      meta: { channelAccountId: row.id, provider: "webchat" },
    });

    return row;
  });
}

/**
 * Mengubah status akun channel (mis. 'error' bila pendaftaran webhook ke
 * provider gagal sesudah akun dibuat — Fase 6A Telegram).
 */
export async function setChannelAccountStatus(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  channelAccountId: string,
  status: ChannelAccount["status"],
): Promise<void> {
  await withTenantDb(db, ctx.tenantId, async (tx) => {
    await tx
      .update(channelAccounts)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(channelAccounts.tenantId, ctx.tenantId),
          eq(channelAccounts.id, channelAccountId),
        ),
      );
  });
}

/** Daftar akun channel milik tenant, terlama lebih dulu. */
export async function listChannelAccounts(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
): Promise<ChannelAccount[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    return tx
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.tenantId, ctx.tenantId))
      .orderBy(asc(channelAccounts.createdAt));
  });
}
