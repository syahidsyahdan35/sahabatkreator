/**
 * Uji integrasi MCP server Sahabat Kreator (Fase 5B) — BUKAN unit test dan
 * BUKAN bagian suite Playwright. Skrip ini:
 *   (a) memulai apps/mcp-server hasil build (dist/index.js) sebagai proses
 *       anak lewat transport stdio,
 *   (b) memakainya dengan klien MCP resmi (Client dari
 *       @modelcontextprotocol/sdk) — initialize, tools/list, tools/call —
 *       terhadap API publik v1 yang LIVE.
 *
 * Env yang dibaca (kunci TIDAK PERNAH dicetak — hanya prefix):
 *   SAHABAT_KREATOR_API_KEY           (wajib) kunci FULL-scope tenant uji
 *   SAHABAT_KREATOR_API_KEY_LIMITED   (opsional) kunci scope-read default
 *                                     untuk uji negatif scope; bila kosong
 *                                     uji negatif dilewati (SKIP)
 *   SAHABAT_KREATOR_BASE_URL          (opsional) default https://botara.my.id
 *   SAHABAT_KREATOR_TEST_CONVERSATION_ID (opsional) percakapan tujuan
 *                                     send_message; bila kosong dipakai
 *                                     percakapan pertama tenant. Bila tenant
 *                                     tidak punya percakapan sama sekali,
 *                                     uji send_message GAGAL (skrip ini
 *                                     adalah bukti end-to-end, bukan smoke)
 *   SAHABAT_KREATOR_MCP_COMMAND       (opsional) executable untuk menjalankan
 *                                     dist server (default "node"; di server
 *                                     staging yang hanya punya Bun, isi path
 *                                     bun — dist server adalah ESM murni).
 *
 * Prasyarat: server sudah di-build (`pnpm --filter @sahabat-kreator/mcp-server build`).
 * Jalankan:  pnpm --filter @sahabat-kreator/mcp-server verify:mcp
 * Exit code 0 = semua lulus; 1 = ada kegagalan; 2 = env kurang.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fullKey = process.env.SAHABAT_KREATOR_API_KEY;
if (!fullKey) {
  console.error("SAHABAT_KREATOR_API_KEY wajib diisi (kunci full-scope tenant uji).");
  process.exit(2);
}
const limitedKey = process.env.SAHABAT_KREATOR_API_KEY_LIMITED;
const baseUrl = process.env.SAHABAT_KREATOR_BASE_URL ?? "https://botara.my.id";
const testConversationId = process.env.SAHABAT_KREATOR_TEST_CONVERSATION_ID;

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(packageRoot, "dist", "index.js");
if (!existsSync(serverEntry)) {
  console.error(
    `dist server tidak ditemukan (${serverEntry}) — jalankan dulu: pnpm --filter @sahabat-kreator/mcp-server build`,
  );
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function skip(name: string, why: string): void {
  console.log(`SKIP  ${name} — ${why}`);
}

interface ToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

function resultText(result: ToolResult): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}
function resultJson<T>(result: ToolResult): T | null {
  try {
    return JSON.parse(resultText(result)) as T;
  } catch {
    return null;
  }
}

async function connect(apiKey: string): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.SAHABAT_KREATOR_API_KEY = apiKey;
  env.SAHABAT_KREATOR_BASE_URL = baseUrl;
  const transport = new StdioClientTransport({
    command: process.env.SAHABAT_KREATOR_MCP_COMMAND ?? "node",
    args: [serverEntry],
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "verify-mcp", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

const EXPECTED_TOOLS = [
  "whoami",
  "list_contacts",
  "create_contact",
  "list_conversations",
  "list_messages",
  "send_message",
  "list_products",
];

const client = await connect(fullKey);
try {
  const serverInfo = client.getServerVersion();
  check(
    "initialize OK",
    serverInfo?.name === "sahabat-kreator",
    `server=${serverInfo?.name}@${serverInfo?.version}`,
  );

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  check(
    "tools/list memuat 7 tools",
    JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
    names.join(","),
  );

  const whoami = await call(client, "whoami");
  const me = resultJson<{ tenantId: string; tenantName: string; scopes: string[] }>(whoami);
  check(
    "whoami → tenant benar",
    !whoami.isError && !!me && me.tenantId.length > 0 && me.tenantName.length > 0,
    me ? `tenant="${me.tenantName}" scopes=${me.scopes.join(",")}` : resultText(whoami),
  );

  const contactsResult = await call(client, "list_contacts", { limit: 5 });
  const contacts = resultJson<{ contacts: unknown[]; total: number }>(contactsResult);
  check(
    "list_contacts",
    !contactsResult.isError && !!contacts && Array.isArray(contacts.contacts),
    contacts ? `total=${contacts.total}` : resultText(contactsResult),
  );

  const uniqueName = `MCP Uji ${Date.now()}`;
  const createdResult = await call(client, "create_contact", { name: uniqueName });
  const created = resultJson<{ id: string; name: string }>(createdResult);
  check(
    "create_contact",
    !createdResult.isError && !!created && created.name === uniqueName,
    created ? `id=${created.id}` : resultText(createdResult),
  );

  const searchResult = await call(client, "list_contacts", { search: uniqueName });
  const found = resultJson<{ contacts: Array<{ id: string }> }>(searchResult);
  check(
    "kontak baru muncul di list_contacts",
    !!found && !!created && found.contacts.some((c) => c.id === created.id),
  );

  const convResult = await call(client, "list_conversations");
  const convs = resultJson<{ conversations: Array<{ id: string }> }>(convResult);
  check(
    "list_conversations",
    !convResult.isError && !!convs && Array.isArray(convs.conversations),
    convs ? `count=${convs.conversations.length}` : resultText(convResult),
  );

  const conversationId = testConversationId ?? convs?.conversations[0]?.id;
  if (!conversationId) {
    check(
      "send_message",
      false,
      "tenant tidak punya percakapan — buat percakapan webchat uji dulu (lihat README)",
    );
  } else {
    const historyResult = await call(client, "list_messages", {
      conversationId,
      limit: 50,
    });
    const history = resultJson<{ messages: unknown[] }>(historyResult);
    check(
      "list_messages",
      !historyResult.isError && !!history && Array.isArray(history.messages),
      history ? `count=${history.messages.length}` : resultText(historyResult),
    );

    const marker = `Pesan uji MCP ${Date.now()}`;
    const sendResult = await call(client, "send_message", {
      conversationId,
      text: marker,
    });
    const sent = resultJson<{ contentText: string; status: string }>(sendResult);
    check(
      "send_message terkirim (queued/sent)",
      !sendResult.isError &&
        !!sent &&
        sent.contentText === marker &&
        (sent.status === "queued" || sent.status === "sent"),
      sent ? `status=${sent.status}` : resultText(sendResult),
    );

    const afterResult = await call(client, "list_messages", {
      conversationId,
      limit: 50,
    });
    const after = resultJson<{ messages: Array<{ contentText: string | null }> }>(afterResult);
    check(
      "pesan MCP terbaca kembali via list_messages",
      !!after && after.messages.some((m) => m.contentText === marker),
    );
  }

  const productsResult = await call(client, "list_products");
  const products = resultJson<{ products: unknown[] }>(productsResult);
  check(
    "list_products",
    !productsResult.isError && !!products && Array.isArray(products.products),
    products ? `count=${products.products.length}` : resultText(productsResult),
  );
} finally {
  await client.close();
}

// --- Uji negatif scope: kunci read-only tidak boleh menulis -----------------
if (!limitedKey) {
  skip("uji negatif scope", "SAHABAT_KREATOR_API_KEY_LIMITED tidak diisi");
} else {
  const limited = await connect(limitedKey);
  try {
    const tools = await limited.listTools();
    check(
      "kunci terbatas: tools/list tetap jalan",
      tools.tools.length === EXPECTED_TOOLS.length,
    );

    const conversationId =
      testConversationId ??
      resultJson<{ conversations: Array<{ id: string }> }>(
        await call(limited, "list_conversations"),
      )?.conversations[0]?.id;
    if (!conversationId) {
      skip("kunci terbatas: send_message ditolak", "tidak ada percakapan uji");
    } else {
      const denied = await call(limited, "send_message", {
        conversationId,
        text: "pesan ini tidak boleh terkirim",
      });
      check(
        "kunci tanpa messages:write → tool error API_KEY_SCOPE_DENIED (bukan crash)",
        denied.isError === true &&
          resultText(denied).includes("API_KEY_SCOPE_DENIED"),
        resultText(denied).slice(0, 120),
      );
    }

    const deniedCreate = await call(limited, "create_contact", {
      name: "Tidak Boleh Terbentuk",
    });
    check(
      "kunci tanpa contacts:write → tool error API_KEY_SCOPE_DENIED",
      deniedCreate.isError === true &&
        resultText(deniedCreate).includes("API_KEY_SCOPE_DENIED"),
    );
  } finally {
    await limited.close();
  }
}

console.log(failures === 0 ? "\nSEMUA LULUS" : `\n${failures} KEGAGALAN`);
process.exit(failures === 0 ? 0 : 1);
