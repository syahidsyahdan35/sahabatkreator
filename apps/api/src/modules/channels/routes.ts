import { Hono } from "hono";
import {
  ChannelAccountListResponseSchema,
  ChannelAccountResponseSchema,
  CreateChannelRequestSchema,
  type ChannelAccountResponse,
} from "@sahabat-kreator/contracts";
import {
  createTelegramChannelAccount,
  createWebchatChannelAccount,
  encryptChannelSecret,
  generateChannelWebhookSecret,
  hashChannelWebhookSecret,
  listChannelAccounts,
  setChannelAccountStatus,
} from "@sahabat-kreator/core";
import {
  TelegramApiError,
  TelegramBotApiClient,
} from "@sahabat-kreator/channel-telegram";
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
    botUsername: row.botUsername,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export interface ChannelsModuleOptions {
  /** Material kunci enkripsi kredensial channel (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret?: string;
  /** Base URL Bot API (env TELEGRAM_API_BASE; default api.telegram.org). */
  telegramApiBase?: string;
  /** URL publik aplikasi (env BETTER_AUTH_URL) — dasar URL webhook Telegram. */
  publicBaseUrl?: string;
}

/**
 * Modul channels (Fase 1F, diperluas 6A) — route bersarang di workspace:
 *   POST /tenants/:tenantId/channels   buat channel (webchat, telegram)
 *   GET  /tenants/:tenantId/channels   daftar channel workspace
 * Provider Meta belum bisa dihubungkan → 422 CHANNEL_NOT_AVAILABLE_YET
 * (jujur; koneksi Meta tiba di fase channel-nya bersama user).
 * Untuk webchat, respons POST memuat siteKey di `externalId` — kunci
 * publik yang dipasang tenant di situsnya. Untuk telegram, token bot
 * TIDAK PERNAH muncul di respons: yang tampil hanya status + username bot.
 * Wajib sesi + membership (pola Fase 1B/1D).
 */
export function createChannelsRoutes(
  bundle: AuthBundle | null,
  opts: ChannelsModuleOptions = {},
) {
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
    if (parsed.data.provider === "telegram") {
      return connectTelegram(c, bundle, opts, {
        tenantId: tenant.id,
        userId: appUser.id,
        displayName: parsed.data.displayName,
        botToken: parsed.data.botToken,
      });
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

/**
 * Menghubungkan bot Telegram (Fase 6A):
 * 1. Validasi token ke Bot API (`getMe`) — token ditolak Telegram (401)
 *    → 422 TELEGRAM_TOKEN_INVALID; Bot API tak terjangkau → 503.
 * 2. Buat akun channel: token disimpan TERENKRIPSI (AES-256-GCM, kunci
 *    env CHANNEL_TOKEN_SECRET), secret webhook acak disimpan sebagai
 *    hash SHA-256. Token mentah tidak menyentuh DB/log/respons.
 * 3. Daftarkan webhook `POST {publicBaseUrl}/api/telegram/webhook/<id>`
 *    dengan secret itu. Gagal daftar → akun ditandai 'error' dan request
 *    menjawab 422 CHANNEL_NOT_CONNECTED (akun terlihat jujur di daftar,
 *    bukan hilang diam-diam).
 */
async function connectTelegram(
  c: Parameters<typeof apiError>[0],
  bundle: AuthBundle,
  opts: ChannelsModuleOptions,
  input: {
    tenantId: string;
    userId: string;
    displayName?: string;
    botToken?: string;
  },
) {
  if (!input.botToken) {
    return apiError(c, 400, "VALIDATION_ERROR", "botToken is required for telegram");
  }
  if (!opts.channelTokenSecret || !opts.publicBaseUrl) {
    return apiError(c, 503, "INTERNAL_ERROR", "Telegram is not configured");
  }
  const client = new TelegramBotApiClient({
    baseUrl: opts.telegramApiBase,
    token: input.botToken,
  });

  let identity;
  try {
    identity = await client.getMe();
  } catch (err) {
    if (err instanceof TelegramApiError) {
      if (err.status === 0) {
        return apiError(c, 503, "INTERNAL_ERROR", "Telegram API is unreachable");
      }
      return apiError(c, 422, "TELEGRAM_TOKEN_INVALID", "Telegram rejected the bot token");
    }
    return apiError(c, 503, "INTERNAL_ERROR", "Telegram API is unreachable");
  }

  let encryptedBotToken: string;
  try {
    encryptedBotToken = encryptChannelSecret(
      opts.channelTokenSecret,
      input.botToken,
    );
  } catch {
    return apiError(c, 503, "INTERNAL_ERROR", "Channel credential encryption is not configured");
  }

  const webhookSecret = generateChannelWebhookSecret();
  let row: ChannelAccount;
  try {
    row = await createTelegramChannelAccount(
      bundle.db,
      { tenantId: input.tenantId, userId: input.userId },
      {
        displayName: input.displayName,
        botId: identity.id,
        botUsername: identity.username,
        encryptedBotToken,
        webhookSecretHash: hashChannelWebhookSecret(webhookSecret),
      },
    );
  } catch {
    // Kemungkinan besar index unik (tenant, provider, external_id):
    // bot yang sama sudah terhubung ke workspace ini.
    return apiError(
      c,
      422,
      "CHANNEL_NOT_CONNECTED",
      "This bot is already connected to this workspace",
    );
  }

  const webhookUrl = `${opts.publicBaseUrl.replace(/\/+$/, "")}/api/telegram/webhook/${row.id}`;
  try {
    await client.setWebhook({ url: webhookUrl, secretToken: webhookSecret });
  } catch {
    await setChannelAccountStatus(
      bundle.db,
      { tenantId: input.tenantId },
      row.id,
      "error",
    );
    return apiError(
      c,
      422,
      "CHANNEL_NOT_CONNECTED",
      "Failed to register the webhook with Telegram",
    );
  }

  return c.json(serializeChannel(row), 201);
}
