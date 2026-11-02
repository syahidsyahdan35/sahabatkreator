import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  ChannelAccountResponseSchema,
  MetaOAuthCompleteRequestSchema,
  MetaOAuthCompleteResponseSchema,
  MetaOAuthInfoResponseSchema,
  MetaOAuthSessionResponseSchema,
  MetaOAuthStartRequestSchema,
  MetaOAuthStartResponseSchema,
  type ChannelAccountResponse,
  type MetaOAuthAsset,
  type MetaOAuthProvider,
} from "@sahabat-kreator/contracts";
import {
  channelConfirmationName,
  channelPurgeAt,
  createMetaChannelAccount,
  createWhatsAppChannelAccount,
  decryptChannelSecret,
  encryptChannelSecret,
  getChannelAccount,
  getChannelHealthMap,
  getPlatformPublicConfig,
  getProviderSecret,
  IDLE_CHANNEL_HEALTH,
  listProfilePhotoOwnerIds,
  lookupChannelAccountsByProviderExternalId,
  recordChannelConnectedAudit,
  storeProfilePhoto,
  updateMetaChannelAccountCredentials,
  updateWhatsAppChannelAccountCredentials,
  type ChannelHealthInfo,
  type PlatformSettingsOptions,
} from "@sahabat-kreator/core";
import {
  MetaGraphClient,
  MetaGraphError,
} from "@sahabat-kreator/channel-messenger";
import { WhatsAppCloudClient } from "@sahabat-kreator/channel-whatsapp";
import { createRedisConnection } from "@sahabat-kreator/queue";
import type { ChannelAccount } from "@sahabat-kreator/db";
import type { AuthBundle } from "../../auth";
import { apiError, type AppVariables } from "../../http";
import { requireAuth } from "../auth/session";
import { channelAvatarUrl } from "../avatars/routes";
import { resolveTenantForUser } from "../tenants/guard";

/**
 * Modul Meta OAuth Connect (Fase 7D) — "Lanjutkan dengan Facebook".
 *
 *   POST /tenants/:tenantId/meta-oauth/start                 buat state + URL dialog
 *   GET  /meta/oauth/callback                                callback TUNGGAL platform (publik)
 *   GET  /tenants/:tenantId/meta-oauth/sessions/:sessionId    aset hasil login (tanpa token)
 *   POST /tenants/:tenantId/meta-oauth/sessions/:sessionId/complete  hubungkan aset terpilih
 *   GET  /tenants/:tenantId/channels/meta-oauth-info         ketersediaan OAuth per provider
 *
 * Tiga rasa alur Meta di balik satu callback (dokumentasi resmi yang
 * terverifikasi; lihat docs/DEPLOY-STAGING.md Fase 7D):
 * - messenger — Facebook Login klasik: dialog membawa `scope`
 *   (pages_show_list, pages_messaging, pages_manage_metadata); code →
 *   user token → long-lived (fb_exchange_token) → /me/accounts. Token
 *   channel = Page Access Token turunan token long-lived per Page.
 * - instagram — Unified Login: dialog membawa `config_id` (BUKAN scope,
 *   BUKAN JS SDK); exchange code → Business Integration System User
 *   Access Token (SUAT); aset dari /me/assigned_instagram_accounts;
 *   `client_business_id` dari /me disimpan sebagai parent_external_id.
 * - whatsapp — Embedded Signup (Login for Business): dialog membawa
 *   `config_id`; exchange code → token bisnis; penemuan WABA ter-assign
 *   + nomor-nomornya DARI TOKEN di server (keputusan redirect-based —
 *   bukan event JS SDK WA_EMBEDDED_SIGNUP; lihat catatan di docs).
 *
 * Kepercayaan & kustodi:
 * - `state` = payload bertanda tangan HMAC (tenantId, provider, userId,
 *   nonce, exp ≤10 menit). Nonce diklaim saat start dan DIKONSUMSI
 *   atomik saat callback (sekali pakai — replay state ditolak).
 * - Token hasil exchange TIDAK PERNAH masuk URL/browser/log: ia hidup
 *   di "sesi OAuth" server-side (id opak, TTL ≤10 menit) yang isinya
 *   TERENKRIPSI envelope AES-256-GCM yang sama seperti kredensial
 *   channel (kunci env CHANNEL_TOKEN_SECRET).
 * - Penyimpanan nonce + sesi: Redis platform yang sudah ada (pola
 *   Fase 2A/6G) lewat @sahabat-kreator/queue; tanpa REDIS_URL jatuh ke
 *   Map in-memory proses ini (sesi hilang saat API restart — diterima
 *   & terdokumentasi; staging selalu punya Redis).
 * - App Secret untuk exchange diselesaikan panel → env per request
 *   (resolver Fase 7A.1). App ID & config ID identifier publik dari
 *   panel → env (Fase 7D, `getPlatformPublicConfig`).
 * - Semua panggilan Graph menghormati override META_API_BASE (mock uji)
 *   lewat opsi modul, persis klien Meta yang ada.
 */

export interface MetaOAuthModuleOptions {
  /** Resolver Panel Admin: App Secret (rahasia) + identifier publik Meta. */
  platform: PlatformSettingsOptions;
  /** Kunci envelope kredensial channel & sesi OAuth (env CHANNEL_TOKEN_SECRET). */
  channelTokenSecret?: string;
  /** Base URL Graph API (env META_API_BASE; default graph.facebook.com). */
  metaApiBase?: string;
  /** Versi Graph ter-pin (dari @sahabat-kreator/config). */
  graphApiVersion: string;
  /** URL publik aplikasi (env BETTER_AUTH_URL) — dasar redirect URI & tujuan redirect browser. */
  publicBaseUrl?: string;
  /** Redis platform (env REDIS_URL) untuk nonce + sesi OAuth. */
  redisUrl?: string;
  /** Secret penandatangan state (env BETTER_AUTH_SECRET). */
  stateSecret?: string;
}

const OAUTH_TTL_SECONDS = 600;
const FACEBOOK_DIALOG_BASE = "https://www.facebook.com";
/** Scope minimum Messenger yang terbukti untuk alur kita (daftar Page + kirim + subscribed_apps). */
const MESSENGER_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
] as const;

// ---------------------------------------------------------------------------
// Penyimpanan nonce + sesi (Redis; fallback in-memory)
// ---------------------------------------------------------------------------

interface OAuthKvStore {
  /** Klaim nonce baru; false bila nonce sudah pernah diklaim. */
  claimNonce(nonce: string): Promise<boolean>;
  /** Konsumsi nonce secara atomik; true hanya untuk pemakaian pertama. */
  consumeNonce(nonce: string): Promise<boolean>;
  putSession(id: string, encryptedPayload: string): Promise<void>;
  getSession(id: string): Promise<string | null>;
  deleteSession(id: string): Promise<void>;
}

/** Bentuk struktural minimum klien ioredis yang dipakai store ini. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  getdel(key: string): Promise<string | null>;
}

async function withStoreTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("oauth_store_timeout")), 3_000),
    ),
  ]);
}

function createOAuthStore(redisUrl: string | undefined): OAuthKvStore {
  if (redisUrl) {
    let client: RedisLike | null = null;
    const redis = (): RedisLike => {
      if (!client) {
        client = createRedisConnection(redisUrl) as unknown as RedisLike;
      }
      return client;
    };
    const nonceKey = (nonce: string) => `meta-oauth:nonce:${nonce}`;
    const sessionKey = (id: string) => `meta-oauth:session:${id}`;
    return {
      async claimNonce(nonce) {
        const res = await withStoreTimeout(
          redis().set(nonceKey(nonce), "1", "EX", OAUTH_TTL_SECONDS, "NX"),
        );
        return res === "OK";
      },
      async consumeNonce(nonce) {
        const res = await withStoreTimeout(redis().getdel(nonceKey(nonce)));
        return res !== null;
      },
      async putSession(id, encryptedPayload) {
        await withStoreTimeout(
          redis().set(sessionKey(id), encryptedPayload, "EX", OAUTH_TTL_SECONDS),
        );
      },
      async getSession(id) {
        return withStoreTimeout(redis().get(sessionKey(id)));
      },
      async deleteSession(id) {
        await withStoreTimeout(redis().del(sessionKey(id)));
      },
    };
  }
  // Fallback tanpa Redis: Map proses dengan kedaluwarsa malas. API
  // staging berjalan satu proses, jadi semantik sekali-pakai tetap
  // berlaku; sesi hilang saat proses restart (pengguna mengulang login).
  const nonces = new Map<string, number>();
  const sessions = new Map<string, { value: string; expiresAt: number }>();
  const alive = (expiresAt: number) => expiresAt > Date.now();
  return {
    async claimNonce(nonce) {
      const existing = nonces.get(nonce);
      if (existing !== undefined && alive(existing)) return false;
      nonces.set(nonce, Date.now() + OAUTH_TTL_SECONDS * 1000);
      return true;
    },
    async consumeNonce(nonce) {
      const existing = nonces.get(nonce);
      if (existing === undefined) return false;
      nonces.delete(nonce);
      return alive(existing);
    },
    async putSession(id, encryptedPayload) {
      sessions.set(id, {
        value: encryptedPayload,
        expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000,
      });
    },
    async getSession(id) {
      const entry = sessions.get(id);
      if (!entry) return null;
      if (!alive(entry.expiresAt)) {
        sessions.delete(id);
        return null;
      }
      return entry.value;
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// State bertanda tangan (HMAC-SHA256)
// ---------------------------------------------------------------------------

interface OAuthStatePayload {
  v: 1;
  tenantId: string;
  provider: MetaOAuthProvider;
  userId: string;
  nonce: string;
  /** Epoch detik kedaluwarsa. */
  exp: number;
}

function signOAuthState(secret: string, payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret).update(body).digest();
  return `${body}.${signature.toString("base64url")}`;
}

function verifyOAuthState(
  secret: string,
  state: string,
): OAuthStatePayload | null {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const presented = Buffer.from(state.slice(dot + 1), "base64url");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (payload.v !== 1) return null;
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (
    payload.provider !== "messenger" &&
    payload.provider !== "instagram" &&
    payload.provider !== "whatsapp"
  ) {
    return null;
  }
  if (payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Sesi OAuth (payload terenkripsi; token TIDAK PERNAH keluar server)
// ---------------------------------------------------------------------------

interface OAuthSessionData {
  tenantId: string;
  provider: MetaOAuthProvider;
  userId: string;
  assets: MetaOAuthAsset[];
  /** Messenger: Page Access Token per Page ID (asetnya banyak token). */
  pageTokens?: Record<string, string>;
  /** Instagram (SUAT) & WhatsApp (token bisnis): satu token semua aset. */
  accessToken?: string;
  /** Instagram: client_business_id portfolio klien (konteks induk). */
  clientBusinessId?: string | null;
  /** Epoch milidetik kedaluwarsa sesi. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Serialisasi channel (pola modul channels — kesehatan + avatar)
// ---------------------------------------------------------------------------

function serializeChannelHealth(health: ChannelHealthInfo) {
  return {
    status: health.status,
    lastInboundAt: health.lastInboundAt?.toISOString() ?? null,
    lastInboundOutcome: health.lastInboundOutcome,
    lastDeliveredAt: health.lastDeliveredAt?.toISOString() ?? null,
    lastFailureAt: health.lastFailureAt?.toISOString() ?? null,
    lastFailureOutcome: health.lastFailureOutcome,
    lastFailureErrorCode: health.lastFailureErrorCode,
  };
}

async function serializeChannel(
  bundle: AuthBundle,
  row: ChannelAccount,
): Promise<ChannelAccountResponse> {
  const healthMap = await getChannelHealthMap(
    bundle.db,
    { tenantId: row.tenantId },
    [row],
  );
  const health = healthMap.get(row.id) ?? IDLE_CHANNEL_HEALTH;
  const withPhoto = await listProfilePhotoOwnerIds(
    bundle.db,
    { tenantId: row.tenantId },
    "channel_account",
    [row.id],
  );
  const purgeAt = channelPurgeAt(row);
  return ChannelAccountResponseSchema.parse({
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    displayName: row.displayName,
    botUsername: row.botUsername,
    publicHandle: row.publicHandle,
    avatarUrl: withPhoto.has(row.id)
      ? channelAvatarUrl(row.tenantId, row.id)
      : null,
    status: row.status,
    health: serializeChannelHealth(health),
    confirmationName: channelConfirmationName(row),
    trashedAt: row.trashedAt?.toISOString() ?? null,
    purgeAt: purgeAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Modul
// ---------------------------------------------------------------------------

export function createMetaOAuthRoutes(
  bundle: AuthBundle | null,
  opts: MetaOAuthModuleOptions,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  const tenantBase = "/tenants/:tenantId/meta-oauth";

  if (!bundle) {
    app.post(`${tenantBase}/start`, (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get(`${tenantBase}/sessions/:sessionId`, (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.post(`${tenantBase}/sessions/:sessionId/complete`, (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get("/tenants/:tenantId/channels/meta-oauth-info", (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    app.get("/meta/oauth/callback", (c) =>
      apiError(c, 503, "INTERNAL_ERROR", "Database is not configured"),
    );
    return app;
  }

  const store = createOAuthStore(opts.redisUrl);
  const auth = requireAuth(bundle);
  app.use("/tenants/*", auth);

  const webBase = (opts.publicBaseUrl ?? "").replace(/\/+$/, "");
  const redirectUri = `${webBase}/api/meta/oauth/callback`;

  /** Konfigurasi OAuth efektif (panel → env) + ketersediaan per provider. */
  async function resolveOAuthConfig() {
    const [publicConfig, appSecret] = await Promise.all([
      getPlatformPublicConfig(bundle!.db, opts.platform),
      getProviderSecret(bundle!.db, "meta_app_secret", opts.platform),
    ]);
    const appId = publicConfig.meta_app_id;
    const igConfigId = publicConfig.meta_ig_config_id;
    const waConfigId = publicConfig.meta_wa_config_id;
    const baseReady = Boolean(appId) && Boolean(appSecret);
    return {
      appId,
      appSecret,
      igConfigId,
      waConfigId,
      available: {
        messenger: baseReady,
        instagram: baseReady && Boolean(igConfigId),
        whatsapp: baseReady && Boolean(waConfigId),
      } as Record<MetaOAuthProvider, boolean>,
    };
  }

  function graphClient(accessToken?: string): MetaGraphClient {
    return new MetaGraphClient({
      baseUrl: opts.metaApiBase,
      apiVersion: opts.graphApiVersion,
      accessToken,
    });
  }

  // -------------------------------------------------------------------------
  // Info ketersediaan OAuth (owner/admin) — dasar tombol di modal connect.
  // -------------------------------------------------------------------------
  app.get("/tenants/:tenantId/channels/meta-oauth-info", async (c) => {
    const tenant = await resolveTenantForUser(
      bundle,
      c.req.param("tenantId"),
      c.get("appUser").id,
    );
    if (!tenant) return apiError(c, 404, "TENANT_NOT_FOUND", "Tenant not found");
    if (tenant.role !== "owner" && tenant.role !== "admin") {
      return apiError(
        c,
        403,
        "FORBIDDEN",
        "Only workspace owners and admins can view Meta OAuth settings",
      );
    }
    const config = await resolveOAuthConfig();
    const body = MetaOAuthInfoResponseSchema.parse({
      oauthRedirectUri: redirectUri,
      appId: config.appId,
      appIdConfigured: Boolean(config.appId),
      appSecretConfigured: Boolean(config.appSecret),
      providers: {
        messenger: { available: config.available.messenger },
        instagram: {
          available: config.available.instagram,
          configId: config.igConfigId,
        },
        whatsapp: {
          available: config.available.whatsapp,
          configId: config.waConfigId,
        },
      },
    });
    return c.json(body);
  });

  // -------------------------------------------------------------------------
  // Start: buat state sekali pakai + URL dialog Meta.
  // -------------------------------------------------------------------------
  app.post(`${tenantBase}/start`, async (c) => {
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
        "Only workspace owners and admins can connect channels",
      );
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = MetaOAuthStartRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid OAuth start payload");
    }
    const provider = parsed.data.provider;
    if (!opts.stateSecret || !webBase) {
      return apiError(
        c,
        503,
        "META_OAUTH_NOT_CONFIGURED",
        "Meta OAuth is not configured on this server",
      );
    }
    const config = await resolveOAuthConfig();
    if (!config.available[provider] || !config.appId) {
      return apiError(
        c,
        503,
        "META_OAUTH_NOT_CONFIGURED",
        "Meta OAuth is not configured for this provider yet",
      );
    }

    const expSeconds = Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS;
    const payload: OAuthStatePayload = {
      v: 1,
      tenantId: tenant.id,
      provider,
      userId: appUser.id,
      nonce: randomBytes(18).toString("hex"),
      exp: expSeconds,
    };
    let claimed = false;
    try {
      claimed = await store.claimNonce(payload.nonce);
    } catch {
      return apiError(c, 503, "INTERNAL_ERROR", "OAuth session store is unavailable");
    }
    if (!claimed) {
      return apiError(c, 503, "INTERNAL_ERROR", "Could not allocate an OAuth state");
    }
    const state = signOAuthState(opts.stateSecret, payload);

    const params = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    });
    let dialogUrl: string;
    if (provider === "messenger") {
      // Facebook Login klasik: scope di URL (asimetri terdokumentasi —
      // IG/WA memakai config_id, Messenger v1 kita memakai scope).
      params.set("scope", MESSENGER_OAUTH_SCOPES.join(","));
      dialogUrl = `${FACEBOOK_DIALOG_BASE}/${opts.graphApiVersion}/dialog/oauth?${params.toString()}`;
    } else {
      params.set(
        "config_id",
        provider === "instagram" ? config.igConfigId! : config.waConfigId!,
      );
      if (provider === "instagram") {
        // Unified Login (dokumen terverifikasi): prompt=login memaksa
        // dialog SELALU menampilkan pemilih akun, termasuk opsi login
        // Instagram — konfigurasi IG user berlabel Instagram Login
        // Compatible. Tanpa parameter ini, pengguna yang sudah login
        // Facebook diteruskan sebagai akun itu tanpa pilihan. WhatsApp
        // (Embedded Signup) SENGAJA tidak diubah.
        params.set("prompt", "login");
      }
      dialogUrl = `${FACEBOOK_DIALOG_BASE}/dialog/oauth?${params.toString()}`;
    }

    const body = MetaOAuthStartResponseSchema.parse({
      dialogUrl,
      expiresAt: new Date(expSeconds * 1000).toISOString(),
    });
    return c.json(body);
  });

  // -------------------------------------------------------------------------
  // Callback TUNGGAL (publik; identitas dari state bertanda tangan).
  // Semua kegagalan → redirect error berkode TANPA membuat state apa pun.
  // -------------------------------------------------------------------------
  app.get("/meta/oauth/callback", async (c) => {
    const fail = (code: string) =>
      c.redirect(`${webBase}/channels?meta_oauth_error=${code}`, 302);

    if (!opts.stateSecret || !webBase) return fail("META_OAUTH_NOT_CONFIGURED");
    // Meta mengembalikan `error` bila user membatalkan/menolak izin.
    if (c.req.query("error")) return fail("META_OAUTH_CANCELLED");

    const stateRaw = c.req.query("state");
    const code = c.req.query("code");
    if (!stateRaw || !code) return fail("META_OAUTH_STATE_INVALID");
    const state = verifyOAuthState(opts.stateSecret, stateRaw);
    if (!state) return fail("META_OAUTH_STATE_INVALID");
    let consumed = false;
    try {
      consumed = await store.consumeNonce(state.nonce);
    } catch {
      consumed = false;
    }
    if (!consumed) return fail("META_OAUTH_STATE_INVALID");

    const config = await resolveOAuthConfig();
    if (!config.appId || !config.appSecret) {
      return fail("META_OAUTH_NOT_CONFIGURED");
    }
    if (!opts.channelTokenSecret) return fail("META_OAUTH_NOT_CONFIGURED");

    const anon = graphClient();
    const credentials = {
      clientId: config.appId,
      clientSecret: config.appSecret,
    };

    let session: OAuthSessionData;
    try {
      if (state.provider === "messenger") {
        const short = await anon.exchangeOAuthCode({
          ...credentials,
          code,
          redirectUri,
        });
        const longLived = await anon.exchangeLongLivedToken({
          ...credentials,
          shortLivedToken: short.accessToken,
        });
        const pages = await graphClient(longLived.accessToken).getManagedPages();
        const pageTokens: Record<string, string> = {};
        const assets: MetaOAuthAsset[] = pages.map((page) => {
          pageTokens[page.id] = page.accessToken;
          return {
            assetId: page.id,
            kind: "page" as const,
            name: page.name,
            handle: page.username,
            parentId: null,
            parentName: null,
            linkedIgUsername: page.linkedIg?.username ?? null,
          };
        });
        session = {
          tenantId: state.tenantId,
          provider: "messenger",
          userId: state.userId,
          assets,
          pageTokens,
          expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000,
        };
      } else if (state.provider === "instagram") {
        // Unified Login: exchange TANPA redirect_uri (persis dokumen).
        const suat = await anon.exchangeOAuthCode({ ...credentials, code });
        const client = graphClient(suat.accessToken);
        const accounts = await client.getAssignedInstagramAccounts();
        const clientBusinessId = await client
          .getClientBusinessId()
          .catch(() => null);
        session = {
          tenantId: state.tenantId,
          provider: "instagram",
          userId: state.userId,
          assets: accounts.map((account) => ({
            assetId: account.id,
            kind: "instagram_account" as const,
            name: null,
            handle: account.username,
            parentId: clientBusinessId,
            parentName: null,
            linkedIgUsername: null,
          })),
          accessToken: suat.accessToken,
          clientBusinessId,
          expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000,
        };
      } else {
        // WhatsApp Embedded Signup: token bisnis → WABA ter-assign →
        // nomor per WABA (penemuan di server, bukan event JS SDK).
        const businessToken = await anon.exchangeOAuthCode({
          ...credentials,
          code,
        });
        const client = graphClient(businessToken.accessToken);
        const wabas = await client.getAssignedWhatsAppBusinessAccounts();
        const assets: MetaOAuthAsset[] = [];
        for (const waba of wabas.slice(0, 25)) {
          const numbers = await client.getWabaPhoneNumbers(waba.id);
          for (const number of numbers) {
            assets.push({
              assetId: number.id,
              kind: "whatsapp_number" as const,
              name: number.verifiedName,
              handle: number.displayPhoneNumber,
              parentId: waba.id,
              parentName: waba.name,
              linkedIgUsername: null,
            });
          }
        }
        session = {
          tenantId: state.tenantId,
          provider: "whatsapp",
          userId: state.userId,
          assets,
          accessToken: businessToken.accessToken,
          expiresAt: Date.now() + OAUTH_TTL_SECONDS * 1000,
        };
      }
    } catch (err) {
      // Hanya label tahap + kode Graph yang dicatat — token tidak pernah.
      console.error(
        `[meta-oauth] exchange/discovery gagal (provider ${state.provider})`,
        err instanceof MetaGraphError ? `graph ${err.graphCode ?? err.status}` : "",
      );
      return fail("META_OAUTH_EXCHANGE_FAILED");
    }

    const sessionId = randomBytes(24).toString("base64url");
    try {
      const encrypted = encryptChannelSecret(
        opts.channelTokenSecret,
        JSON.stringify(session),
      );
      await store.putSession(sessionId, encrypted);
    } catch {
      return fail("META_OAUTH_EXCHANGE_FAILED");
    }
    return c.redirect(`${webBase}/channels?meta_oauth=${sessionId}`, 302);
  });

  // -------------------------------------------------------------------------
  // Sesi OAuth: baca aset (tanpa token) & complete.
  // -------------------------------------------------------------------------

  async function loadSession(
    sessionId: string,
    tenantId: string,
  ): Promise<OAuthSessionData | null> {
    if (!opts.channelTokenSecret) return null;
    let encrypted: string | null;
    try {
      encrypted = await store.getSession(sessionId);
    } catch {
      return null;
    }
    if (!encrypted) return null;
    const plain = decryptChannelSecret(opts.channelTokenSecret, encrypted);
    if (!plain) return null;
    let data: OAuthSessionData;
    try {
      data = JSON.parse(plain) as OAuthSessionData;
    } catch {
      return null;
    }
    if (data.tenantId !== tenantId) return null;
    if (typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) {
      return null;
    }
    return data;
  }

  app.get(`${tenantBase}/sessions/:sessionId`, async (c) => {
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
        "Only workspace owners and admins can connect channels",
      );
    }
    const sessionId = c.req.param("sessionId");
    const session = await loadSession(sessionId, tenant.id);
    if (!session) {
      return apiError(
        c,
        404,
        "META_OAUTH_SESSION_NOT_FOUND",
        "OAuth session not found or expired",
      );
    }
    const body = MetaOAuthSessionResponseSchema.parse({
      sessionId,
      provider: session.provider,
      assets: session.assets,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
    return c.json(body);
  });

  app.post(`${tenantBase}/sessions/:sessionId/complete`, async (c) => {
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
        "Only workspace owners and admins can connect channels",
      );
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = MetaOAuthCompleteRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, "VALIDATION_ERROR", "Invalid OAuth complete payload");
    }
    if (!opts.channelTokenSecret) {
      return apiError(c, 503, "INTERNAL_ERROR", "Meta is not configured");
    }
    const sessionId = c.req.param("sessionId");
    const session = await loadSession(sessionId, tenant.id);
    if (!session) {
      return apiError(
        c,
        404,
        "META_OAUTH_SESSION_NOT_FOUND",
        "OAuth session not found or expired",
      );
    }
    const asset = session.assets.find((a) => a.assetId === parsed.data.assetId);
    if (!asset) {
      return apiError(
        c,
        422,
        "META_OAUTH_ASSET_NOT_FOUND",
        "The selected asset is not part of this OAuth session",
      );
    }
    const provider = session.provider;
    const accessToken =
      provider === "messenger"
        ? session.pageTokens?.[asset.assetId]
        : session.accessToken;
    if (!accessToken) {
      return apiError(
        c,
        422,
        "META_OAUTH_ASSET_NOT_FOUND",
        "No credential is stored for the selected asset",
      );
    }

    // Penjaga satu akun = satu koneksi (pola connect manual 7A/7B):
    // aktif di workspace lain → 409; sesi TIDAK dikonsumsi agar pemilik
    // bisa memilih aset lain dari sesi yang sama.
    const existing = await lookupChannelAccountsByProviderExternalId(
      bundle.db,
      provider,
      asset.assetId,
    );
    const activeElsewhere = existing.find(
      (r) => r.tenantId !== tenant.id && r.status !== "disconnected",
    );
    if (activeElsewhere) {
      return apiError(
        c,
        409,
        "META_ACCOUNT_ALREADY_CONNECTED",
        "This Meta account is already connected to another workspace",
      );
    }

    let encryptedAccessToken: string;
    try {
      encryptedAccessToken = encryptChannelSecret(
        opts.channelTokenSecret,
        accessToken,
      );
    } catch {
      return apiError(
        c,
        503,
        "INTERNAL_ERROR",
        "Channel credential encryption is not configured",
      );
    }

    const own = existing.find((r) => r.tenantId === tenant.id);
    let row: ChannelAccount | null = null;
    let created = false;

    if (own && own.status !== "connected") {
      // Revive baris yang sama dengan kredensial OAuth baru (pola manual).
      if (provider === "whatsapp") {
        row = await updateWhatsAppChannelAccountCredentials(
          bundle.db,
          { tenantId: tenant.id },
          own.id,
          {
            encryptedAccessToken,
            wabaId: asset.parentId ?? undefined,
            displayPhoneNumber: asset.handle,
            verifiedName: asset.name,
            status: "connected",
          },
        );
      } else {
        row = await updateMetaChannelAccountCredentials(
          bundle.db,
          { tenantId: tenant.id },
          own.id,
          {
            encryptedAccessToken,
            publicHandle: asset.handle,
            graphName: asset.name,
            parentExternalId:
              provider === "instagram"
                ? (session.clientBusinessId ?? asset.parentId)
                : undefined,
            status: "connected",
          },
        );
      }
    } else if (own) {
      // Sudah connected di workspace ini — idempoten seperti connect
      // manual: kembalikan akun yang ada (kredensial tidak ditimpa).
      row = await getChannelAccount(bundle.db, { tenantId: tenant.id }, own.id);
    } else if (provider === "messenger") {
      row = await createMetaChannelAccount(
        bundle.db,
        { tenantId: tenant.id, userId: appUser.id },
        {
          provider: "messenger",
          accountExternalId: asset.assetId,
          graphName: asset.name,
          publicHandle: asset.handle,
          encryptedAccessToken,
          graphApiVersion: opts.graphApiVersion,
        },
      );
      created = true;
    } else if (provider === "instagram") {
      // Nama akun IG diambil best-effort dengan SUAT (pemilih hanya
      // membawa username); kegagalan tidak menggagalkan koneksi.
      let graphName = asset.name;
      if (!graphName) {
        try {
          const profile = await graphClient(accessToken).getObjectProfile(
            asset.assetId,
          );
          graphName = profile.name;
        } catch {
          graphName = null;
        }
      }
      row = await createMetaChannelAccount(
        bundle.db,
        { tenantId: tenant.id, userId: appUser.id },
        {
          provider: "instagram",
          accountExternalId: asset.assetId,
          graphName,
          publicHandle: asset.handle,
          encryptedAccessToken,
          graphApiVersion: opts.graphApiVersion,
          parentExternalId: session.clientBusinessId ?? asset.parentId,
        },
      );
      created = true;
    } else {
      row = await createWhatsAppChannelAccount(
        bundle.db,
        { tenantId: tenant.id, userId: appUser.id },
        {
          phoneNumberId: asset.assetId,
          wabaId: asset.parentId ?? "",
          verifiedName: asset.name,
          displayPhoneNumber: asset.handle,
          encryptedAccessToken,
          graphApiVersion: opts.graphApiVersion,
        },
      );
      created = true;
    }

    if (!row) {
      return apiError(c, 404, "NOT_FOUND", "Channel not found");
    }

    // Auto-subscribe webhook: kegagalan TIDAK menggagalkan koneksi
    // (token & akun valid) — dilaporkan sebagai peringatan berkode.
    const warnings: Array<"META_SUBSCRIBE_FAILED"> = [];
    try {
      const client = graphClient(accessToken);
      if (provider === "messenger") {
        await client.subscribeAppToObject(asset.assetId, ["messages"]);
      } else if (provider === "instagram") {
        await client.subscribeAppToObject(asset.assetId, ["messages"]);
      } else {
        if (!asset.parentId) throw new MetaGraphError(0, null, "missing_waba");
        await client.subscribeAppToObject(asset.parentId);
      }
    } catch {
      warnings.push("META_SUBSCRIBE_FAILED");
    }

    await recordChannelConnectedAudit(
      bundle.db,
      { tenantId: tenant.id, userId: appUser.id },
      { channelAccountId: row.id, provider, method: "oauth" },
    );

    // Foto profil best-effort (pola 6D/7A/7B) — tidak menggagalkan.
    scheduleOAuthAccountPhoto(bundle, opts, {
      tenantId: tenant.id,
      channelAccountId: row.id,
      provider,
      externalId: asset.assetId,
      accessToken,
    });

    // Sesi dikonsumsi setelah complete berhasil.
    try {
      await store.deleteSession(sessionId);
    } catch {
      /* sesi kedaluwarsa sendiri ≤10 menit — penghapusan best-effort */
    }

    const body = MetaOAuthCompleteResponseSchema.parse({
      channel: await serializeChannel(bundle, row),
      warnings,
    });
    return c.json(body, created ? 201 : 200);
  });

  return app;
}

/**
 * Ambil & simpan foto profil akun hasil OAuth (best-effort,
 * fire-and-forget — pola scheduleMetaAccountPhoto Fase 7A): Page/akun IG
 * lewat MetaGraphClient, bisnis WhatsApp lewat WhatsAppCloudClient.
 * Kegagalan foto tidak pernah menggagalkan koneksi.
 */
function scheduleOAuthAccountPhoto(
  bundle: AuthBundle,
  opts: MetaOAuthModuleOptions,
  input: {
    tenantId: string;
    channelAccountId: string;
    provider: MetaOAuthProvider;
    externalId: string;
    accessToken: string;
  },
): void {
  void (async () => {
    try {
      let picture: { data: Buffer; contentType: string } | null = null;
      if (input.provider === "whatsapp") {
        const client = new WhatsAppCloudClient({
          baseUrl: opts.metaApiBase,
          apiVersion: opts.graphApiVersion,
          accessToken: input.accessToken,
        });
        picture = await client.getBusinessProfilePicture(input.externalId);
      } else {
        const client = new MetaGraphClient({
          baseUrl: opts.metaApiBase,
          apiVersion: opts.graphApiVersion,
          accessToken: input.accessToken,
        });
        picture = await client.getAccountPicture(input.externalId);
      }
      if (!picture) return;
      await storeProfilePhoto(bundle.db, { tenantId: input.tenantId }, {
        ownerType: "channel_account",
        ownerId: input.channelAccountId,
        contentType: picture.contentType,
        data: picture.data,
      });
    } catch {
      console.error(
        `[meta-oauth] pengambilan foto profil akun ${input.channelAccountId} gagal`,
      );
    }
  })();
}
