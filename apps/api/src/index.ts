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
import { WebchatHub } from "./modules/webchat/hub";
import { startWebchatDeliveryPoller } from "./modules/webchat/poller";
import {
  createWebchatRoutes,
  createWebchatUpgradeHandler,
} from "./modules/webchat/routes";

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

// Hub WebSocket webchat (Fase 1F) — satu instance dipakai route balasan
// inbox (mendorong realtime) dan handler upgrade WS (menerima koneksi).
const webchatHub = new WebchatHub();
const webchatOpts = { secret: env.WEBCHAT_SECRET, hub: webchatHub };

// Modul tenants (Fase 1B) — route /tenants* dengan middleware sesi di dalamnya.
routes.route("/", createTenantsRoutes(authBundle));
// Modul contacts & inbox (Fase 1D) — route bersarang /tenants/:tenantId/...
routes.route("/", createContactsRoutes(authBundle));
routes.route("/", createInboxRoutes(authBundle, webchatHub));
// Modul channels (Fase 1F) — manajemen channel workspace /tenants/:tenantId/channels.
routes.route("/", createChannelsRoutes(authBundle));
// Modul automations (Fase 2A) — manajemen automation keyword /tenants/:tenantId/automations.
routes.route("/", createAutomationsRoutes(authBundle));
// Modul agents & knowledge (Fase 3A) — agent AI + KB + draf saran.
routes.route("/", createAgentsRoutes(authBundle));
routes.route("/", createKnowledgeRoutes(authBundle));
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
  const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    console.log(`[api] Sahabat Kreator API listening on http://localhost:${info.port}`);
  });
  // WebSocket webchat (Fase 1F): upgrade HTTP di path /webchat/ws dan
  // /api/webchat/ws ditangani hub webchat; path lain bukan urusan kita.
  const handleWebchatUpgrade = createWebchatUpgradeHandler(authBundle, webchatOpts);
  server.on("upgrade", (req, socket, head) => {
    if (!handleWebchatUpgrade(req, socket, head)) {
      socket.destroy();
    }
  });
  // Poller pengiriman webchat (Fase 2A): mendorong pesan outbound `queued`
  // yang dibuat proses lain (worker automation) ke pengunjung yang sedang
  // terhubung lewat hub. Jembatan lintas proses — lihat modules/webchat/poller.ts.
  if (authBundle) {
    startWebchatDeliveryPoller(authBundle, webchatHub);
  }
}
