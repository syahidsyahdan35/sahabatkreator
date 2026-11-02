import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  channelAccounts,
  type ChannelAccount,
  type Database,
} from "@sahabat-kreator/db";

/** Provider channel (nilai enum `channel_provider` di skema db). */
export type ChannelProviderName = ChannelAccount["provider"];
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

/** Satu akun channel milik tenant ini (baris penuh, termasuk kredensial
 * terenkripsi — hanya untuk pemakaian server internal seperti disconnect;
 * JANGAN pernah diserialisasi ke respons API). Null bila tak ditemukan. */
export async function getChannelAccount(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  channelAccountId: string,
): Promise<ChannelAccount | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.tenantId, ctx.tenantId),
          eq(channelAccounts.id, channelAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

export type ChannelAccountLookupRef = Pick<
  ChannelAccount,
  "id" | "tenantId" | "provider" | "externalId" | "status"
>;

/**
 * Lookup akun channel berdasarkan (provider, external_id) di SEMUA tenant
 * — fondasi penjaga "satu bot = satu koneksi" (hotfix Telegram): satu bot
 * Telegram hanya punya SATU webhook, jadi bot yang sama tidak boleh aktif
 * di dua workspace sekaligus.
 *
 * Berjalan TANPA konteks tenant: transaksi men-set `app.channel_provider`
 * + `app.channel_external_id`, dan policy RLS `provider_external_lookup`
 * (migrasi 0020) hanya membuka baris yang (provider, external_id)-nya
 * PERSIS pasangan itu. Pemanggil harus sudah mengetahui external_id dari
 * sumber tepercaya (untuk Telegram: hasil `getMe` atas token yang
 * diserahkan pemilik workspace) — yang terbuka pun hanya id/tenant/status
 * baris itu, dan respons API ke pengguna TIDAK pernah menyebut tenant
 * pemiliknya. Mengembalikan SEMUA baris pasangan itu (termasuk yang
 * 'disconnected', yang tidak menghalangi koneksi baru).
 */
export async function lookupChannelAccountsByProviderExternalId(
  db: Database,
  provider: ChannelProviderName,
  externalId: string,
): Promise<ChannelAccountLookupRef[]> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.channel_provider', ${provider}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.channel_external_id', ${externalId}, true)`,
    );
    return tx
      .select({
        id: channelAccounts.id,
        tenantId: channelAccounts.tenantId,
        provider: channelAccounts.provider,
        externalId: channelAccounts.externalId,
        status: channelAccounts.status,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.provider, provider),
          eq(channelAccounts.externalId, externalId),
        ),
      );
  });
}

export interface DisconnectChannelContext {
  tenantId: string;
  /** Jejak audit: 'user' untuk aksi dari dashboard, 'system' untuk remediasi. */
  actorType: "user" | "system";
  actorId: string;
}

/**
 * Memutuskan koneksi channel (hotfix Telegram — fitur disconnect):
 * status → 'disconnected' dan kredensial provider DIKOSONGKAN (token
 * terenkripsi + hash secret webhook) agar baris yang tertinggal tidak
 * lagi bisa mengirim/menerima apa pun. Percakapan & pesan TIDAK disentuh
 * — disconnect bukan penghapusan data; riwayat tetap terbaca di inbox.
 *
 * Idempoten: akun yang sudah 'disconnected' dikembalikan apa adanya
 * tanpa audit ganda. Pencabutan webhook di sisi provider (Telegram
 * deleteWebhook) adalah urusan pemanggil SEBELUM fungsi ini, karena
 * hanya pemanggil yang tahu apakah akun ini pemilik webhook saat ini.
 * Mengembalikan null bila akun tak ditemukan di tenant ini.
 */
export async function disconnectChannelAccount(
  db: Database,
  ctx: DisconnectChannelContext,
  channelAccountId: string,
  meta: Record<string, unknown> = {},
): Promise<ChannelAccount | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.tenantId, ctx.tenantId),
          eq(channelAccounts.id, channelAccountId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.status === "disconnected") return row;

    const [updated] = await tx
      .update(channelAccounts)
      .set({
        status: "disconnected",
        accessTokenEncrypted: null,
        webhookSecret: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(channelAccounts.tenantId, ctx.tenantId),
          eq(channelAccounts.id, channelAccountId),
        ),
      )
      .returning();

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: "channel.disconnected",
      meta: {
        channelAccountId: row.id,
        provider: row.provider,
        ...meta,
      },
    });

    return updated;
  });
}

export interface UpdateTelegramCredentialsInput {
  /** Envelope enkripsi token bot baru; null = jangan ubah. */
  encryptedBotToken?: string | null;
  /** Hash SHA-256 secret webhook baru; null = jangan ubah. */
  webhookSecretHash?: string | null;
  botUsername?: string | null;
  displayName?: string | null;
  status?: ChannelAccount["status"];
}

/**
 * Menulis ulang kredensial/status akun Telegram yang SUDAH ada di tenant
 * ini — dipakai jalur "revive" saat connect: akun tenant yang sama
 * berstatus 'disconnected'/'error' dihubungkan lagi tanpa membuat baris
 * duplikat (index unik (tenant, provider, external_id) melarang baris
 * kedua), dan untuk rotasi hash secret webhook. Mengembalikan baris
 * terbaru, atau null bila akun tak ditemukan.
 */
export async function updateTelegramChannelAccountCredentials(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  channelAccountId: string,
  input: UpdateTelegramCredentialsInput,
): Promise<ChannelAccount | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const patch: Partial<ChannelAccount> = { updatedAt: new Date() };
    if (input.encryptedBotToken !== undefined) {
      patch.accessTokenEncrypted = input.encryptedBotToken;
    }
    if (input.webhookSecretHash !== undefined) {
      patch.webhookSecret = input.webhookSecretHash;
    }
    if (input.botUsername !== undefined) patch.botUsername = input.botUsername;
    if (input.displayName !== undefined) {
      patch.displayName = input.displayName;
    }
    if (input.status !== undefined) patch.status = input.status;

    const [row] = await tx
      .update(channelAccounts)
      .set(patch)
      .where(
        and(
          eq(channelAccounts.tenantId, ctx.tenantId),
          eq(channelAccounts.id, channelAccountId),
        ),
      )
      .returning();
    return row ?? null;
  });
}
