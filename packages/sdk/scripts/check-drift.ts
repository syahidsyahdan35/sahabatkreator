/**
 * Pemeriksa DRIFT permukaan publik (Fase 15A) — penjaga aturan
 * sinkronisasi kontrak (keputusan user 2026-11-02 22:10).
 *
 * Registry kanonis PUBLIC_V1_SURFACE di @sahabat-kreator/contracts
 * memetakan setiap rute API publik v1 → skema kontrak → metode SDK →
 * tool MCP (+ tiernya) atau pengecualian beralasan. Skrip ini
 * membandingkan registry itu dengan IMPLEMENTASI nyata dan GAGAL
 * (exit 1) bila ada drift, dua arah:
 *
 *   1. Setiap entri registry punya rute yang benar-benar terdaftar di
 *      modul public-v1 — dan sebaliknya: setiap rute /v1 yang
 *      terdaftar di modul itu PUNYA entri registry (rute publik baru
 *      tanpa pemetaan SDK/MCP = drift).
 *   2. Setiap skema kontrak yang disebut registry benar-benar ekspor
 *      paket contracts.
 *   3. Setiap metode SDK yang disebut registry benar-benar ada pada
 *      SahabatKreatorClient — dan setiap metode publik client punya
 *      entri registry.
 *   4. Setiap tool MCP yang disebut registry benar-benar terdaftar di
 *      apps/mcp-server — dan setiap tool terdaftar punya entri
 *      registry. Tier registry juga dicocokkan dengan kenyataan:
 *      tool tier "write" wajib digerbang writeDisabledResult +
 *      readOnlyHint: false; tier "read" wajib readOnlyHint: true.
 *   5. Disiplin registry: scope harus scope yang dikenal; sdkMethod /
 *      mcpTool yang null WAJIB membawa exclusionReason; keduanya tidak
 *      boleh null bersamaan (rute publik harus terjangkau dari suatu
 *      permukaan klien).
 *
 * Pemeriksaan bersifat statis (baca sumber) agar bisa jalan di mana
 * saja tanpa database/server — ia bagian dari gerbang smoke tiap fase
 * (docs/DEPLOY-STAGING.md). Jalankan: `pnpm check:drift` dari root,
 * atau `pnpm --filter @sahabat-kreator/sdk check:drift`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_KEY_SCOPES,
  PUBLIC_V1_SURFACE,
} from "@sahabat-kreator/contracts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const read = (rel: string) =>
  readFileSync(path.join(repoRoot, rel), "utf8");

let failures = 0;
function fail(message: string): void {
  console.log(`DRIFT  ${message}`);
  failures += 1;
}
function ok(message: string): void {
  console.log(`OK     ${message}`);
}

const routeKey = (method: string, p: string) => `${method} ${p}`;

// --- Sumber implementasi ---------------------------------------------------
const contractsSrc = read("packages/contracts/src/index.ts");
const apiSrc = read("apps/api/src/modules/public-v1/routes.ts");
const sdkSrc = read("packages/sdk/src/index.ts");
const mcpSrc = read("apps/mcp-server/src/index.ts");

// --- 1. Disiplin registry ---------------------------------------------------
const seenRoutes = new Set<string>();
for (const entry of PUBLIC_V1_SURFACE) {
  const key = routeKey(entry.method, entry.path);
  if (seenRoutes.has(key)) fail(`registry: entri ganda untuk ${key}`);
  seenRoutes.add(key);
  if (entry.scope !== null && !API_KEY_SCOPES.includes(entry.scope)) {
    fail(`registry: ${key} memakai scope tak dikenal "${entry.scope}"`);
  }
  if (entry.contractSchemas.length === 0) {
    fail(`registry: ${key} tidak menyebut skema kontrak apa pun`);
  }
  if (entry.sdkMethod === null && !entry.exclusionReason) {
    fail(
      `registry: ${key} tanpa metode SDK dan tanpa exclusionReason — pengecualian harus beralasan`,
    );
  }
  if (entry.mcpTool === null && !entry.exclusionReason) {
    fail(
      `registry: ${key} tanpa tool MCP dan tanpa exclusionReason — pengecualian harus beralasan`,
    );
  }
  if (entry.sdkMethod === null && entry.mcpTool === null) {
    fail(`registry: ${key} tidak terjangkau dari permukaan klien mana pun`);
  }
  if (entry.mcpTool !== null && entry.mcpTier === null) {
    fail(`registry: ${key} punya tool MCP tetapi tier tidak dinyatakan`);
  }
  if (entry.mcpTool === null && entry.mcpTier !== null) {
    fail(`registry: ${key} menyatakan tier MCP tanpa tool MCP`);
  }
}

// --- 2. Skema kontrak benar-benar ada ---------------------------------------
for (const entry of PUBLIC_V1_SURFACE) {
  for (const name of entry.contractSchemas) {
    const re = new RegExp(
      `export\\s+(?:const|type|interface|function|class)\\s+${name}\\b`,
    );
    if (!re.test(contractsSrc)) {
      fail(
        `kontrak: skema "${name}" (untuk ${routeKey(entry.method, entry.path)}) tidak ditemukan sebagai ekspor packages/contracts`,
      );
    }
  }
}

// --- 3. Rute API terdaftar <-> registry (dua arah) ---------------------------
const implementedRoutes = new Map<string, string>();
for (const match of apiSrc.matchAll(
  /app\.(get|post|patch|delete)\(\s*"(\/v1[^"]*)"/g,
)) {
  const key = routeKey(match[1].toUpperCase(), match[2]);
  implementedRoutes.set(key, match[2]);
}
for (const entry of PUBLIC_V1_SURFACE) {
  const key = routeKey(entry.method, entry.path);
  if (!implementedRoutes.has(key)) {
    fail(`api: rute registry ${key} TIDAK terdaftar di modul public-v1`);
  }
}
for (const key of implementedRoutes.keys()) {
  if (!seenRoutes.has(key)) {
    fail(
      `api: rute ${key} terdaftar di modul public-v1 tetapi TIDAK punya entri registry PUBLIC_V1_SURFACE — tambahkan pemetaan SDK/MCP-nya (aturan sinkronisasi kontrak)`,
    );
  }
}

// --- 4. Metode SDK <-> registry (dua arah) -----------------------------------
const sdkMethods = new Set<string>();
for (const match of sdkSrc.matchAll(/^\s*async\s+(\w+)\s*\(/gm)) {
  sdkMethods.add(match[1]);
}
// Transport internal client — bukan permukaan publik, dikecualikan sadar.
const SDK_INTERNAL_METHODS = new Set(["request"]);
const registrySdkMethods = new Set<string>();
for (const entry of PUBLIC_V1_SURFACE) {
  if (entry.sdkMethod === null) continue;
  registrySdkMethods.add(entry.sdkMethod);
  if (!sdkMethods.has(entry.sdkMethod)) {
    fail(
      `sdk: metode "${entry.sdkMethod}" (untuk ${routeKey(entry.method, entry.path)}) tidak ada pada SahabatKreatorClient`,
    );
  }
}
for (const method of sdkMethods) {
  if (SDK_INTERNAL_METHODS.has(method)) continue;
  if (!registrySdkMethods.has(method)) {
    fail(
      `sdk: metode client "${method}" tidak dipetakan rute publik mana pun di registry`,
    );
  }
}

// --- 5. Tool MCP <-> registry (dua arah) + tier ------------------------------
const mcpTools = new Map<string, { readOnlyHint: boolean | null; guarded: boolean }>();
for (const chunk of mcpSrc.split("server.registerTool(").slice(1)) {
  const nameMatch = chunk.match(/^\s*"(\w+)"/);
  if (!nameMatch) continue;
  const name = nameMatch[1];
  const hintMatch = chunk.match(/readOnlyHint:\s*(true|false)/);
  mcpTools.set(name, {
    readOnlyHint: hintMatch ? hintMatch[1] === "true" : null,
    guarded: chunk.includes(`writeDisabledResult("${name}")`),
  });
}
const registryMcpTools = new Set<string>();
for (const entry of PUBLIC_V1_SURFACE) {
  if (entry.mcpTool === null) continue;
  registryMcpTools.add(entry.mcpTool);
  const tool = mcpTools.get(entry.mcpTool);
  if (!tool) {
    fail(
      `mcp: tool "${entry.mcpTool}" (untuk ${routeKey(entry.method, entry.path)}) tidak terdaftar di apps/mcp-server`,
    );
    continue;
  }
  if (entry.mcpTier === "read" && tool.readOnlyHint !== true) {
    fail(
      `mcp: tool "${entry.mcpTool}" tier registry "read" tetapi readOnlyHint bukan true`,
    );
  }
  if (entry.mcpTier === "write") {
    if (tool.readOnlyHint !== false) {
      fail(
        `mcp: tool "${entry.mcpTool}" tier registry "write" tetapi readOnlyHint bukan false`,
      );
    }
    if (!tool.guarded) {
      fail(
        `mcp: tool "${entry.mcpTool}" tier registry "write" tetapi tidak digerbang writeDisabledResult (tiering 9B)`,
      );
    }
  }
}
for (const name of mcpTools.keys()) {
  if (!registryMcpTools.has(name)) {
    fail(
      `mcp: tool "${name}" terdaftar di server MCP tetapi tidak dipetakan rute publik mana pun di registry`,
    );
  }
}

// --- Ringkasan ---------------------------------------------------------------
if (failures === 0) {
  ok(
    `permukaan publik selaras: ${PUBLIC_V1_SURFACE.length} rute v1 × kontrak/SDK/MCP tanpa drift`,
  );
  console.log("\nTIDAK ADA DRIFT");
} else {
  console.log(`\n${failures} DRIFT DITEMUKAN`);
}
process.exit(failures === 0 ? 0 : 1);
