# Rancangan Sahabat Kreator — v3.1 (DRAFT, menunggu persetujuan)

> Status: Draft revisi 3.1 untuk direview Mas Romo — belum dikunci, belum ada kode.
> Tanggal: 1 November 2026 (revisi: tambahan mobile nav, 5 channel, segmen, Meta v26, i18n, dark/light)
> Posisi produk: SaaS multi-tenant agentic chat marketing (alternatif ManyChat) untuk kreator Indonesia.

---

## 1. Keputusan Inti yang Diusulkan

| Aspek | Usulan | Alasan singkat |
|---|---|---|
| Bahasa | TypeScript di semua tempat | 1 bahasa untuk web, API, worker, CLI, MCP, SDK |
| Monorepo | pnpm workspaces (+ Turborepo bila perlu cache/task pipeline) | Workspace matang, lockfile deterministik, ramah CI |
| Runtime | Node-first, Bun-ready | BullMQ stabil di Node; Hono portable, API bisa pindah ke Bun tanpa rewrite. Aturan: tidak ada API `Bun.*` di `packages/*` |
| Framework API | Hono + Zod OpenAPI | Ringan, type-safe, spec OpenAPI bisa di-generate dari kode |
| Database | PostgreSQL + Drizzle ORM | Drizzle eksplisit & ringan; hindari Prisma |
| Vector / RAG | pgvector di Postgres yang sama | 1 database untuk MVP, tidak perlu Pinecone/Qdrant dulu |
| Queue / Jobs | Redis + BullMQ | Delayed job (sequence), rate-limit per channel, retry/backoff — jantung chat marketing |
| Auth | Better Auth + plugin Organization | Native Hono/Node, modelnya pas untuk Workspace/Member/Invitation |
| Pembayaran | Midtrans/Xendit (billing SaaS) + link pembayaran kreator | Konteks Indonesia; JANGAN bergantung pada Commerce API Meta (deprecated di v26, lihat §12) |
| Storage | **Cloudflare R2** (keputusan user 2026-11-01) — akses via API S3-compatible | URL media Meta kedaluwarsa, wajib disimpan sendiri. R2: tanpa biaya egress, satu ekosistem dengan Tunnel/DNS botara.my.id. Bucket terpisah per lingkungan (`sahabat-kreator-staging`, `sahabat-kreator-prod`), privat secara default, akses file via presigned URL berjangka waktu; kredensial R2 (Access Key + Secret) disimpan per lingkungan, bukan di repo |
| Frontend dashboard | React + Vite + TanStack Router/Query + Tailwind + shadcn/ui | Di balik login, tidak butuh SSR/Next.js |
| Landing page | Terpisah nanti (Astro/Next) bila butuh SEO | Tidak dicampur dengan dashboard |
| **Channel (scope terkunci)** | **WhatsApp, Instagram, Messenger, Telegram, Webchat** | Permintaan user 2026-11-01. Rilis bertahap (lihat §9), tapi interface channel-core dirancang untuk ke-5-nya sejak awal |
| **Segmen pertama** | **Kreator produk digital & course** (sesuai rekomendasi asisten, disetujui user) | Lihat §13 |
| **Meta API baseline** | **Graph API v26.0, ter-pin per channel, tidak ada panggilan unversioned** | Lihat §12 |
| **i18n** | **Inggris (default & fallback) + Indonesia, tanpa hardcode** | Lihat §11 |
| **Tema** | **Light + Dark + ikuti sistem, berbasis design token semantik** | Lihat §10.3 |
| **Navigasi** | **1 registry navigasi untuk desktop & mobile; mobile = 4 tab + More** | Lihat §10.1–10.2 |

## 2. Prinsip Arsitektur (aturan yang tidak boleh dilanggar)

1. **Core transport-agnostic.** `packages/core` berisi logika bisnis murni. Ia tidak tahu Hono, HTTP, BullMQ, MCP, atau CLI. Semua app adalah adapter tipis di atas core.
2. **Contract-first.** `packages/contracts` adalah sumber kebenaran tunggal (Zod schema + OpenAPI). API memvalidasi dengannya, SDK di-generate darinya, schema tool MCP diturunkan darinya.
3. **Tenant di semua hal.** Setiap query, job, event, file, dan vector wajib membawa `tenantId`. Isolasi lapis 2: scoping di repository + PostgreSQL Row Level Security. Test kebocoran tenant berjalan di CI.
4. **Webhook bodoh dan cepat.** Endpoint webhook hanya: verifikasi signature → simpan raw event (dedup) → lempar ke queue → balas 200 <100ms. Semua proses berat di worker.
5. **Jobs ≠ Events.** Jobs (BullMQ) = perintah "kerjakan X". Events = fakta "X terjadi" (message.received, payment.succeeded). Events ditulis lewat Transactional Outbox dalam transaksi DB yang sama dengan perubahan datanya.
6. **Semua aksi AI tercatat.** Audit log untuk setiap keputusan/tool call AI: versi prompt, model, biaya token, dasar pesannya.
7. **Metering sejak hari pertama.** Setiap pesan terkirim, kontak baru, dan token AI dicatat di ledger append-only. Sejak perubahan harga WhatsApp 1 Okt 2026 (§12.5), ledger juga wajib mencatat **biaya provider per pesan** (kategori + negara tujuan), bukan hanya biaya AI. Data yang tidak dicatat dari awal tidak bisa direkonstruksi untuk billing.
8. **Tidak ada string & warna hardcoded di UI.** Semua teks lewat kunci i18n (§11), semua warna lewat token semantik (§10.3). Dilint di CI.
9. **Satu sumber kebenaran navigasi.** Desktop sidebar dan mobile bottom bar me-render registry yang sama (§10.1). Dilarang membuat daftar menu terpisah per platform/viewport.

## 3. Gambaran Sistem

```
                        ┌──────────────┐   ┌──────────────┐
  Kreator / Tim ───────▶│  apps/web    │   │ apps/admin   │
                        │  Dashboard   │   │ Superadmin   │
                        └──────┬───────┘   └──────┬───────┘
                               │ HTTP (session)   │
  Developer / Agency ───┐      ▼                  ▼
        │ SDK / API Key │   ┌──────────────────────────────┐
        ├───────────────┼──▶│          apps/api            │
        │ MCP Client    │   │  Hono: REST /v1 + Webhook    │
        ├───────────────┼──▶│  Receiver + Realtime (SSE/WS)│
        │ CLI           │   └──────┬───────────────┬───────┘
        └───────────────┘          │ enqueue job   │ tulis event (outbox)
                                   ▼               ▼
                        ┌────────────────┐  ┌────────────────┐
                        │  apps/worker   │  │ Redis / BullMQ │
                        │ webhook-proc.  │◀─┤ jobs + delayed │
                        │ ai-reply       │  │ sequences      │
                        │ broadcast      │  └────────────────┘
                        │ outbox-relay   │
                        └──────┬─────────┘
                               │
        ┌──────────────────────┼──────────────────────────┐
        ▼                      ▼                          ▼
 ┌─────────────┐      ┌────────────────┐        ┌──────────────────┐
 │ packages/ai │      │packages/channels│       │  packages/core   │
 │ agent loop, │      │ WA/IG/FB/TG/Web │       │ (dipakai semua   │
 │ RAG, tools  │      │ adapter        │       │  app di atas)    │
 └─────────────┘      └───────┬────────┘        └────────┬─────────┘
                              ▼                          ▼
              Meta Graph API v26 (WA/IG/Messenger)   PostgreSQL (Drizzle,
              Telegram Bot API · Webchat (milik      pgvector, RLS) + R2
              sendiri via WebSocket)
```

`apps/mcp-server` dan `apps/cli` duduk sejajar dengan `apps/api`: ketiganya menerjemahkan input masing-masing (HTTP / tool call MCP / perintah terminal) menjadi panggilan core yang sama persis.

## 4. Struktur Repo (pnpm workspaces)

```
sahabat-kreator/
├── pnpm-workspace.yaml        # globs: apps/*, packages/*, packages/channels/*
├── apps/
│   ├── api/                   # Hono — REST /v1, webhook receiver, realtime
│   │   └── src/modules/       # vertical slice: auth, tenants, channels,
│   │                          # contacts, inbox, automations, agents,
│   │                          # knowledge, broadcasts, billing, api-keys
│   ├── web/                   # Dashboard kreator (Vite + React)
│   │   └── src/navigation/    # registry navigasi tunggal (desktop + mobile, §10)
│   ├── admin/                 # Superadmin internal (fase 2, folder disiapkan)
│   ├── worker/                # BullMQ processors (Node) — bisa scale terpisah
│   │   └── src/jobs/          # process-webhook, ai-reply, send-message,
│   │                          # broadcast, sequence-step, outbox-relay,
│   │                          # token-refresh, media-download
│   ├── cli/                   # `sk` CLI — admin/devops + CLI publik (pakai SDK)
│   └── mcp-server/            # MCP Streamable HTTP — auth API Key per tenant + scope
│
├── packages/
│   ├── contracts/             # Zod schema + OpenAPI — SUMBER KEBENARAN
│   ├── core/                  # Logika bisnis murni (service + domain rules)
│   │   └── src/               # contacts/, conversations/, automations/,
│   │                          # campaigns/, agents/, billing-rules/, entitlements/
│   ├── db/                    # Drizzle schema, migrasi, client, helper RLS
│   ├── ai/                    # Agent runtime: loop, prompt registry, tools,
│   │                          # RAG/retrieval, provider (OpenAI/Claude/Gemini),
│   │                          # guardrails, cost-tracker, simulasi/eval
│   ├── channels/
│   │   ├── channel-core/      # Interface ChannelAdapter, tipe Message/Event
│   │   │                      # standar, policy engine (jendela pesan per
│   │   │                      # channel, template, opt-in/out), enkripsi token,
│   │   │                      # client Graph API v26 (§12)
│   │   ├── channel-whatsapp/  # WhatsApp Cloud API + routing MM API (§12.6)
│   │   ├── channel-instagram/ # Instagram API — jalur Instagram Login utama (§12.7)
│   │   ├── channel-messenger/ # Messenger Platform via Facebook Page
│   │   ├── channel-telegram/  # Telegram Bot API (bukan Meta, tanpa jendela 24 jam)
│   │   └── channel-webchat/   # Channel milik sendiri: server WebSocket +
│   │                          # sesi anonim/teridentifikasi (widget di packages/embed)
│   ├── queue/                 # Abstraksi BullMQ: definisi job + event relay
│   ├── billing/               # Midtrans/Xendit, subscription, usage metering
│   ├── sdk/                   # @sahabat-kreator/sdk — generated dari contracts
│   │                          # + auth, retry/idempotency, pagination,
│   │                          # verifikasi signature webhook (tulisan tangan)
│   ├── embed/                 # Widget webchat untuk website kreator (<script>,
│   │                          # ringan, mendukung light/dark/auto & i18n)
│   ├── i18n/                  # BARU: resource en (default) + id, tipe kunci
│   │                          # diturunkan dari resource en, helper format
│   │                          # Intl (tanggal/angka/mata uang)
│   ├── config/                # env validation, logger, konstanta bersama,
│   │                          # termasuk pin versi Graph API per channel
│   └── ui/                    # Design system bersama (web + admin):
│                              # token semantik light/dark, komponen, ikon
│
├── infra/
│   ├── docker-compose.yml     # Postgres, Redis (dev)
│   └── Dockerfile             # per app (api, worker, web, mcp-server)
└── docs/
    ├── adr/                   # Architecture Decision Records
    ├── api/                   # OpenAPI hasil generate + panduan developer
    └── meta-app-review/       # BARU (§11.3): materi pengajuan akses API Meta
                               # dalam EN (+ versi ID): deskripsi per permission,
                               # naskah screencast, privacy policy, data deletion
```

**Aturan dependensi:** `apps/* → core, contracts, channels, ai, billing, queue, db, i18n, ui` · `core → db, contracts` (tidak boleh → apps, tidak boleh → Hono/BullMQ) · `sdk → contracts` saja · `channels/* → channel-core, contracts`.

## 5. Alur Utama

### 5.1 Pesan DM masuk → dibalas AI
1. Meta/Telegram mengirim webhook ke `apps/api` → verifikasi signature. (Webchat masuk via WebSocket, diperlakukan sebagai event channel yang sama.)
2. Cek dedup di tabel `webhook_inbox` (`provider_event_id` unik) — retry provider tidak memproses pesan 2x.
3. Simpan raw payload, enqueue job `process-webhook`, balas 200.
4. Worker: normalisasi via `channel-*` → simpan `messages` + update `conversations` → tulis event `message.received` (outbox).
5. Automation engine cek trigger (keyword/kondisi). Jika agent aktif untuk percakapan ini: enqueue `ai-reply`.
6. `packages/ai`: rakit konteks (riwayat percakapan + ringkasan memori + retrieval KB dari pgvector + data kontak/produk) → LLM dengan tools.
7. Tool yang tersedia untuk agent: `send_message`, `send_payment_link`, `tag_contact`, `move_pipeline_stage`, `create_follow_up` (delayed job), `handoff_to_human`.
8. Sebelum kirim: policy engine cek (jendela pesan per channel §12.7, opt-out, caps biaya, level otonomi tenant). Kirim via channel adapter. Agent harus **hemat pesan**: gabungkan balasan menjadi sesedikit mungkin pesan — sejak 1 Okt 2026 setiap balasan free-form WhatsApp dikenai biaya per pesan (§12.5).
9. Catat: `audit_logs` (keputusan AI), `usage_ledger` (token + biaya model + biaya provider), event `message.sent`.

### 5.2 Comment IG → DM (funnel khas kreator)
Trigger `comment.created` dengan keyword → cek dedup & apakah user sudah pernah menerima DM untuk post ini → kirim DM pembuka via adapter IG → buat/merge kontak → masukkan ke sequence bila diatur.

### 5.3 Broadcast
Buat campaign (audiens dari segment/tag) → validasi template & opt-in → pecah jadi job per kontak dengan rate-limit per channel di BullMQ → worker kirim bertahap → agregasi status (sent/delivered/read/replied) → event per transisi penting. Khusus WhatsApp: pesan kategori marketing di-route sesuai §12.6.

### 5.4 Panggilan SDK / CLI / MCP
Semua masuk dengan **API Key per tenant + scope** (contoh scope: `contacts:read`, `messages:write`, `broadcasts:write`). SDK memanggil REST `/v1`; MCP menerjemahkan tool call ke core; CLI publik memakai SDK (dogfooding). Tidak ada jalur belakang yang melewati pengecekan entitlement & audit.

## 6. Skema Database Inti (Drizzle — semua tabel tenant-scoped kecuali yang ditandai global)

**Identity & Tenant**
`users` (global; preferensi: locale, theme) · `tenants` (workspace; default locale & timezone) · `tenant_members` (role: owner/admin/agent/viewer) · `invitations` · `api_keys` (hash, scope, last_used_at) · `plans` (global) · `subscriptions`

**Channels**
`channel_accounts` (tenant, provider: whatsapp/instagram/messenger/telegram/webchat, external_id, token terenkripsi, status, webhook_secret, graph_api_version) · `channel_identities` (identitas kontak di tiap channel)

**Audience & Inbox**
`contacts` (nama, email, phone, tags[], custom_fields jsonb, pipeline_stage, opt_in_status, consent_at) · `conversations` (channel, status, assignee, agent_enabled, unread_count) · `messages` (direction, type, content, media_id, provider_message_id unik, status, provider_cost) · `media` (R2 object key, mime, ukuran)

**Automation**
`automations` (trigger_type, kondisi jsonb, aktif) · `automation_steps` (urutan, aksi, config jsonb) · `automation_runs` (per kontak, status, step saat ini) · `sequences` + `sequence_enrollments` (untuk delayed follow-up)

**AI Agent & Knowledge**
`agents` (per tenant/channel, persona, model, level otonomi: suggest / bounded-auto / full-auto, caps biaya) · `agent_prompt_versions` · `knowledge_sources` (pdf/link/teks/produk) · `knowledge_chunks` (embedding vector, source_id) · `products` (nama, harga, deskripsi, link bayar) · `agent_simulations` (hasil test sebelum live)

**Campaign**
`broadcasts` (audiens query, template, jadwal + timezone tenant, status) · `broadcast_recipients` (per kontak, status kirim/baca)

**Billing & Metering**
`usage_ledger` (append-only: type=message/ai_token/contact, qty, cost_model, cost_provider, currency, ref_id) · `invoices`

**Sistem (fondasi)**
`webhook_inbox` (provider, provider_event_id unik, raw, processed_at) · `outbox_events` (type, payload, published_at) · `audit_logs` (actor=user/agent/system, action, meta: prompt_version, model, tokens) · `outbound_webhooks` + `outbound_webhook_deliveries` (untuk developer, fase 2)

## 7. Model Auth & Keamanan

- **Dashboard:** session (Better Auth). **SDK/API publik:** API Key. **MCP:** API Key yang sama dengan scope lebih sempit. **CLI internal:** akses server langsung, terpisah dari CLI publik.
- Token channel Meta/Telegram: envelope encryption, tidak pernah masuk log, bisa dirotasi.
- Rate-limit 3 lapis: per IP, per tenant (anti noisy-neighbor), per channel account (limit provider).
- Kepatuhan: jendela pesan per channel (§12.7), kategori template, penanganan STOP/opt-out otomatis, hak hapus data kontak (UU PDP), endpoint & halaman data deletion untuk syarat Meta.

## 8. Topologi Deploy

- **Dev:** `docker-compose` — Postgres + Redis; semua app jalan lokal via pnpm.
- **Prod awal:** container terpisah per app (`api`, `worker`, `web`, `mcp-server`) di 1–2 VPS / PaaS. `worker` adalah yang pertama di-scale horizontal saat broadcast besar. DB & Redis managed bila anggaran memungkinkan.
- **Observability:** structured logging + 1 `trace_id` mengalir webhook → job → AI → channel; health check per app.
- **Staging (keputusan user 2026-11-01):** server khusus staging/dev diakses via SSH melalui Cloudflare Tunnel (token tunnel sudah terpasang di server; key akses server `sahabat-botara-deploy`, fingerprint `SHA256:9VN+ne59+fBjqUheqU4MceSUuYdV0x5QbUGG0F7hNgM`, sudah terpasang aman di `~/.ssh/` Muse). Domain staging memakai `botara.my.id` — usulan subdomain: `sk-staging.botara.my.id` (web), `sk-api-staging.botara.my.id` (API/webhook), `sk-mcp-staging.botara.my.id` (MCP). User memberi izin: proyek lama di server ini boleh dihapus tanpa backup bila kapasitas server tidak cukup, karena server memang khusus staging/dev. Izin ini HANYA berlaku untuk server staging ini — bukan server/domain lain, bukan production.

## 9. Fase Implementasi

| Fase | Isi | Hasil |
|---|---|---|
| 0 — Fondasi | Monorepo, contracts, db schema inti, auth+tenant, outbox/inbox, audit, metering, fondasi UI: registry navigasi, design token light/dark, i18n en/id | Skeleton berjalan, tenant terisolasi, UI bilingual & 2 tema sejak awal |
| 1 — Channel & Inbox | Connect WhatsApp + Instagram (Meta v26), webhook pipeline, kontak, inbox manual + realtime, widget webchat server dasar | Kreator bisa balas DM dari dashboard |
| 1.5 — Channel lanjutan | Messenger (berbagi infra Page dengan IG/FB Login), Telegram, Webchat penuh dalam inbox yang sama | 5 channel scope v1 lengkap |
| 2 — Automation | Trigger keyword & comment-to-DM, sequence delayed (lintas channel) | Funnel kreator inti berfungsi |
| 3 — AI Agent | KB/RAG, agent loop + tools, level otonomi, simulasi, caps biaya (model + provider) | Pembeda dari ManyChat rilis |
| 4 — Broadcast & Billing | Campaign, template, subscription Midtrans/Xendit, dashboard usage | Siap berbayar |
| 5 — Platform | SDK TS publik, CLI publik, MCP server, outbound webhook, admin | Ekosistem developer |
| 6 — Ekspansi | Routing MM API WhatsApp (wajib sebelum Apr 2027, §12.6), SDK PHP, fitur lanjutan | Pertumbuhan |

> Catatan: scope channel v1 adalah 5 channel, tapi urutan rilis di atas disengaja: WA+IG adalah tempat funnel kreator terjadi; Messenger murah ditambah karena berbagi infra Meta Page; Telegram API-nya paling sederhana; Webchat milik sendiri tanpa proses approval eksternal.

## 10. Navigasi & Tema (tambahan user #1 dan #6)

### 10.1 Single Source of Truth Navigasi
Satu file registry — `apps/web/src/navigation/registry.ts` (nantinya bisa diangkat ke `packages/ui`) — berisi array `NavItem`:

```ts
type NavItem = {
  id: string            // 'inbox'
  labelKey: string      // kunci i18n, contoh 'nav.inbox' — BUKAN teks langsung
  icon: IconName
  route: string
  permission?: string   // difilter per role member
  entitlement?: string  // difilter per paket tenant
  badge?: 'unreadInbox' | 'pendingApprovals'
  mobile: { slot: 1|2|3|4 } | { slot: 'more' } | { slot: 'hidden' }
  order: { desktop: number; more: number }
}
```

- **Desktop:** sidebar me-render semua item yang lolos filter permission/entitlement, urut `order.desktop`.
- **Mobile:** bottom bar me-render tepat 4 item dengan `mobile.slot` 1–4 + tombol ke-5 **More**, yang membuka sheet berisi sisa item (urut `order.more`) + akses profil, ganti tema, ganti bahasa, dan logout.
- Filter yang sama untuk keduanya: item yang tidak berhak tidak muncul di desktop maupun mobile. Mengubah menu = mengubah 1 array ini; tidak ada daftar kedua yang bisa tidak sinkron.
- Badge (mis. unread inbox) berasal dari query yang sama untuk kedua tampilan.

### 10.2 Usulan isi 4 tab mobile
Berdasarkan perilaku kreator di HP (memantau & merespons, bukan konfigurasi berat):

| Slot | Menu | Alasan |
|---|---|---|
| 1 | Dashboard | Ringkasan penjualan & aktivitas hari ini |
| 2 | Inbox | Tugas mobile nomor 1; ada badge unread |
| 3 | AI Agents | Cek status agent, setujui draf (mode suggest), pause/aktifkan |
| 4 | Broadcast | Buat/pantau campaign dari HP |
| More | Contacts, Automations, Knowledge, Products, Channels, Analytics, Billing, Settings | Konfigurasi berat tetap bisa diakses, tidak hilang |

### 10.3 Dark / Light Support
- Strategi: Tailwind `dark` berbasis class di `<html>`; pilihan user: `light | dark | system` (default `system`), tersimpan per user (DB + localStorage), script inline anti-FOUC sebelum render pertama.
- Semua warna lewat **token semantik** di `packages/ui` (CSS variables): `bg-surface`, `bg-elevated`, `text-primary`, `text-muted`, `border-default`, `accent`, `success/warning/danger` — dilarang hex/rgb langsung di komponen. Chart, grafik analytics, dan bubble chat inbox juga memakai token (bubble per channel dibedakan aksen, bukan warna keras).
- Kedua tema wajib lolos kontras WCAG AA untuk teks; gambar/media tidak berubah, overlay & skeleton punya varian token.
- Widget webchat (embed) menghormati preferensi situs host bila disediakan, dengan fallback `auto` mengikuti sistem pengunjung.

## 11. i18n: Inggris (default) + Indonesia, Tanpa Hardcode (tambahan user #5)

### 11.1 Aturan
- `packages/i18n`: resource `en` adalah **default, fallback, dan sumber tipe** (kunci TypeScript dihasilkan dari struktur `en`). Resource `id` wajib lengkap untuk rilis; kunci yang hilang otomatis fallback ke `en`, dan CI memberi peringatan untuk kunci `id` yang belum diterjemahkan.
- Deteksi locale: preferensi user (DB) → default tenant → bahasa browser → `en`.
- Format tanggal/angka/mata uang selalu lewat `Intl.*` dengan locale aktif — bukan format manual. Zona waktu mengikuti tenant untuk jadwal broadcast.
- **Error API membawa kode, bukan kalimat:** kontrak mendefinisikan `error.code` (enum); UI menerjemahkannya lewat i18n. Dengan begitu API tetap satu untuk semua bahasa.
- Penegakan tanpa-hardcode di CI: lint untuk string literal di JSX/komponen (eslint-plugin-i18next / pemeriksaan sejenis) + review checklist.

### 11.2 Yang BUKAN i18n UI
Pesan yang diterima audiens kreator (template broadcast, balasan AI, isi automation) adalah **konten milik tenant**, disimpan per konten dengan bahasanya sendiri — bukan kunci i18n aplikasi. AI agent menjawab mengikuti bahasa lawan bicara (deteksi dari percakapan), terlepas dari bahasa UI kreator.

### 11.3 Persiapan Pengajuan Akses API ke Meta (App Review)
Alasan user meminta bilingual adalah salah satunya ini, dan rancangannya:
- Semua materi pengajuan disiapkan **bahasa Inggris sebagai versi utama**: deskripsi use case per permission, naskah + narasi/caption screencast yang menunjukkan permission dipakai end-to-end, instruksi akun tester untuk reviewer, Privacy Policy, Terms, dan halaman Data Deletion. Versi Indonesia disiapkan sebagai pendamping (untuk pengguna & bila diminta).
- Materi tinggal di `docs/meta-app-review/` dan halaman legal di `apps/web` dirender dari konten i18n, bukan halaman statis terpisah.
- Prosesnya sendiri (hasil penelusuran §12.8): Business Verification + App Review untuk Advanced Access tetap wajib; yang dihapus Meta (Okt 2026) hanyalah Access Verification terpisah untuk Tech Provider. Verifikasi bisnis adalah bottleneck jadwal — mulai paling awal, jangan menunggu aplikasi selesai.

## 12. Meta Graph API v26 — Temuan & Konsekuensi Desain (tambahan user #4)

> Sumber utama: blog resmi Meta "Introducing Graph API v26.0 and Marketing API v26.0" (rilis 29 Juli 2026). Beberapa poin harga/WhatsApp berasal dari laporan sekunder yang merangkum dokumentasi pengumuman Meta — ditandai * dan wajib diverifikasi ulang ke dokumentasi resmi Meta saat implementasi.

### 12.1 Baseline versi
Graph API v26.0 berlaku sejak 29 Juli 2026. Versi didukung ±2 tahun, tetapi perubahan v26 diperluas ke semua versi tersisa pada 27 Oktober 2026 (termasuk panggilan unversioned). v20.0 sudah dihapus 24 September 2026; v21.0 dihapus 21 Januari 2027. **Konsekuensi:** pin `v26.0` secara eksplisit di `packages/config` per channel; upgrade versi adalah proses terjadwal (cek changelog Meta tiap rilis + contract test dengan fixture versi aktif), dan isolasi versi hanya di `packages/channels/*` agar upgrade tidak menyentuh core.

### 12.2 Legacy protocol dihapus — memengaruhi client HTTP kita
Di v26, lima perilaku lama hilang: parameter `pretty` diabaikan, `debug` diabaikan, `date_format` kini menghasilkan **error**, request root `GET /?ids=...` menghasilkan **error**, dan `If-None-Match`/ETag dihapus (tidak ada lagi respons 304). **Konsekuensi untuk `channel-core`:** client dilarang memakai kelimanya; pengambilan banyak objek memakai request per-objek atau Batch API yang didukung; caching profil/kontak memakai cache kita sendiri (TTL + invalidasi webhook), bukan ETag; tanggal diparsing dari format default Meta.

### 12.3 Commerce Order Management deprecated total — jangan dibangun di atasnya
47 endpoint Commerce Order Management (order, item, pembayaran, refund, pengiriman, pajak) diblokir di v26 sejak 29 Juli 2026 dan dihapus dari semua versi pada 27 Oktober 2026, **tanpa pengganti**, seiring dimatikannya checkout Shops di Facebook/Instagram. **Konsekuensi:** manajemen produk, order, dan pembayaran Sahabat Kreator sepenuhnya milik kita sendiri (`products` + Midtrans/Xendit) — sesuai rencana awal; tidak ada fitur yang boleh bergantung pada order Meta.

### 12.4 Field Page lama (New Pages Experience)
Field Page `current_location`, `genre`, `network`, `parking`, `start_info` dan setting `auto_publish_page_info_updates` deprecated di v26 untuk New Pages Experience. **Konsekuensi:** sinkronisasi profil Page untuk channel Messenger tidak meminta field-field ini.

### 12.5 *Harga WhatsApp berubah 1 Oktober 2026 — memengaruhi metering & perilaku agent
Menurut rangkuman dokumentasi harga Meta: pesan layanan (free-form di dalam jendela 24 jam) kini ditagih **per pesan terkirim** pada tarif utility negara tujuan, setelah 1.000 pesan gratis per nomor per bulan; template utility di dalam jendela yang sebelumnya gratis juga mulai ditagih. **Konsekuensi:** (a) `usage_ledger` mencatat biaya provider per pesan + negara tujuan; (b) caps biaya agent menghitung biaya Meta + biaya model; (c) agent dirancang hemat pesan (§5.1 langkah 8); (d) estimasi biaya untuk kreator ditampilkan transparan di dashboard usage. Jendela free-entry 72 jam (dari iklan click-to-WhatsApp/CTA) tetap gratis untuk pengiriman.

### 12.6 *Marketing Messages API — pisahkan routing marketing dari sekarang
Meta mengumumkan marketing message via Cloud API berhenti 13 Oktober 2027; akun messaging yang dibuat pada/setelah 13 April 2027 hanya bisa mengirim marketing lewat Marketing Messages API (MM API), sementara service/utility/authentication tetap di Cloud API, dengan nomor & template yang sama. **Konsekuensi:** `channel-whatsapp` merutekan berdasarkan kategori template sejak desain awal (`marketing → MM API`, lainnya `→ Cloud API`); implementasi MVP boleh Cloud API dulu, tetapi interfacenya tidak boleh mengasumsikan satu endpoint — migrasi wajib selesai sebelum April 2027 (masuk Fase 6).

### 12.7 Per-channel: jalur akses & jendela pesan (untuk policy engine)
| Channel | Jalur API | Permission kunci | Jendela balasan |
|---|---|---|---|
| WhatsApp | Graph API v26 / Cloud API (+ MM API §12.6) | `whatsapp_business_messaging`, `whatsapp_business_management` | Free-form 24 jam dari pesan terakhir user; di luar itu wajib template |
| Instagram | **Instagram API with Instagram Login** (`graph.instagram.com`, tanpa perlu Facebook Page) sebagai jalur utama kreator; jalur Facebook Login disiapkan di interface yang sama | `instagram_business_basic`, `instagram_business_manage_messages` (nama scope `instagram_business_*` yang berlaku sejak rename 27 Jan 2025 — scope pendek lama sudah deprecated). Hanya akun Professional (Business/Creator) | 24 jam; tag HUMAN_AGENT untuk agen manusia s/d 7 hari (kasus support, bukan promosi) |
| Messenger | Messenger Platform via Facebook Page (`graph.facebook.com` v26) | `pages_messaging`, `pages_show_list`, `pages_manage_metadata` | 24 jam; tag HUMAN_AGENT s/d 7 hari (support) |
| Telegram | Bot API (bukan Meta) | — (bot token per tenant) | Tidak ada jendela |
| Webchat | Milik sendiri (WebSocket + sesi) | — | Tidak ada jendela; sesi & consent diatur sendiri |

### 12.8 Proses akses Meta (App Review)
Untuk melayani akun milik bisnis lain (model SaaS kita), dibutuhkan Advanced Access per permission melalui App Review + Business Verification yang terhubung ke aplikasi. Access Verification terpisah untuk Tech Provider dilaporkan dihapus Meta pada Oktober 2026,* tetapi Business Verification, App Review, Platform Terms, dan Data Use Checkup tetap berlaku. Setiap permission yang diminta harus minimal, terbukti dipakai lewat API call, dan ditunjukkan dalam screencast (§11.3). Ini adalah risiko jadwal terbesar proyek — bukan ris
...[truncated 7306 chars]