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

const env = loadEnv();
const startedAt = Date.now();

// Route inti didefinisikan sekali di sub-app `routes`, lalu di-mount dua kali
// di app utama: di root (akses langsung ke API) dan di bawah prefix /api
// (akses lewat proxy web — staging & publik memakai https://<domain>/api/...).
const routes = new Hono();

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

export const app = new Hono();
app.route("/", routes);
app.route("/api", routes);

// Modul bisnis (auth, tenants, channels, inbox, automations, agents, ...)
// dipasang di sini sebagai sub-app Hono per modul — lihat src/modules/.

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    console.log(`[api] Sahabat Kreator API listening on http://localhost:${info.port}`);
  });
}
