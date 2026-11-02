# @sahabat-kreator/mcp-server

MCP server Sahabat Kreator (Fase 5B) — **transport stdio**, dibangun di atas
`@sahabat-kreator/sdk` dan memanggil API publik v1 yang sama dengan
integrasi lain (RANCANGAN §2: MCP adalah adapter tipis). Server tidak
mengakses database; satu-satunya kredensial yang dipegangnya adalah API
key tenant dari env.

## Tools

| Tool | Scope kunci | Keterangan |
| --- | --- | --- |
| `whoami` | — | Tenant pemilik kunci + scope kunci |
| `list_contacts` | `contacts:read` | Daftar/cari kontak (`search`, `limit`, `offset`) |
| `create_contact` | `contacts:write` | Buat kontak (`name`, `phone?`, `email?`) |
| `list_conversations` | `conversations:read` | Daftar percakapan workspace |
| `list_messages` | `conversations:read` | Riwayat pesan (`conversationId`, `limit?`) |
| `send_message` | `messages:write` | Kirim pesan keluar (`conversationId`, `text`) |
| `list_products` | `products:read` | Daftar produk + harga |

Error API (kunci tidak valid, scope kurang, data tidak ditemukan)
dikembalikan sebagai **tool error MCP** yang memuat kode kontrak —
server tidak crash.

## Konfigurasi

| Env | Wajib | Keterangan |
| --- | --- | --- |
| `SAHABAT_KREATOR_API_KEY` | ya | API key `sk_live_...` dari dashboard Settings → API Keys |
| `SAHABAT_KREATOR_BASE_URL` | tidak | Origin API; default `https://botara.my.id` |

> ⚠️ **Kunci hanya boleh datang dari env.** Jangan menulis kunci utuh ke
> file konfigurasi yang ter-commit, jangan membagikannya di chat/log.
> Buat kunci khusus MCP dengan scope seminimal yang dibutuhkan (mis.
> tanpa `messages:write` bila hanya perlu membaca).

## Build & jalankan

```bash
pnpm --filter @sahabat-kreator/mcp-server build   # menghasilkan dist/index.js
SAHABAT_KREATOR_API_KEY=sk_live_... node apps/mcp-server/dist/index.js
```

## Contoh konfigurasi klien MCP

Claude Desktop (`claude_desktop_config.json`) dan Cursor
(`.cursor/mcp.json`) memakai format yang sama:

```json
{
  "mcpServers": {
    "sahabat-kreator": {
      "command": "node",
      "args": ["/path/ke/sahabatkreator/apps/mcp-server/dist/index.js"],
      "env": {
        "SAHABAT_KREATOR_API_KEY": "sk_live_...",
        "SAHABAT_KREATOR_BASE_URL": "https://botara.my.id"
      }
    }
  }
}
```

## Verifikasi end-to-end

```bash
pnpm --filter @sahabat-kreator/mcp-server build
SAHABAT_KREATOR_API_KEY=sk_live_... \
SAHABAT_KREATOR_API_KEY_LIMITED=sk_live_... \
  pnpm --filter @sahabat-kreator/mcp-server verify:mcp
```

`verify:mcp` memulai server hasil build sebagai proses anak (stdio) dan
mengujinya dengan klien MCP resmi terhadap API live: initialize,
tools/list (7 tools), whoami, kontak (buat + temukan), percakapan, kirim
pesan, produk, dan uji negatif scope untuk kunci terbatas. Lihat header
`scripts/verify-mcp.ts` untuk semua env yang didukung.

## Batas v1

Transport hanya **stdio** (standar untuk klien MCP lokal seperti Claude
Desktop/Cursor). Transport HTTP (Streamable HTTP) menyusul bila ada
kebutuhan klien jarak jauh — arsitektur adapter membuat penambahannya
tidak menyentuh tool maupun SDK.
