import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  HealthResponseSchema,
  VersionResponseSchema,
  type HealthResponse,
  type VersionResponse,
} from "@sahabat-kreator/contracts";
import {
  APP_VERSION,
  META_GRAPH_API_VERSION,
  R2_ACCOUNT_ID,
  R2_ENDPOINT,
  loadEnv,
  resolveR2Bucket,
} from "@sahabat-kreator/config";
import { createAuthBundle, type AuthBundle } from "./auth";
import type { AppVariables } from "./http";
import { createTenantsRoutes } from "./modules/tenants/routes";
import { createContactsRoutes } from "./modules/contacts/routes";
import { createInboxRoutes } from "./modules/inbox/routes";
import { createChannelsRoutes } from "./modules/channels/routes";
import { createAutomationsRoutes } from "./modules/automations/routes";
import { createAgentsRoutes } from "./modules/agents/routes";
import { createKnowledgeRoutes } from "./modules/knowledge/routes";
import { createProductsRoutes } from "./modules/products/routes";
import { createPayRoutes } from "./modules/pay/routes";
import { createApiKeysRoutes } from "./modules/api-keys/routes";
import { createPublicV1Routes } from "./modules/public-v1/routes";
import { createWebchatRoutes } from "./modules/webchat/routes";
import { createTelegramRoutes } from "./modules/telegram/routes";
import { createMetaRoutes } from "./modules/meta/routes";
import { createMetaOAuthRoutes } from "./modules/meta-oauth/routes";
import { startMetaDeliveryPoller } from "./modules/meta/poller";
import { createAvatarsRoutes } from "./modules/avatars/routes";
import { createAdminRoutes } from "./modules/admin/routes";
import { createLogsRoutes } from "./modules/logs/routes";
import { createAuditRoutes } from "./modules/audit/routes";
import { createBroadcastsRoutes } from "./modules/broadcasts/routes";
import { startTelegramDeliveryPoller } from "./modules/telegram/poller";
import {
  createRealtimePublisher,
  type RealtimePublisher,
} from "@sahabat-kreator/queue";
import {
  getProviderSecret,
  type PlatformSettingsOptions,
} from "@sahabat-kreator/core";

const env = loadEnv();
const startedAt = Date.now();

// Bundle auth + DB hanya dibuat bila env-nya lengkap; tanpa itu API tetap
// melayani /health & /version (mode Fase 0) dan modul tenants menjawab 503.
let authBundle: AuthBundle | null = null;
if (env.DATABASE_URL && env.BETTER_AUTH_SECRET) {
  authBundle = createAuthBundle({
    databaseUrl: env.DATABASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.API_PORT}`,
    platformAdminEmails: env.PLATFORM_ADMIN_EMAILS,
  });
}

// Route inti didefinisikan sekali di sub-app `routes`, lalu di-mount dua kali
// di app utama: di root (akses langsung ke API) dan di bawah prefix /api
// (akses lewat proxy web — staging & publik memakai https://<domain>/api/...).
const routes = new Hono<{ Variables: AppVariables }>();

routes.get("/health", (c) => {
  const body: HealthResponse = HealthResponseSchema.parse({
    status: "ok",
    service: "api",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
  return c.json(body);
});

routes.get("/version", (c) => {
  const body: VersionResponse = VersionResponseSchema.parse({
    service: "api",
    version: APP_VERSION,
    metaGraphApiVersion: META_GRAPH_API_VERSION,
  });
  return c.json(body);
});

// Penerbit nudge realtime (Fase 6G) — satu instance per proses; route &
// poller menerbitkan event kecil ke Redis pub/sub SETELAH commit, dan
// apps/realtime meneruskannya ke socket dashboard/widget. Fail-soft:
// tanpa REDIS_URL penerbit null dan klien menutupi lewat polling.
const realtimePublisher: RealtimePublisher | null = env.REDIS_URL
  ? createRealtimePublisher(env.REDIS_URL)
  : null;
const webchatOpts = { secret: env.WEBCHAT_SECRET, publisher: realtimePublisher };

// Opsi resolver Panel Admin Platform (Fase 6C) — SATU objek dipakai
// bersama modul admin, meta, dan penanda channels: cache resolver
// ter-bucket per identitas objek, jadi berbagi objek = berbagi semantik
// env proses ini + invalidasi set/clear berlaku untuk semua pemakai.
// Env hanya fallback per kunci; sumber utama nilai panel terenkripsi.
const platformOptions: PlatformSettingsOptions = {
  masterSecret: env.PLATFORM_SETTINGS_SECRET,
  env: {
    openrouter_api_key: env.OPENROUTER_API_KEY,
    openrouter_model: env.OPENROUTER_MODEL,
    r2_access_key_id: env.R2_ACCESS_KEY_ID,
    r2_secret_access_key: env.R2_SECRET_ACCESS_KEY,
    // Fase 7A.1: App Secret Meta ikut dikelola panel; env placeholder
    // staging tetap fallback sampai pemilik mengisi panel.
    meta_app_secret: env.META_APP_SECRET,
    // Fase 7D: identifier publik Meta untuk OAuth (App ID + config ID)
    // — env hanya fallback; sumber utama Panel Admin.
    meta_app_id: env.META_APP_ID,
    meta_ig_config_id: env.META_IG_CONFIG_ID,
    meta_wa_config_id: env.META_WA_CONFIG_ID,
  },
};

// Modul log integrasi (Fase 7B.1) — pembacaan integration_log:
// /tenants/:tenantId/logs (owner/admin) + /logs/unresolved (platform admin).
// Fase 7B.2: replay memakai dependensi transport yang sama seperti
// route webhook live (publisher + kredensial + base URL provider).
routes.route(
  "/",
  createLogsRoutes(authBundle, {
    platformAdminEmails: env.PLATFORM_ADMIN_EMAILS,
    replay: {
      publisher: realtimePublisher,
      channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
      telegramApiBase: env.TELEGRAM_API_BASE,
      metaApiBase: env.META_API_BASE,
      graphApiVersion: META_GRAPH_API_VERSION,
    },
  }),
);
// Modul penelusur audit (Fase 7B.4) — pembacaan audit_logs:
// /tenants/:tenantId/audit (owner/admin) + /audit/platform (admin platform).
routes.route(
  "/",
  createAuditRoutes(authBundle, {
    platformAdminEmails: env.PLATFORM_ADMIN_EMAILS,
  }),
);
// Modul broadcasts (Fase 7C) — kampanye siaran /tenants/:tenantId/broadcasts;
// eksekusi dispatch ada di worker (event outbox broadcast.dispatch_due).
routes.route("/", createBroadcastsRoutes(authBundle));
// Modul tenants (Fase 1B) — route /tenants* dengan middleware sesi di dalamnya.
routes.route("/", createTenantsRoutes(authBundle));
// Modul contacts & inbox (Fase 1D) — route bersarang /tenants/:tenantId/...
routes.route("/", createContactsRoutes(authBundle));
routes.route("/", createInboxRoutes(authBundle, realtimePublisher));
// Modul channels (Fase 1F, telegram 6A) — manajemen channel workspace
// /tenants/:tenantId/channels. Opsi telegram: kunci enkripsi kredensial +
// base URL Bot API + URL publik untuk mendaftarkan webhook.
routes.route(
  "/",
  createChannelsRoutes(authBundle, {
    channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
    telegramApiBase: env.TELEGRAM_API_BASE,
    publicBaseUrl: env.BETTER_AUTH_URL,
    metaApiBase: env.META_API_BASE,
    metaWebhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    // Fase 7A.1: penanda "app secret terkonfigurasi" menyelesaikan nilai
    // efektif panel → env (bukan env semata) — boolean saja yang keluar.
    metaAppSecretConfigured: async () => {
      if (!authBundle) return Boolean(env.META_APP_SECRET);
      return Boolean(
        await getProviderSecret(authBundle.db, "meta_app_secret", platformOptions),
      );
    },
  }),
);
// Modul meta publik (Fase 7A) — webhook TUNGGAL Meta /meta/webhook untuk
// Messenger + Instagram: handshake verify token + event bertanda tangan
// HMAC app secret (fail-closed 503 META_NOT_CONFIGURED tanpa secret).
// App secret diselesaikan panel → env per request (Fase 7A.1).
routes.route(
  "/",
  createMetaRoutes(authBundle, realtimePublisher, {
    platform: platformOptions,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
    metaApiBase: env.META_API_BASE,
    graphApiVersion: META_GRAPH_API_VERSION,
  }),
);
// Modul telegram publik (Fase 6A) — webhook Bot API /telegram/webhook/:id.
// Opsi Fase 6D: kunci dekripsi token + base URL Bot API untuk pengambilan
// foto profil kontak saat pengirim pertama kali terlihat.
routes.route(
  "/",
  createTelegramRoutes(authBundle, realtimePublisher, {
    channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
    telegramApiBase: env.TELEGRAM_API_BASE,
  }),
);
// Modul avatars (Fase 6D) — penyajian foto profil bot & kontak dari DB
// /tenants/:tenantId/avatars/... (di balik sesi + membership; URL file
// provider yang bertoken tidak pernah diedarkan).
routes.route("/", createAvatarsRoutes(authBundle));
// Modul automations (Fase 2A) — manajemen automation keyword /tenants/:tenantId/automations.
routes.route("/", createAutomationsRoutes(authBundle));
// Modul agents & knowledge (Fase 3A) — agent AI + KB + draf saran.
routes.route("/", createAgentsRoutes(authBundle, realtimePublisher));
routes.route("/", createKnowledgeRoutes(authBundle));
// Modul products (Fase 4A) — katalog produk & tautan bayar /tenants/:tenantId/products|payment-links.
routes.route(
  "/",
  createProductsRoutes(authBundle, { publicBaseUrl: env.BETTER_AUTH_URL }),
);
// Modul pay publik (Fase 4A) — halaman bayar /pay/:code (simulasi, tanpa sesi).
routes.route("/", createPayRoutes(authBundle));
// Modul api-keys (Fase 5A) — manajemen kunci workspace /tenants/:tenantId/api-keys (sesi + owner/admin).
routes.route("/", createApiKeysRoutes(authBundle));
// Modul API publik /v1 (Fase 5A) — auth API key per tenant, tenant dari kunci (bukan URL).
routes.route("/", createPublicV1Routes(authBundle, realtimePublisher));
// Modul webchat publik (Fase 1F) — API widget pengunjung /webchat/*.
routes.route("/", createWebchatRoutes(authBundle, webchatOpts));
// Modul Panel Admin Platform (Fase 6C) — kredensial provider milik
// platform /admin/* (sesi + allowlist email; non-admin 404). Env hanya
// fallback per kunci; sumber utama panel terenkripsi di DB (core).
routes.route(
  "/",
  createAdminRoutes(authBundle, {
    platformAdminEmails: env.PLATFORM_ADMIN_EMAILS,
    platform: platformOptions,
    r2: {
      accountId: R2_ACCOUNT_ID,
      endpoint: R2_ENDPOINT,
      bucket: resolveR2Bucket(env.R2_BUCKET),
    },
    // Fase 7D: redirect URI OAuth tunggal ditampilkan read-only di panel.
    metaOAuthRedirectUri: `${(env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/api/meta/oauth/callback`,
  }),
);
// Modul Meta OAuth Connect (Fase 7D) — "Lanjutkan dengan Facebook":
// start ber-sesi + callback tunggal publik /meta/oauth/callback + sesi
// aset + info ketersediaan. State HMAC sekali pakai & sesi terenkripsi
// disimpan di Redis platform (fallback in-memory tanpa REDIS_URL).
routes.route(
  "/",
  createMetaOAuthRoutes(authBundle, {
    platform: platformOptions,
    channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
    metaApiBase: env.META_API_BASE,
    graphApiVersion: META_GRAPH_API_VERSION,
    publicBaseUrl: env.BETTER_AUTH_URL,
    redisUrl: env.REDIS_URL,
    stateSecret: env.BETTER_AUTH_SECRET,
  }),
);

export const app = new Hono<{ Variables: AppVariables }>();
app.route("/", routes);
app.route("/api", routes);

// Better Auth handler: jalur kanonis publik adalah /api/auth/* (basePath
// default Better Auth memang /api/auth, cocok dengan mount ini).
if (authBundle) {
  const bundle = authBundle;
  app.on(["POST", "GET"], "/api/auth/*", (c) => bundle.auth.handler(c.req.raw));
}

// Modul bisnis lain (channels, inbox, automations, agents, ...) dipasang
// sebagai sub-app Hono per modul — lihat src/modules/.

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    console.log(`[api] Sahabat Kreator API listening on http://localhost:${info.port}`);
  });
  // WebSocket TIDAK lagi dilayani proses ini (Fase 6G): hub webchat &
  // poller pengiriman webchat pensiun — socket dashboard & pengunjung
  // kini milik apps/realtime, dijangkau publik lewat proxy `/realtime`.
  if (authBundle) {
    // Poller pengiriman Telegram (Fase 6A): mengirim pesan outbound
    // `queued` percakapan telegram via Bot API (token terdekripsi sesaat
    // di memori dari CHANNEL_TOKEN_SECRET) + nudge status (Fase 6G).
    startTelegramDeliveryPoller(authBundle, {
      channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
      telegramApiBase: env.TELEGRAM_API_BASE,
      publisher: realtimePublisher,
    });
    // Poller pengiriman Meta (Fase 7A): mengirim pesan outbound `queued`
    // percakapan messenger/instagram via Graph Send API (token Page
    // terdekripsi sesaat di memori) + nudge status (Fase 6G).
    startMetaDeliveryPoller(authBundle, {
      channelTokenSecret: env.CHANNEL_TOKEN_SECRET,
      metaApiBase: env.META_API_BASE,
      graphApiVersion: META_GRAPH_API_VERSION,
      publisher: realtimePublisher,
    });
  }
}
