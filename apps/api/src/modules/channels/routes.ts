import { Hono } from "hono";
import { z } from "zod";
import {
  ChannelAccountListResponseSchema,
  ChannelAccountResponseSchema,
  CreateChannelRequestSchema,
  type ChannelAccountResponse,
} from "@sahabat-kreator/contracts";
import {
  createTelegramChannelAccount,
  createWebchatChannelAccount,
  decryptChannelSecret,
  disconnectChannelAccount,
  encryptChannelSecret,
  generateChannelWebhookSecret,
  getChannelAccount,
  hashChannelWebhookSecret,
  listChannelAccounts,
  lookupChannelAccountsByProviderExternalId,
  setChannelAccountStatus,
  updateTelegramChannelAccountCredentials,
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
 * Modul channels (Fase 1F, diperluas 6A; hotfix Telegram) — route
 * bersarang di workspace:
 *   POST   /tenants/:tenantId/channels            buat channel (webchat, telegram)
 *   GET    /tenants/:tenantId/channels            daftar channel workspace
 *   DELETE /tenants/:tenantId/channels/:channelId putuskan koneksi channel
 * Provider Meta belum bisa dihubungkan → 422 CHANNEL_NOT_AVAILABLE_YET
 * (jujur; koneksi Meta tiba di fase channel-nya bersama user).
 * Untuk webchat, respons POST memuat siteKey di `externalId` — kunci
 * publik yang dipasang tenant di situsnya. Untuk telegram, token bot
 * TIDAK PERNAH muncul di respons: yang tampil hanya status + username bot.
 * Wajib sesi + membership (pola Fase 1B/1D); DELETE dibatasi owner/admin
 * (pola API keys Fase 5A).
 *
 * Hotfix Telegram:
 * - Penjaga "satu bot = satu koneksi": bot Telegram yang sama tidak
 *   boleh aktif di dua workspace (satu bot = satu webhook; koneksi kedua
 *   akan membajak yang pertama). Connect yang menabrak bot aktif milik
 *   workspace LAIN ditolak 409 TELEGRAM_BOT_ALREADY_CONNECTED; connect
 *   ulang di workspace yang sama bersifat idempoten.
 * - Disconnect: status 'disconnected' + kredensial dikosongkan; untuk
 *   Telegram, webhook di Telegram hanya dicabut bila akun ini memang
 *   pemilik webhook saat ini (cek getWebhookInfo). Riwayat percakapan
 *   TIDAK dihapus.
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
    app.delete(`${base}/:channelId`, (c) => apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"));
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

  /**
   * Memutuskan koneksi channel (hotfix Telegram): DELETE → 204.
   * Hanya owner/admin. Semantik per provider:
   * - Telegram: webhook di Telegram dicabut (deleteWebhook) HANYA bila
   *   getWebhookInfo menunjukkan URL webhook saat ini menunjuk ke akun
   *   ini — akun duplikat warisan yang bukan pemilik tidak boleh
   *   mencabut webhook pemilik sah. Kegagalan Bot API tidak menggagalkan
   *   disconnect lokal (hash secret dikosongkan core → webhook sisa akan
   *   ditolak 401). Hasil cek dicatat di audit sebagai `webhookDeleted`.
   * - Webchat: cukup status — route sesi publik sudah menolak akun yang
   *   tidak 'connected', jadi siteKey berhenti bekerja seketika.
   * Kredensial tersimpan dikosongkan oleh core; riwayat percakapan dan
   * pesan TIDAK dihapus. Idempoten: memutuskan akun yang sudah putus
   * tetap 204.
   */
  app.delete(`${base}/:channelId`, async (c) => {
    const appUser = c.get("appUser");
    const tenant = await resolveTenantForUser(bundle, c.req.param("tenantId"), appUser.id);
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.role !== "owner" && tenant.role !== "admin") {
      return apiError(c, 403, "FORBIDDEN", "Only workspace owners and admins can disconnect channels");
    }
    const channelId = c.req.param("channelId");
    if (!z.string().uuid().safeParse(channelId).success) {
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }
    const account = await getChannelAccount(
      bundle.db,
      { tenantId: tenant.id },
      channelId,
    );
    if (!account) return apiError(c, 404, "NOT_FOUND", "Channel not found");

    let webhookDeleted = false;
    if (
      account.provider === "telegram" &&
      account.status !== "disconnected" &&
      account.accessTokenEncrypted &&
      opts.channelTokenSecret &&
      opts.publicBaseUrl
    ) {
      const botToken = decryptChannelSecret(
        opts.channelTokenSecret,
        account.accessTokenEncrypted,
      );
      if (botToken) {
        const client = new TelegramBotApiClient({
          baseUrl: opts.telegramApiBase,
          token: botToken,
        });
        const expectedUrl = `${opts.publicBaseUrl.replace(/\/+$/, "")}/api/telegram/webhook/${account.id}`;
        try {
          const info = await client.getWebhookInfo();
          if (info.url === expectedUrl) {
            await client.deleteWebhook();
            webhookDeleted = true;
          }
        } catch {
          // Bot API tak terjangkau/token tak berlaku lagi: lanjutkan
          // disconnect lokal (lihat komentar di atas).
        }
      }
    }

    await disconnectChannelAccount(
      bundle.db,
      { tenantId: tenant.id, actorType: "user", actorId: appUser.id },
      account.id,
      account.provider === "telegram" ? { webhookDeleted } : {},
    );
    return c.body(null, 204);
  });

  return app;
}

/**
 * Menghubungkan bot Telegram (Fase 6A; penjaga hotfix Telegram):
 * 1. Validasi token ke Bot API (`getMe`) — token ditolak Telegram (401)
 *    → 422 TELEGRAM_TOKEN_INVALID; Bot API tak terjangkau → 503.
 * 2. Penjaga satu bot = satu koneksi: bot yang sama masih AKTIF di
 *    workspace lain → 409 TELEGRAM_BOT_ALREADY_CONNECTED (tanpa baris
 *    baru, tanpa menyentuh webhook pemilik sah). Di workspace ini:
 *    'connected' → idempoten 200; 'disconnected'/'error' → baris yang
 *    sama dihidupkan lagi (revive).
 * 3. Buat akun channel: token disimpan TERENKRIPSI (AES-256-GCM, kunci
 *    env CHANNEL_TOKEN_SECRET), secret webhook acak disimpan sebagai
 *    hash SHA-256. Token mentah tidak menyentuh DB/log/respons.
 * 4. Daftarkan webhook `POST {publicBaseUrl}/api/telegram/webhook/<id>`
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

  // Penjaga "satu bot = satu koneksi" (hotfix Telegram): bot ini tidak
  // boleh AKTIF di workspace lain — webhook-nya hanya satu dan akan
  // berpindah diam-diam. Lookup lintas tenant hanya menjawab keberadaan;
  // respons TIDAK menyebut workspace pemiliknya.
  const existing = await lookupChannelAccountsByProviderExternalId(
    bundle.db,
    "telegram",
    identity.id,
  );
  const activeElsewhere = existing.find(
    (r) => r.tenantId !== input.tenantId && r.status !== "disconnected",
  );
  if (activeElsewhere) {
    return apiError(
      c,
      409,
      "TELEGRAM_BOT_ALREADY_CONNECTED",
      "This bot is already connected to another workspace",
    );
  }
  const own = existing.find((r) => r.tenantId === input.tenantId);
  if (own) {
    if (own.status === "connected") {
      // Idempoten: bot yang sama di workspace yang sama — kembalikan
      // akun yang ada; jangan buat baris duplikat, jangan sentuh webhook.
      const row = await getChannelAccount(
        bundle.db,
        { tenantId: input.tenantId },
        own.id,
      );
      if (row) return c.json(serializeChannel(row), 200);
    }
    // Akun milik workspace ini berstatus 'disconnected'/'error':
    // hidupkan lagi baris yang sama (kredensial + secret baru, webhook
    // didaftarkan ulang) — index unik per tenant melarang baris kedua.
    return reviveTelegramAccount(c, bundle, opts, {
      tenantId: input.tenantId,
      displayName: input.displayName,
      accountId: own.id,
      botUsername: identity.username,
      encryptedBotToken,
      client,
    });
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
    // Balapan dengan connect lain: index unik parsial global (atau index
    // per tenant) menolak baris ini. Petakan ulang dari keadaan terbaru —
    // milik workspace lain → 409 yang sama; milik workspace ini →
    // kembalikan akun pemenang balapan (idempoten).
    const now = await lookupChannelAccountsByProviderExternalId(
      bundle.db,
      "telegram",
      identity.id,
    );
    const other = now.find(
      (r) => r.tenantId !== input.tenantId && r.status !== "disconnected",
    );
    if (other) {
      return apiError(
        c,
        409,
        "TELEGRAM_BOT_ALREADY_CONNECTED",
        "This bot is already connected to another workspace",
      );
    }
    const ownNow = now.find(
      (r) => r.tenantId === input.tenantId && r.status !== "disconnected",
    );
    if (ownNow) {
      const winner = await getChannelAccount(
        bundle.db,
        { tenantId: input.tenantId },
        ownNow.id,
      );
      if (winner) return c.json(serializeChannel(winner), 200);
    }
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

/**
 * Menghidupkan lagi akun Telegram milik workspace ini yang berstatus
 * 'disconnected'/'error' (jalur idempoten connect): kredensial ditulis
 * ulang dari token yang baru diserahkan (token sama sudah lolos getMe),
 * secret webhook dirotasi, webhook didaftarkan ulang untuk id akun yang
 * SAMA. Sukses → 200 akun 'connected'; webhook gagal → akun 'error' +
 * 422 CHANNEL_NOT_CONNECTED (pola connect baru Fase 6A).
 */
async function reviveTelegramAccount(
  c: Parameters<typeof apiError>[0],
  bundle: AuthBundle,
  opts: ChannelsModuleOptions,
  input: {
    tenantId: string;
    displayName?: string;
    accountId: string;
    botUsername: string | null;
    encryptedBotToken: string;
    client: TelegramBotApiClient;
  },
) {
  const webhookSecret = generateChannelWebhookSecret();
  const updated = await updateTelegramChannelAccountCredentials(
    bundle.db,
    { tenantId: input.tenantId },
    input.accountId,
    {
      encryptedBotToken: input.encryptedBotToken,
      webhookSecretHash: hashChannelWebhookSecret(webhookSecret),
      botUsername: input.botUsername,
      displayName: input.displayName,
      status: "connected",
    },
  );
  if (!updated) {
    return apiError(c, 404, "NOT_FOUND", "Channel not found");
  }

  const webhookUrl = `${(opts.publicBaseUrl ?? "").replace(/\/+$/, "")}/api/telegram/webhook/${updated.id}`;
  try {
    await input.client.setWebhook({
      url: webhookUrl,
      secretToken: webhookSecret,
    });
  } catch {
    await setChannelAccountStatus(
      bundle.db,
      { tenantId: input.tenantId },
      updated.id,
      "error",
    );
    return apiError(
      c,
      422,
      "CHANNEL_NOT_CONNECTED",
      "Failed to register the webhook with Telegram",
    );
  }

  return c.json(serializeChannel(updated), 200);
}
