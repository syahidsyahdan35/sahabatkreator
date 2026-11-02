import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  SahabatKreatorApiError,
  SahabatKreatorClient,
} from "@sahabat-kreator/sdk";
import { z } from "zod";

/**
 * MCP server Sahabat Kreator (Fase 5B, RANCANGAN §2 & §8) — transport stdio.
 *
 * Adapter TIPIS di atas @sahabat-kreator/sdk: setiap tool memanggil API
 * publik v1 yang sama dengan yang dipakai integrasi lain. Server ini TIDAK
 * mengakses database dan TIDAK memegang kredensial selain satu API key
 * tenant dari env:
 *
 *   SAHABAT_KREATOR_API_KEY   (wajib)  kunci `sk_live_...` dari dashboard
 *                                      Settings → API Keys. Scope kunci
 *                                      membatasi tool: mis. tanpa
 *                                      `messages:write`, tool send_message
 *                                      ditolak API (403 API_KEY_SCOPE_DENIED)
 *                                      dan diteruskan sebagai tool error.
 *   SAHABAT_KREATOR_BASE_URL  (opsional) origin API, default
 *                                      https://botara.my.id
 *
 * Error API TIDAK membuat server crash: ia menjadi hasil tool `isError`
 * yang memuat kode kontrak agar model/pengguna bisa memahami penolakan.
 * stdout adalah kanal protokol MCP — log diagnostik HANYA ke stderr.
 */

const apiKey = process.env.SAHABAT_KREATOR_API_KEY;
if (!apiKey) {
  console.error(
    "[mcp-server] SAHABAT_KREATOR_API_KEY wajib diisi (API key tenant dari dashboard Settings → API Keys).",
  );
  process.exit(1);
}
const baseUrl = process.env.SAHABAT_KREATOR_BASE_URL ?? "https://botara.my.id";

const client = new SahabatKreatorClient({ baseUrl, apiKey });

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown): CallToolResult {
  if (err instanceof SahabatKreatorApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Sahabat Kreator API error [${err.code}] (HTTP ${err.status}): ${err.message}`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
  };
}

/** Jalankan panggilan SDK; kegagalan apa pun menjadi tool error yang terbaca. */
async function run<T>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    return jsonResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

const server = new McpServer({ name: "sahabat-kreator", version: "0.1.0" });

server.registerTool(
  "whoami",
  {
    description:
      "Identitas tenant pemilik API key yang dipakai server ini (tenantId, tenantName) beserta scope kunci. Berguna untuk memastikan kunci/workspace yang benar sebelum bertindak.",
    inputSchema: {},
  },
  async () => run(() => client.me()),
);

server.registerTool(
  "list_contacts",
  {
    description:
      "Daftar kontak workspace (scope contacts:read). Mendukung pencarian teks bebas dan pagination limit/offset. Hasil: { contacts, total }.",
    inputSchema: {
      search: z.string().max(255).optional().describe("Kata kunci pencarian nama/email/telepon"),
      limit: z.number().int().min(1).max(100).optional().describe("Maks. jumlah kontak (default server 50)"),
      offset: z.number().int().min(0).optional().describe("Lewati N kontak pertama"),
    },
  },
  async ({ search, limit, offset }) =>
    run(() => client.listContacts({ search, limit, offset })),
);

server.registerTool(
  "create_contact",
  {
    description:
      "Buat kontak baru di workspace (scope contacts:write). Hasil: kontak yang dibuat.",
    inputSchema: {
      name: z.string().min(1).max(255).describe("Nama kontak"),
      phone: z.string().min(1).max(32).optional().describe("Nomor telepon (opsional)"),
      email: z.string().email().max(320).optional().describe("Email (opsional)"),
    },
  },
  async ({ name, phone, email }) =>
    run(() => client.createContact({ name, phone, email })),
);

server.registerTool(
  "list_conversations",
  {
    description:
      "Daftar percakapan workspace (scope conversations:read), terbaru dulu, dengan cuplikan pesan terakhir dan jumlah belum terbaca.",
    inputSchema: {},
  },
  async () => run(() => client.listConversations()),
);

server.registerTool(
  "list_messages",
  {
    description:
      "Riwayat pesan satu percakapan (scope conversations:read), kronologis menaik. Membaca lewat tool ini tidak menandai percakapan terbaca.",
    inputSchema: {
      conversationId: z.string().uuid().describe("Id percakapan (dari list_conversations)"),
      limit: z.number().int().min(1).max(200).optional().describe("Maks. jumlah pesan (default server 50)"),
    },
  },
  async ({ conversationId, limit }) =>
    run(() => client.listMessages(conversationId, { limit })),
);

server.registerTool(
  "send_message",
  {
    description:
      "Kirim pesan keluar ke satu percakapan sebagai workspace (scope messages:write). Pesan masuk jalur pengiriman yang sama dengan balasan dashboard — untuk webchat, pengunjung yang terhubung menerimanya realtime.",
    inputSchema: {
      conversationId: z.string().uuid().describe("Id percakapan tujuan"),
      text: z.string().min(1).max(4096).describe("Isi pesan teks"),
    },
  },
  async ({ conversationId, text }) =>
    run(() => client.sendMessage(conversationId, text)),
);

server.registerTool(
  "list_products",
  {
    description:
      "Daftar produk workspace beserta harga Rupiah (scope products:read).",
    inputSchema: {},
  },
  async () => run(() => client.listProducts()),
);

await server.connect(new StdioServerTransport());
console.error(
  `[mcp-server] sahabat-kreator MCP server (stdio) siap — API ${baseUrl}`,
);
