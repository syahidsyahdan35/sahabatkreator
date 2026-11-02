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
  loadEnv,
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
import { startTelegramDeliveryPoller } from "./modules/telegram/poller";
import {
  createRealtimePublisher,
  type RealtimePublisher,
} from "@sahabat-kreator/queue";

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
  }),
);
// Modul telegram publik (Fase 6A) — webhook Bot API /telegram/webhook/:id.
routes.route("/", createTelegramRoutes(authBundle, realtimePublisher));
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
  }
}
