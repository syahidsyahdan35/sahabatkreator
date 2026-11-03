/**
 * Smoke test artefak API hasil build (Fase 16A) — dipakai CI.
 *
 * Yang dibuktikan: bundle `apps/api/dist/index.js` benar-benar BOOT di
 * runtime target (Node ATAU Bun), melayani /health, /version, /ready, dan
 * mengirim header keamanan + x-request-id. Tanpa DB/Redis: jalur
 * "not_configured" yang diuji, bukan koneksi sungguhan.
 *
 * Pemakaian:
 *   node scripts/ci-smoke-api.mjs                  # runtime Node
 *   SMOKE_RUNTIME=bun node scripts/ci-smoke-api.mjs # runtime Bun
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const runtime = process.env.SMOKE_RUNTIME ?? process.execPath;
const entry = "apps/api/dist/index.js";
const port = 39000 + Math.floor(Math.random() * 900);
const baseUrl = `http://127.0.0.1:${port}`;
const timeoutMs = 30_000;

if (!existsSync(entry)) {
  console.error(`[smoke] ${entry} tidak ditemukan — jalankan \`pnpm build\` dulu.`);
  process.exit(2);
}

const env = { ...process.env, NODE_ENV: "development", API_PORT: String(port), LOG_LEVEL: "error" };
for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "REDIS_URL"]) {
  delete env[key];
}

let output = "";
const child = spawn(runtime, [entry], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  [${runtime === process.execPath ? "node" : "bun"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function request(path) {
  return fetch(`${baseUrl}${path}`, { headers: { "x-request-id": "smoke-request-1" } });
}

async function waitForHealth() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`proses keluar lebih awal dengan kode ${child.exitCode}\n${output}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { "x-request-id": "smoke-request-1" },
      });
      if (res.ok) return res;
    } catch {
      /* belum listen */
    }
    await delay(250);
  }
  throw new Error(`/health tidak siap dalam ${timeoutMs}ms\n${output}`);
}

try {
  const health = await waitForHealth();
  const healthBody = await health.json();
  check("GET /health → 200", health.status === 200);
  check("health.status=ok", healthBody.status === "ok");
  check(
    "x-request-id dipertahankan",
    health.headers.get("x-request-id") === "smoke-request-1",
    health.headers.get("x-request-id") ?? "kosong",
  );
  check(
    "X-Content-Type-Options: nosniff",
    health.headers.get("x-content-type-options") === "nosniff",
  );
  check(
    "Content-Security-Policy terpasang",
    (health.headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
  );

  const version = await request("/version");
  const versionBody = await version.json();
  check("GET /version → 200", version.status === 200);
  check("Meta API v26.0", versionBody.metaGraphApiVersion === "v26.0", versionBody.metaGraphApiVersion);

  const ready = await request("/ready");
  const readyBody = await ready.json();
  check("GET /ready tanpa DB → 503", ready.status === 503, `status=${ready.status}`);
  check("ready database=not_configured", readyBody.checks?.database === "not_configured");

  const missing = await request("/route-tidak-ada");
  check("route tak dikenal → 404", missing.status === 404, `status=${missing.status}`);

  if (failures > 0) {
    console.error(`\n[smoke] output proses:\n${output}`);
    process.exitCode = 1;
  } else {
    console.log(`\n[smoke] artefak API OK di runtime ${runtime === process.execPath ? "node" : "bun"}`);
  }
} catch (err) {
  console.error(`[smoke] GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await delay(1_000);
  if (child.exitCode === null) child.kill("SIGKILL");
}
