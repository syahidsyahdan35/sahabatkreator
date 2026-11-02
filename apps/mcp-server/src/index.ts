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
 *   MCP_ALLOW_WRITES          (opsional, Fase 9B) tiering keamanan:
 *                                      DEFAULT server ini READ-ONLY.
 *                                      Tool TULIS (create_contact,
 *                                      send_message, hide_comment,
 *                                      unhide_comment — dua terakhir
 *                                      Fase 10B) terdaftar tetapi
 *                                      MENOLAK dengan error yang jelas
 *                                      sampai env ini bernilai persis
 *                                      "1". Tool baca selalu jalan.
 *                                      Ini lapisan opt-in lokal di atas
 *                                      scope API key — keduanya harus
 *                                      mengizinkan agar tulis berhasil.
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

/** Tiering keamanan MCP (Fase 9B): tulis hanya dengan opt-in eksplisit. */
const writesEnabled = process.env.MCP_ALLOW_WRITES === "1";

/** Hasil penolakan tool tulis saat tier tulis tidak diaktifkan. */
function writeDisabledResult(toolName: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          `Tool "${toolName}" adalah tool TULIS dan server MCP ini berjalan ` +
          `READ-ONLY secara default (tiering keamanan Fase 9B). ` +
          `Untuk mengizinkan tool tulis, jalankan ulang server dengan env ` +
          `MCP_ALLOW_WRITES=1. Tool baca tetap tersedia tanpa env tersebut.`,
      },
    ],
  };
}

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
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: true },
  },
  async ({ search, limit, offset }) =>
    run(() => client.listContacts({ search, limit, offset })),
);

server.registerTool(
  "create_contact",
  {
    description:
      "Buat kontak baru di workspace (scope contacts:write). Hasil: kontak yang dibuat. [TIER TULIS — menolak kecuali server dijalankan dengan MCP_ALLOW_WRITES=1; default server read-only.]",
    inputSchema: {
      name: z.string().min(1).max(255).describe("Nama kontak"),
      phone: z.string().min(1).max(32).optional().describe("Nomor telepon (opsional)"),
      email: z.string().email().max(320).optional().describe("Email (opsional)"),
      customFields: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Field kustom kontak sebagai peta string→string (opsional; kunci 1–64 karakter, nilai maks 1000 karakter, maks 50 entri)",
        ),
    },
    annotations: { readOnlyHint: false },
  },
  async ({ name, phone, email, customFields }) =>
    writesEnabled
      ? run(() => client.createContact({ name, phone, email, customFields }))
      : writeDisabledResult("create_contact"),
);

server.registerTool(
  "list_conversations",
  {
    description:
      "Daftar percakapan workspace (scope conversations:read), terbaru dulu, dengan cuplikan pesan terakhir dan jumlah belum terbaca.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: true },
  },
  async ({ conversationId, limit }) =>
    run(() => client.listMessages(conversationId, { limit })),
);

server.registerTool(
  "send_message",
  {
    description:
      "Kirim pesan keluar ke satu percakapan sebagai workspace (scope messages:write). Pesan masuk jalur pengiriman yang sama dengan balasan dashboard — untuk webchat, pengunjung yang terhubung menerimanya realtime. [TIER TULIS — menolak kecuali server dijalankan dengan MCP_ALLOW_WRITES=1; default server read-only.]",
    inputSchema: {
      conversationId: z.string().uuid().describe("Id percakapan tujuan"),
      text: z.string().min(1).max(4096).describe("Isi pesan teks"),
    },
    annotations: { readOnlyHint: false },
  },
  async ({ conversationId, text }) =>
    writesEnabled
      ? run(() => client.sendMessage(conversationId, text))
      : writeDisabledResult("send_message"),
);

server.registerTool(
  "list_products",
  {
    description:
      "Daftar produk workspace beserta harga Rupiah (scope products:read).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => run(() => client.listProducts()),
);

server.registerTool(
  "list_comments",
  {
    description:
      "Daftar komentar Instagram/Messenger yang tercatat dari webhook (scope comments:read), terbaru dulu, beserta aturan yang cocok dan jejak aksinya (DM/balasan publik/sembunyikan) serta status moderasi. Hasil: { comments }.",
    inputSchema: {
      channelAccountId: z.string().uuid().optional().describe("Saring ke satu akun channel (opsional)"),
      automationId: z.string().uuid().optional().describe("Saring ke komentar yang cocok dengan aturan ini (opsional)"),
      limit: z.number().int().min(1).max(200).optional().describe("Maks. jumlah komentar (default server 50)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ channelAccountId, automationId, limit }) =>
    run(() => client.listComments({ channelAccountId, automationId, limit })),
);

server.registerTool(
  "hide_comment",
  {
    description:
      "Sembunyikan satu komentar di Instagram/Facebook (scope comments:write). Meta dipanggil dulu; status lokal berubah hanya bila Meta menerima. [TIER TULIS — menolak kecuali server dijalankan dengan MCP_ALLOW_WRITES=1; default server read-only.]",
    inputSchema: {
      commentId: z.string().uuid().describe("Id komentar (dari list_comments)"),
    },
    annotations: { readOnlyHint: false },
  },
  async ({ commentId }) =>
    writesEnabled
      ? run(() => client.hideComment(commentId))
      : writeDisabledResult("hide_comment"),
);

server.registerTool(
  "unhide_comment",
  {
    description:
      "Tampilkan lagi satu komentar yang tersembunyi di Instagram/Facebook (scope comments:write). [TIER TULIS — menolak kecuali server dijalankan dengan MCP_ALLOW_WRITES=1; default server read-only.]",
    inputSchema: {
      commentId: z.string().uuid().describe("Id komentar (dari list_comments)"),
    },
    annotations: { readOnlyHint: false },
  },
  async ({ commentId }) =>
    writesEnabled
      ? run(() => client.unhideComment(commentId))
      : writeDisabledResult("unhide_comment"),
);

await server.connect(new StdioServerTransport());
console.error(
  `[mcp-server] sahabat-kreator MCP server (stdio) siap — API ${baseUrl} — tier: ${
    writesEnabled
      ? "BACA+TULIS (MCP_ALLOW_WRITES=1)"
      : "READ-ONLY (tool tulis menolak; set MCP_ALLOW_WRITES=1 untuk mengizinkan)"
  }`,
);
