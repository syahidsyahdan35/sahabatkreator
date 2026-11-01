# Sahabat Kreator

SaaS multi-tenant **agentic chat marketing** (alternatif ManyChat) untuk kreator Indonesia:
menghubungkan WhatsApp, Instagram, Messenger, Telegram, dan Webchat ke satu inbox,
automation comment-to-DM & keyword, serta AI agent yang bisa menjual dari knowledge base kreator.

Dokumen rancangan lengkap: [`docs/RANCANGAN-v3.md`](docs/RANCANGAN-v3.md) (v3.1).

## Stack

TypeScript · pnpm workspaces · Hono (Node-first, Bun-ready) · Drizzle + PostgreSQL (pgvector) ·
Redis + BullMQ · React + Vite + Tailwind · Cloudflare R2 · Meta Graph API **v26.0** (ter-pin).

## Struktur

- `apps/api` — Hono: REST `/v1` + webhook receiver + realtime
- `apps/web` — Dashboard kreator (registry navigasi tunggal, i18n EN/ID, tema light/dark)
- `apps/worker`, `apps/cli`, `apps/mcp-server`, `apps/admin` — placeholder terstruktur (fase berikutnya)
- `packages/contracts` — Zod schema + kontrak API (sumber kebenaran)
- `packages/config` — validasi env + konstanta (termasuk pin versi Meta)
- `packages/i18n` — resource `en` (default) + `id`
- `packages/channels/*` — adapter per channel di atas `channel-core`
- `packages/core`, `db`, `ai`, `queue`, `billing`, `sdk`, `embed`, `ui` — placeholder terstruktur

## Menjalankan lokal

```bash
pnpm install
cp .env.example .env          # isi seperlunya, jangan commit .env
docker compose up -d          # Postgres (pgvector) + Redis
pnpm dev                      # API (http://localhost:3001) + Web (http://localhost:5173)
```

Cek API: `curl localhost:3001/health` dan `curl localhost:3001/version`.

## Status

Fase 0 — scaffold monorepo. Lihat tabel fase di dokumen rancangan §9.
