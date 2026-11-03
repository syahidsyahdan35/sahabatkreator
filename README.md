# Sahabat Kreator

SaaS multi-tenant **agentic chat marketing** (alternatif ManyChat) untuk kreator Indonesia:
menghubungkan WhatsApp, Instagram, Messenger, Telegram, dan Webchat ke satu inbox,
automation comment-to-DM & keyword, serta AI agent yang bisa menjual dari knowledge base kreator.

Dokumen rancangan lengkap: [`docs/RANCANGAN-v3.md`](docs/RANCANGAN-v3.md) (v3.1).

## Stack

TypeScript · pnpm workspaces · Hono (Node-first, Bun-ready) · Drizzle + PostgreSQL (pgvector) ·
Redis + BullMQ · React + Vite + Tailwind · Cloudflare R2 · Meta Graph API **v26.0** (ter-pin).

## Struktur

- `apps/api` — Hono: REST `/v1` + webhook receiver (Meta/Telegram/Webchat) + poller pengiriman
- `apps/web` — Dashboard kreator (registry navigasi tunggal, i18n EN/ID, tema light/dark)
- `apps/realtime` — gateway WebSocket dashboard & widget (Redis pub/sub, nudge bukan data)
- `apps/worker` — BullMQ: relay outbox, automation, flow, agent, broadcast, email
- `apps/mcp-server` — server MCP (26 tool: baca + tulis bertingkat) di atas SDK
- `apps/cli`, `apps/admin` — placeholder terstruktur (fase berikutnya)
- `packages/contracts` — Zod schema + kontrak API (sumber kebenaran)
- `packages/config` — validasi env (fail-closed di produksi) + konstanta (termasuk pin versi Meta)
- `packages/core` — logika bisnis lintas transport (RLS `withTenant`, outbox, agent runtime)
- `packages/db` — skema Drizzle + migrasi + gerbang verifikasi PGlite
- `packages/i18n` — resource `en` (default) + `id` (paritas dijaga tipe)
- `packages/channels/*` — adapter per channel di atas `channel-core`
- `packages/ai`, `queue`, `billing`, `sdk`, `embed`, `ui` — AI provider, BullMQ/realtime, SDK, widget webchat, billing & UI kit

## Menjalankan lokal

```bash
pnpm install
cp .env.example .env          # isi seperlunya, jangan commit .env
docker compose up -d          # Postgres (pgvector) + Redis
pnpm --filter @sahabat-kreator/db db:migrate   # terapkan migrasi
pnpm dev                      # API (http://localhost:3001) + Web (http://localhost:5173)
```

Cek API: `curl localhost:3001/health` dan `curl localhost:3001/version`.

## Gerbang mutu

```bash
pnpm typecheck      # tsc seluruh paket
pnpm check:drift    # registry kontrak ↔ rute v1 ↔ SDK ↔ MCP (dua arah)
pnpm build          # bundel semua app
pnpm --filter @sahabat-kreator/db verify   # migrasi + RLS di PGlite
pnpm db:doctor      # audit DB NYATA: migrasi, RLS, hak role aplikasi
```

### Database: reset, grant, audit

`db:doctor` / `db:grant` / `db:reset` bekerja pada DB sungguhan lewat
`MIGRATION_DATABASE_URL` (role pemilik skema). Lihat
`docs/PRODUCTION.md` §7 untuk prosedur restore.

```bash
pnpm db:doctor                              # baca-saja; exit ≠ 0 bila bermasalah
pnpm --filter @sahabat-kreator/db db:grant  # beri ulang hak role aplikasi (idempoten)
pnpm --filter @sahabat-kreator/db db:reset -- --yes   # HAPUS semua data, migrasi dari nol
```

Grant role aplikasi **tidak lagi** langkah manual yang harus diingat:
migrasi `0009_app_role_grants.sql` memberi grant + `ALTER DEFAULT
PRIVILEGES` di rantai migrasi, jadi `db:migrate` selalu menghasilkan DB
yang bisa dipakai. `db:grant` disediakan untuk restore-dari-dump
(dump dibuat `--no-privileges`).

## Status

Implementasi berjalan sampai **Fase 13C** (segmen audiens + opt-in broadcast) dan
**Hotfix R1** (Meta OAuth/aset). Semua gerbang mutu di atas hijau.
Peta cakupan permukaan (kemampuan × kontrak/dashboard/v1/SDK/MCP/CLI) ada di
[`docs/COVERAGE-MATRIX.md`](docs/COVERAGE-MATRIX.md); catatan deploy staging di
[`docs/DEPLOY-STAGING.md`](docs/DEPLOY-STAGING.md).
