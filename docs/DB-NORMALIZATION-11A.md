# Audit Normalisasi DB — Fase 11A (2026-11-03)

Audit dilakukan terhadap skema **nyata** staging (`sahabat_kreator_staging`,
44 tabel, 57 policy RLS, 439 kolom, 92 FK, 150 index) dan terhadap pemakaian
kode di seluruh repo — bukan dari ingatan. Dokumen ini mencatat per temuan:
**DIUBAH** (masuk migrasi 0040) atau **DIBIARKAN** + alasannya.

## (a) Konsistensi tipe ID

Peta tipe dari `information_schema`:

- **Semua PK tabel internal adalah `uuid`** dan **semua FK internal adalah
  `uuid` → `uuid`** (92 FK terpetakan; tidak ada satu pun pasangan FK↔PK
  yang beda tipe). Join `::text` yang dulu menyulitkan (catatan Fase 1B–7B)
  berasal dari masa sebelum tabel jembatan `users` ada; pola finalnya sudah
  benar dan konsisten.
- Jembatan Better Auth: `auth_user.id` bertipe `text` (milik Better Auth,
  tidak bisa diubah) → `users.auth_user_id` bertipe `text` dengan index
  unik, dan seluruh tabel internal merujuk `users.id` (`uuid`) — termasuk
  `tenant_members.user_id` yang **sudah** `uuid` merujuk `users`, bukan
  `auth_user`. **DIBIARKAN** — inheren dari Better Auth dan sudah terisolasi
  di satu kolom jembatan.
- `audit_logs.actor_id varchar(255)` dan `usage_ledger.ref_id varchar(255)`:
  keduanya **polimorfik secara desain** — `actor_id` menampung `users.id`
  (sebagai teks) ATAU aktor sistem (`system`, `pay-page-simulation`,
  `agent:<id>`, `platform`); `ref_id` menampung id dari banyak jenis ref
  (`agent_response`, `kb_embedding`, `agent_playground`, …). Tidak bisa
  menjadi FK `uuid` tanpa kehilangan semantik aktor sistem. **DIBIARKAN**.
- `profile_photos.owner_id uuid` **tanpa FK**: polimorfik via `owner_type`
  (`contact`/`channel_account`/…). Tipenya sudah `uuid` dan terindeks oleh
  unik `(tenant_id, owner_type, owner_id)`. **DIBIARKAN**.
- ID eksternal provider konsisten `varchar(255)` di semua tabel
  (`external_id`, `provider_message_id`, `provider_event_id`,
  `provider_comment_id`, `meta_template_id`, `author_external_id`,
  `parent_external_id`, …). Id node di dalam graf flow konsisten
  `varchar(128)` (`flow_runs.current_node_id`, `flow_run_steps.node_id`) —
  itu id di dalam dokumen JSONB, bukan FK. **DIBIARKAN** (konvensi seragam).
- Kolom `provider`: sebagian enum (`channel_accounts`, `conversations`,
  `channel_identities`), sebagian `varchar(32)` (`comments`,
  `integration_log`, `webhook_inbox`, `payment_links`). **DIBIARKAN** —
  tabel varchar adalah tabel **ingesti** (webhook/log) yang mencatat string
  provider apa adanya di batas sistem; mengubahnya ke enum mewajibkan
  migrasi setiap provider baru ditambah dan berisiko menolak baris log
  historis. Nilai yang tertulis berasal dari himpunan provider yang sama.
  Kandidat penyelarasan masa depan bila himpunan provider membeku.

**Kesimpulan (a): tidak ada penyelarasan tipe yang perlu diubah.**

## (b) Kolom redundan / warisan

Kandidat diperiksa dengan grep seluruh repo (baca + tulis) **dan** data
staging (jumlah non-NULL):

| Kolom | Bukti | Keputusan |
|---|---|---|
| `contacts.avatar_url` | Kode API sendiri (Fase 6D, `apps/api/src/modules/contacts/routes.ts`) mencatat kolom ini "warisan … tidak pernah terisi" — avatar kini dari `profile_photos`. Grep: nol baca/tulis di luar definisi skema. Data staging: **0 dari 471** baris non-NULL. | **DIJATUHKAN** |
| `messages.provider_cost` | Hanya ada di definisi skema `inbox.ts` dengan komentar desain lama (§12.5 Rancangan). Grep seluruh repo: nol baca, nol tulis. Biaya provider yang nyata dicatat di `usage_ledger` (Fase 9B/12D). Data staging: **0 dari 1437** baris non-NULL. | **DIJATUHKAN** |

Kolom lain yang dicurigai lalu terbukti hidup: `channel_accounts.webhook_secret`
(hash secret webhook Telegram — ditulis/dibaca `core/telegram.ts` + `channels.ts`),
`channel_accounts.graph_api_version` (ditulis saat connect Meta/WA),
`conversations.title` (judul grup Telegram 6A.1), `contacts.consent_at` &
`last_contacted_at` (logika opt-in + merge 9C/9B), `agents.config` (AgentConfig
tertipe), `usage_ledger.cost_model` (ditulis runtime agent), `media.*`
(tabel media R2 — skema disiapkan, konsumen menyusul kunci R2; **bukan**
kolom mati, tabel yang belum berpenduduk).

## (c) Index FK

Postgres tidak mengindeks FK secara otomatis. Pola yang ada sudah
mengindeks `tenant_id` di semua tabel tenant dan FK "panas" (conversation
pada messages, automation pada steps/runs, dst.). Yang ditemukan **tanpa
index dengan kolom pertama yang dapat dipakai**, padahal kolomnya nyata
dijadikan filter/join oleh kode:

| Index baru (migrasi 0040) | Bukti pemakaian |
|---|---|
| `agent_suggestions_contact_id_idx` | Merge kontak 9B me-rewrite `agent_suggestions.contact_id` (filter `tenant_id + contact_id`) |
| `agent_suggestions_agent_id_idx` | FK ke `agents`; saran dikelompokkan/dimuat per agent |
| `automation_runs_contact_id_idx` | Merge kontak 9B (filter `contact_id`) |
| `automation_runs_conversation_id_idx` | FK ke `conversations`; run ditelusuri per percakapan |
| `broadcast_recipients_contact_id_idx` | Merge kontak 9B memindah/menghapus baris per `contact_id` (unik yang ada memimpin dengan `broadcast_id`, tak terpakai untuk filter ini) |
| `broadcast_recipients_conversation_id_idx` | FK ke `conversations` (penerima terhubung ke percakapan hasil dispatch) |
| `comments_contact_id_idx` | FK ke `contacts`; komentar terhubung kontak penulis |
| `comments_conversation_id_idx` | FK ke `conversations`; komentar dimuat dalam konteks percakapan |
| `flow_runs_contact_id_idx` | Merge kontak 9B + `innerJoin contacts` di `core/flows.ts` |
| `payment_links_contact_id_idx` | Merge kontak 9B + `leftJoin contacts` di `core/products.ts` |
| `payment_links_conversation_id_idx` | FK ke `conversations` |
| `sequence_enrollments_contact_id_idx` | Merge kontak 9B (SQL mentah + update per `contact_id`; unik parsial yang ada memimpin dengan `automation_id`) |

**DIBIARKAN tanpa index** (dengan alasan): FK `created_by*`/`updated_by`
(`broadcasts`, `flows`, `saved_replies`, `kb_source_documents`,
`platform_settings`) — tidak pernah jadi filter, hanya penunjuk aktor;
`messages.media_id` & `messages.sent_by_user_id` — media belum berpenduduk
(R2) dan pesan selalu diakses lewat `conversation_id`; `subscriptions.plan_id`
— tabel katalog kecil; `integration_log.message_id` — hanya ditulis, tak
pernah difilter (grep membuktikan); `broadcasts.whatsapp_template_id` —
diresolusi lewat PK template; `*.trigger_message_id` — sudah tercakup unik
parsial (`automation_runs`, `flow_runs`) atau hanya penanda asal
(`agent_suggestions`, `sequence_enrollments` tercakup komposit
`(tenant_id, conversation_id, status)` untuk jalurnya).

## (d) JSONB vs relasional

Semua kolom JSONB ditelaah satu per satu. **Tidak ada yang diubah** —
semuanya masuk kategori yang memang sah sebagai dokumen:

- **Konfigurasi polimorfik tervalidasi kontrak**: `automations.trigger_config`
  / `action_config` (bentuknya tergantung `kind`/`trigger_type`),
  `broadcasts.audience_filter` (DSL filter), `flows.graph` (dokumen graf
  itu sendiri), `agents.config` (AgentConfig tertipe).
- **Data ekstensi milik tenant**: `contacts.custom_fields` — kunci ditentukan
  tenant; merelasikannya menghancurkan fitur (dan sudah ada skema kontrak
  `ContactCustomFieldsSchema`).
- **Jejak/payload apa adanya**: `integration_log.payload`,
  `webhook_inbox.payload`, `outbox_events.payload`, `comments.actions`,
  `automation_runs.detail`, `flow_run_steps.detail`, `agent_suggestions.detail`,
  `messages.reply_to_snapshot`, `messages.template_payload`,
  `audit_logs.meta`, `usage_ledger.meta`, `plans.limits`,
  `broadcasts.template_variable_sources`, `flow_runs.context` (state
  runtime: parkir wait_reply + kedalaman goto), `whatsapp_templates.components`
  (struktur komponen Meta apa adanya).

Tidak satu pun di antaranya difilter per-kunci secara relasional di kode;
yang terkueri (mis. status, tenant) sudah kolom relasional biasa.

## (e) RLS

Keadaan: 57 policy. Polanya sudah seragam dan sengaja:

- `tenant_isolation` (ALL) — satu policy per tabel tenant (38 tabel),
  pola tunggal sejak Fase 1A.
- **Lengan sempit SELECT-only** untuk resolusi lintas-tenant yang sah dan
  terdokumentasi per fase: `provider_external_lookup` &
  `telegram_webhook_lookup` (webhook masuk), `system_delivery_scan` &
  `meta_delivery_scan` (poller pengiriman), `system_purge_scan` (purge
  channel 6I), `system_broadcast_scan` (dispatch broadcast),
  `public_code_lookup` (halaman /pay), `public_key_lookup` (API key),
  `invitation_token_lookup` (terima undangan), `system_relay` (outbox),
  `integration_log_ingest`/`integration_log_prune`/`platform_integration_log`,
  `platform_audit`, `platform_settings_admin`.

**DIBIARKAN semua**: tidak ada dua policy yang identik (tabel, perintah,
dan kualifikasi selalu berbeda karena kebutuhan resolusinya berbeda);
"menggabungkan" mereka berarti memperlebar permukaan akses — arah yang
berlawanan dengan prinsip fail-closed. Tabel tanpa RLS juga disengaja:
`auth_*` (milik Better Auth; bukan data tenant), `users`/`tenants`/`plans`
(level identitas & katalog — isolasi ditegakkan oleh RLS `tenant_members` +
`app.tenant_id` di semua tabel data tenant + pemeriksaan membership di
aplikasi). Mengubahnya di fase reset berisiko memutus auth tanpa manfaat
keamanan tambahan yang terukur.

## Ringkasan perubahan (migrasi 0040)

1. `ALTER TABLE contacts DROP COLUMN avatar_url` (+ hapus dari skema Drizzle).
2. `ALTER TABLE messages DROP COLUMN provider_cost` (+ hapus dari skema Drizzle).
3. 12 index FK baru (daftar di (c)) + definisi index yang sama ditambahkan
   ke skema Drizzle agar skema ↔ DB tidak drift.

Tidak ada perubahan tipe, tidak ada perubahan RLS, tidak ada perubahan
JSONB. Jumlah tabel tetap 44, policy tetap 57; index 150 → 162.

## Catatan proses: snapshot drizzle-kit

Ditemukan saat menyiapkan migrasi ini: rantai snapshot di
`migrations/meta/` berhenti mencerminkan skema sejak migrasi kustom
tulis-tangan mulai dipakai (±0027 — snapshot terakhir 0026). Akibatnya
`drizzle-kit generate` **tidak dapat dipakai** terhadap tree saat ini —
ia mengusulkan pembuatan ulang tabel-tabel 0027+ karena snapshot-nya
tidak mengenal mereka. Ini **bukan** kerusakan runtime: jalur yang hidup
adalah jurnal (`_journal.json`) + file SQL, dipakai oleh `drizzle-kit
migrate` di server dan oleh verify PGlite yang menerapkan semua file SQL
dari nol. Karena itu migrasi 0040 ditulis tangan mengikuti pola migrasi
kustom sebelumnya (SQL + entri jurnal manual, tanpa snapshot baru),
persis seperti 0027–0039. Memperbaiki rantai snapshot (re-baseline)
**sengaja tidak dilakukan** di 11A: risikonya menyentuh 14 migrasi
historis tanpa manfaat runtime; tercatat di sini sebagai utang perkakas
yang diketahui, dengan jalur aman yang terdokumentasi.
