# Matriks Cakupan Permukaan — Kontrak × Dashboard × API v1 × SDK × MCP × CLI

Dokumen HIDUP (lahir di Fase 15A). Ia mencatat, untuk setiap kemampuan
inti Sahabat Kreator, permukaan mana saja yang mengeksposnya — dan,
yang sama pentingnya, permukaan mana yang SENGAJA tidak, beserta
alasannya.

## Aturan yang dijaga dokumen ini

Aturan sinkronisasi kontrak (keputusan user 2026-11-02 22:10):

> `packages/contracts` adalah sumber kebenaran tunggal. Setiap fase
> yang menambah/mengubah kemampuan WAJIB memperbarui — dalam fase yang
> sama — kontrak, permukaan API publik v1 tempat kemampuan itu berada,
> SDK, dan tool MCP (terklasifikasi baca/tulis per tiering Fase 9B).
> CLI bergabung begitu Fase 14D lahir. Pengecualian yang disengaja
> WAJIB dinyatakan eksplisit — diam bukan keputusan.

Konsekuensi praktis untuk setiap fase berikutnya:

1. Tambah/ubah skema di `packages/contracts` lebih dulu.
2. Bila kemampuan masuk permukaan publik: tambah rute di
   `apps/api/src/modules/public-v1`, metode di `packages/sdk`, tool
   di `apps/mcp-server`, DAN entri di registry `PUBLIC_V1_SURFACE`
   (di `packages/contracts/src/index.ts`) — semuanya satu fase.
3. Jalankan `pnpm check:drift` — ia gagal bila ada rute publik tanpa
   pemetaan SDK/MCP, pemetaan yang menunjuk nama yang tidak ada, atau
   tier MCP yang tidak cocok dengan gerbang `MCP_ALLOW_WRITES`.
   Langkah ini bagian dari gerbang smoke test (lihat
   `docs/DEPLOY-STAGING.md`).
4. Bila suatu permukaan disengaja dikecualikan, tulis keputusannya di
   matriks ini pada fase yang sama, dengan alasan satu baris.

## Cara membaca

- **Ada** — permukaan mengekspos kemampuan itu hari ini.
- **Dashboard-only (sengaja)** — keputusan sadar, alasan di kolom
  Catatan. Bukan celah yang terlupa.
- Scope disebut untuk API v1; tier disebut untuk MCP
  (baca = selalu jalan; tulis = butuh `MCP_ALLOW_WRITES=1` di atas
  scope kunci).
- Kolom CLI adalah SPESIFIKASI nama perintah (implementasi Fase 14D).

## Matriks

| Kemampuan | Kontrak | API dashboard | API v1 (scope) | SDK | MCP (tier) | CLI (rencana) | Catatan / keputusan |
|---|---|---|---|---|---|---|---|
| Identitas tenant (`me`) | Ada | — (sesi) | Ada — `GET /v1/me` (kunci sah apa pun) | `me()` | `whoami` (baca) | `sk whoami` | Jangkar autentikasi semua permukaan mesin. |
| Kontak — daftar & cari | Ada | Ada | Ada — `GET /v1/contacts` (`contacts:read`) | `listContacts()` | `list_contacts` (baca) | `sk contacts list` | |
| Kontak — buat | Ada | Ada | Ada — `POST /v1/contacts` (`contacts:write`) | `createContact()` | `create_contact` (tulis) | `sk contacts create` | `customFields` tertulis sejak Fase 13A di semua permukaan. |
| Kontak — ubah (termasuk `customFields`) | Ada | Ada | Ada — `PATCH /v1/contacts/:id` (`contacts:write`) | `updateContact()` | `update_contact` (tulis, baru 15A — menutup celah 13A yang baru membawa SDK) | `sk contacts update` | Gabung per kunci untuk `customFields` (konsisten node flow `set_field`). Telepon/email memang bukan field PATCH kontrak — ubahnya lewat pembuatan/dedup. |
| Kontak — ambil satu & hapus | Ada (respons) | Ada (gabung konteks inbox) | Belum | — | — | `sk contacts get` (kandidat) | Keputusan 15A: ditunda sadar — daftar + cari + PATCH menutup kebutuhan integrasi saat ini; menambah `GET /v1/contacts/:id` murah dan tidak mengubah kontrak respons, kandidat fase permukaan berikutnya. Hapus kontak tetap aksi dashboard (destruktif + ada alur dedup/merge 9B). |
| Kontak — dedup & merge | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Merge adalah keputusan kurasi manusia dengan pratinjau kandidat; radius salah-merge besar untuk API key. |
| Percakapan — daftar | Ada | Ada | Ada — `GET /v1/conversations` (`conversations:read`) | `listConversations()` | `list_conversations` (baca) | `sk conversations list` | |
| Pesan — riwayat | Ada | Ada | Ada — `GET /v1/conversations/:id/messages` (`conversations:read`) | `listMessages()` | `list_messages` (baca) | `sk messages list` | Bacaan mesin tidak menandai percakapan terbaca (semantik inbox manusia). |
| Pesan — kirim keluar | Ada | Ada | Ada — `POST /v1/conversations/:id/messages` (`messages:write`) | `sendMessage()` | `send_message` (tulis) | `sk messages send` | Jalur antrean pengiriman yang sama dengan balasan dashboard. |
| Penugasan percakapan & catatan internal | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Alur kerja tim manusia dalam inbox; catatan internal memang dirancang tidak pernah keluar jalur pesan (tabel terpisah, Fase 9C). |
| Produk — daftar | Ada | Ada | Ada — `GET /v1/products` (`products:read`) | `listProducts()` | `list_products` (baca) | `sk products list` | |
| Produk — buat/ubah/arsip | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Katalog dikurasi pemilik di dashboard; pembacaan publik cukup untuk integrasi checkout eksternal. |
| Tautan bayar (payment links) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Permukaan bayar masih SIMULASI berlabel; eksposur publik diputuskan saat pembayaran asli (Fase 14A, Midtrans/Xendit). Halaman `/pay/:code` adalah permukaan publik non-v1 (kode tautan, tanpa kunci). |
| Komentar IG/Messenger — daftar | Ada | Ada | Ada — `GET /v1/comments` (`comments:read`) | `listComments()` | `list_comments` (baca) | `sk comments list` | Sejak Fase 10B. |
| Komentar — sembunyikan/tampilkan | Ada | Ada | Ada — `POST /v1/comments/:id/hide\|unhide` (`comments:write`) | `hideComment()` / `unhideComment()` | `hide_comment` / `unhide_comment` (tulis) | `sk comments hide` / `sk comments unhide` | Helper moderasi yang sama dengan dashboard: Graph dulu, lokal sesudahnya. |
| Broadcast — daftar & detail + statistik | Ada | Ada | **Ada (baru 15A)** — `GET /v1/broadcasts`, `GET /v1/broadcasts/:id` (`broadcasts:read`) | `listBroadcasts()` / `getBroadcast()` | `list_broadcasts` / `get_broadcast` (baca) | `sk broadcasts list` / `sk broadcasts get` | Paginasi kursor sama seperti dashboard. |
| Broadcast — buat/edit/jadwal/kirim/batal | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk broadcasts send` ditahan | Radius ledak: pengiriman massal tidak boleh terpicu API key sebelum mesin opt-in + segmentasi Fase 13C ada; gerbang template/24 jam juga ditegakkan di alur dashboard. |
| Broadcast — penerima per broadcast | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Statistik agregat sudah terekspos lewat detail; daftar penerima memuat identitas kontak massal — ditahan sampai ada kebutuhan integrasi konkret. |
| Flow — daftar & detail (termasuk graf) | Ada | Ada | **Ada (baru 15A)** — `GET /v1/flows`, `GET /v1/flows/:id` (`flows:read`) | `listFlows()` / `getFlow()` | `list_flows` / `get_flow` (baca) | `sk flows list` / `sk flows get` | Graf ikut terbaca (artefak tenant sendiri, bukan rahasia lintas tenant). |
| Flow — buat/edit graf/aktivasi/arsip | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Graf adalah artefak builder visual; aktivasi mengubah perilaku live terhadap pelanggan — keduanya keputusan Fase 12A/12B yang dipertahankan. |
| Flow — run & langkah run | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk flows runs` (kandidat) | Observabilitas eksekusi saat ini konsumsi operator di dashboard; kandidat permukaan baca berikutnya bila ada kebutuhan. |
| Template flow — katalog | Ada (`FLOW_TEMPLATES`) | Ada | **Ada (baru 15A)** — `GET /v1/flow-templates` (`flows:read`) | `listFlowTemplates()` | `list_flow_templates` (baca) | `sk flow-templates list` | Katalog statis dari kontrak — nol risiko data tenant. |
| Template flow — instantiate | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Instantiate adalah tulis (membuat draft flow) — mengikuti keputusan tulis flow di atas. |
| Otomasi — daftar & detail | Ada | Ada | **Ada (baru 15A)** — `GET /v1/automations`, `GET /v1/automations/:id` (`automations:read`) | `listAutomations()` / `getAutomation()` | `list_automations` / `get_automation` (baca) | `sk automations list` / `sk automations get` | Mencakup aturan kata kunci, sequence (+ langkah), dan aturan komentar (10B). |
| Otomasi — buat/edit/aktif-nonaktif | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Aturan yang aktif menembak otomatis ke pelanggan; perubahan dibatasi sesi dashboard owner/admin. |
| Otomasi — run & enrollment sequence | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk automations runs` (kandidat) | Sama seperti run flow: observabilitas operator. |
| Agen AI — daftar & detail konfigurasi | Ada | Ada | **Ada (baru 15A)** — `GET /v1/agents`, `GET /v1/agents/:id` (`agents:read`) | `listAgents()` / `getAgent()` | `list_agents` / `get_agent` (baca) | `sk agents list` / `sk agents get` | Prompt sistem ikut terbaca oleh kunci tenant sendiri (bukan lintas tenant). |
| Agen AI — buat/ubah konfigurasi | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Konfigurasi agen mengubah jawaban otomatis ke pelanggan; dibatasi sesi dashboard. |
| Agen AI — antrean saran (suggest) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Antrean persetujuan manusia yang terikat sesi inbox; menyetujui = mengirim pesan sebagai workspace. |
| Agen AI — Playground (dry-run) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Alat uji interaktif dashboard; memang tidak menulis apa pun, tetapi nilainya adalah UI perbandingan retrieval/niat tool. |
| Knowledge Base — entri (daftar & detail) | Ada | Ada | **Ada (baru 15A)** — `GET /v1/knowledge/documents`, `GET /v1/knowledge/documents/:id` (`knowledge:read`) | `listKnowledgeDocuments()` / `getKnowledgeDocument()` | `list_knowledge_documents` / `get_knowledge_document` (baca) | `sk kb list` / `sk kb get` | "Dokumen" di sini = entri KB (kb_documents), sesuai penamaan kontrak sejak 3A. |
| Knowledge Base — statistik indeks semantik | Ada | Ada | **Ada (baru 15A)** — `GET /v1/knowledge/stats` (`knowledge:read`) | `getKnowledgeStats()` | `get_knowledge_stats` (baca) | `sk kb stats` | Status provider di-resolve proses API (panel → env), sama seperti dashboard. |
| Knowledge Base — tulis entri (buat/edit/hapus) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Penulisan KB adalah kurasi manusia; pipeline chunking+embedding terpicu dari alur dashboard. |
| Knowledge Base — lampiran berkas (PDF/TXT/MD) | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk kb files` (kandidat, tunda) | Byte biner adalah provenance internal; teks hasil ekstraksinya sudah terekspos sebagai entri KB di atas. Unduh berkas asli memang tidak dibuat (keputusan 12C). |
| Channel — daftar & detail + kesehatan | Ada | Ada | **Ada (baru 15A)** — `GET /v1/channels`, `GET /v1/channels/:id` (`channels:read`) | `listChannels()` / `getChannel()` | `list_channels` / `get_channel` (baca) | `sk channels list` / `sk channels get` | Serializer kontrak tidak pernah membawa kredensial terenkripsi. Akun di Sampah tidak terekspos. Jalur v1 tidak memicu backfill foto bot (bacaan API key tanpa efek samping). |
| Channel — hubungkan (manual/OAuth)/putus/sampah | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Kustodi rahasia + alur OAuth interaktif per penyedia; token tidak pernah lewat API key. |
| Template WhatsApp — daftar cermin per akun | Ada | Ada | **Ada (baru 15A)** — `GET /v1/whatsapp-templates?channelAccountId=` (`whatsapp_templates:read`) | `listWhatsAppTemplates()` | `list_whatsapp_templates` (baca) | `sk whatsapp-templates list` | Gerbang akun sama seperti dashboard (milik tenant, bukan Sampah, provider WhatsApp). |
| Template WhatsApp — sinkron/buat/hapus di Meta | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Operasi berdampak ke Meta (aset WABA pemilik) dibatasi sesi dashboard owner/admin. |
| Saved replies | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Affordance composer inbox (`/`-picker) untuk tim manusia; nilai integrasi API rendah. |
| Tim & undangan | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Administrasi keanggotaan terikat identitas sesi + email undangan; bukan bentuk permukaan API key. |
| Analitik & pemakaian AI | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk usage report` (kandidat) | Agregat pelaporan berbentuk dashboard; ledger usage adalah catatan internal (kejujuran biaya 9B). Eksposur publik menunggu desain API billing. |
| API keys — kelola | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Kunci tidak boleh mengelola kunci (eskalasi privilese menurut konstruksi). |
| Audit log | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Permukaan akuntabilitas untuk admin workspace dalam sesi. |
| Integration logs & replay | Ada | Ada | Dashboard/platform-only (sengaja) | — | — | — | Memuat payload provider mentah; replay adalah aksi operator (tenant di /logs, tenant-NULL di Panel Admin — Fase 7B.2/13A). |
| Platform settings (Panel Admin) | Ada | Admin platform | Bukan permukaan tenant (sengaja) | — | — | — | Kustodi rahasia platform (OpenRouter/R2/Meta) di bawah allowlist email admin platform. |
| Webchat widget & sesi pengunjung | Ada | — (publik) | Permukaan publik non-v1 | — | — | — | Token pengunjung HMAC per situs (siteKey), bukan API key tenant — sengaja di luar registry v1 agar tidak tertukar. |

## Keadaan terukur (Fase 15A, 2026-11-03)

- **26 rute** API publik v1, semuanya terpetakan penuh di registry
  `PUBLIC_V1_SURFACE` (kontrak → API v1 → SDK → MCP) — nol
  pengecualian tanpa alasan pada permukaan v1.
- **14 scope** API key: 3 tulis (`contacts:write`, `messages:write`,
  `comments:write`) + 11 baca. Kunci baru tanpa scope eksplisit
  menerima 11 scope baca sebagai bawaan (preseden `comments:read`,
  Fase 10B).
- **26 metode** publik `SahabatKreatorClient` (SDK) dan **26 tool**
  MCP: 21 baca / 5 tulis (`create_contact`, `update_contact`,
  `send_message`, `hide_comment`, `unhide_comment`).
- Celah yang ditutup fase ini: permukaan BACA untuk broadcast, flow,
  template flow, otomasi, agen, channel, template WhatsApp, dan basis
  pengetahuan (15 rute + 15 metode SDK + 15 tool MCP), ditambah tool
  MCP `update_contact` yang tertinggal dari Fase 13A.
- Penjaga: `pnpm check:drift` (statik, tanpa server) — dibuktikan
  lulus pada tree selaras dan gagal pada pemetaan yang sengaja
  dirusak dua arah (registry dirusak; implementasi dirusak).
