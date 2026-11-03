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
| Tautan bayar (payment links) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Halaman `/pay/:code` adalah permukaan publik non-v1 (kode tautan, tanpa kunci). Sejak Fase 14A provider tautan mengikuti konfigurasi tenant: 'simulation' berlabel jujur di halaman, atau Midtrans/Xendit sungguhan — halaman mengarahkan pembeli ke URL checkout provider (`checkoutUrl`) dan status akhir datang dari webhook. Eksposur v1 untuk pembuatan tautan tetap TIDAK dibuat: tautan lahir dari dashboard/flow/agent di dalam percakapan tenant, bukan dari integrasi berkunci API. |
| Konfigurasi gerbang pembayaran tenant (Fase 14A) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Kredensial provider MILIK TENANT (uang kreator masuk ke akun merchant-nya sendiri): Settings → Payments (`GET/PUT /tenants/:tenantId/payment-settings` + uji koneksi `POST .../test`, owner/admin untuk tulis). Kunci sandbox & production terpisah, tersimpan envelope terenkripsi, dan TIDAK PERNAH keluar lagi — API hanya melaporkan penanda terkonfigurasi per pasangan. Permukaan kredensial tidak pernah menjadi API v1/SDK/MCP (preseden kredensial yang sama dengan token channel & Panel Admin). Webhook provider (`POST /payments/webhook/midtrans|xendit`) adalah permukaan publik non-v1: autentikasi kriptografis per tenant (signature_key SHA512 Midtrans / x-callback-token Xendit, di-resolve dari tautan), jumlah wajib cocok, idempoten, dan tercatat di log integrasi teredaksi. |
| Order — daftar & detail (Fase 13F) | Ada | Ada | **Ada (baru 13F)** — `GET /v1/orders`, `GET /v1/orders/:id` (`orders:read`) | `listOrders()` / `getOrder()` | `list_orders` / `get_order` (baca) | `sk orders list` / `sk orders get` | Order lahir dari checkout flow (node `cart_checkout`): baris item adalah SNAPSHOT nama+harga saat checkout, total dihitung server dari snapshot keranjang, dan status order MENGIKUTI tautan bayarnya (pending → paid/expired/cancelled; hook sinkron idempoten di titik penyelesaian pembayaran yang sama dengan tautan produk tunggal). Serializer bersama dashboard + v1 persis sama. Sejak Fase 14A tautan order bisa ber-provider Midtrans/Xendit (sesi disiapkan sebelum transaksi checkout) dan penyelesaian webhook membalik order lewat hook yang sama. |
| Keranjang belanja (Fase 13F) | Ada | Ada | Dashboard-only (sengaja) — tanpa rute v1/SDK/MCP | — | — | — | Keranjang adalah KEADAAN SESI efemeral per kontak di dalam percakapan: diisi node flow `show_catalog` (parkir pilihan, pola mesin parkir yang sama dengan questionnaire), dikonsumsi `cart_checkout`, dan tidak punya siklus hidup integrasi sendiri — mengeksposnya akan membekukan bentuk sesi internal menjadi kontrak publik. Yang terekspos adalah HASILNYA yang stabil: order (baris di atas) + tautan bayarnya. Inspeksi keranjang dari detail kontak disengaja tidak dibuat fase ini (bukan permukaan operator yang diminta; isi keranjang terlihat dari ringkasan chat itu sendiri). |
| Flow — node show_catalog & cart_checkout (Fase 13F) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Kedua node adalah bagian dari GRAF flow (pola yang sama dengan questionnaire 13E): config-nya (`introText?`, `showDescription`, tenggat per parkir, `maxInvalidAttempts`, `invalidPrompt?`, `addedMessage?` untuk katalog; `emptyMessage?` untuk checkout) hidup di dalam graf yang sudah terbaca v1 lewat baris "Flow — daftar & detail" — BUKAN permukaan baru. Balasan pilihan katalog memakai mesin parkir `wait_reply` yang sama dan TIDAK bocor ke agent (gerbang worker menghitung `flowCatalogResumed`). Agent mendapat akses BACA katalog lewat konteks prompt (daftar produk aktif di prompt sistem — runtime agent berjalan satu completion tanpa putaran hasil-tool, jadi tool baca tidak akan pernah dilihat model); tulis keranjang/checkout tetap eksklusif flow. |
| Booking janji temu — daftar (Fase 13G) | Ada | Ada | **Ada (baru 13G)** — `GET /v1/appointments` (filter from/to/status), `GET /v1/appointment-services` (`appointments:read`) | `listAppointments()` / `listAppointmentServices()` | `list_appointments` / `list_appointment_services` (baca) | `sk appointments list` | Booking lahir dari DUA jalur tulis saja (node flow `book_appointment` + pembuatan manual dashboard) dan keduanya memakai fungsi inti yang sama (`createBooking`) — permukaan publik SENGAJA baca-saja: janji temu adalah hasil percakapan/keputusan operator, bukan artefak yang dibuat integrasi eksternal; yang dibutuhkan integrasi adalah MEMBACA jadwal (sinkron kalender eksternal, pengingat, laporan). Serializer bersama dashboard + v1 persis sama. Anti-double-booking ditegakkan DI DATA: constraint eksklusi GiST atas rentang tstzrange booking `confirmed` per tenant (batal membebaskan rentang). |
| Layanan janji, ketersediaan mingguan, mutasi booking (Fase 13G) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Layanan (nama/durasi/deskripsi/aktif), jadwal ketersediaan mingguan + zona waktu janji + lead time minimum, pembuatan manual, dan pembatalan adalah konfigurasi & aksi operator di halaman Appointments — pola yang sama dengan segmen/broadcast tulis (13C): artefak kurasi UI, bukan permukaan mesin. Slot yang bisa dipesan dihitung SATU fungsi inti (`getBookableSlots`) untuk dashboard maupun chat: jendela mingguan ∩ masa depan+lead time − booking confirmed − busy Google (bila terhubung), semua matematika di zona waktu janji tenant. |
| Flow — node book_appointment (Fase 13G) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Bagian dari GRAF flow (pola 13E/13F): config (`serviceId`, `daysAhead`, `slotsPerMessage`, tenggat, `maxInvalidAttempts`, `invalidPrompt?`, `bookedMessage?`) hidup di graf yang terbaca v1 lewat baris flow — BUKAN permukaan baru. Daftar slot bernomor (tanggal+jam dwibahasa di zona tenant) diparkir di mesin `wait_reply`; pilihan sah → booking (transaksi sendiri, pola dashboard) → branch `booked`; pilihan atas slot yang keburu diambil → pemberitahuan + daftar SEGAR ditawarkan ulang (parkir lagi, attempts tidak bertambah), dan branch `slot_taken` hanya bila daftar segar kosong; branch `invalid`/`timeout` seperti node parkir lain. Balasan parkir TIDAK bocor ke agent (gerbang `flowAppointmentResumed`). Pembatalan lewat CHAT sengaja TIDAK dibangun v1: pembatalan adalah aksi dashboard — mendesain jalur chat (pilih booking mana dari daftar, konfirmasi) adalah mesin percakapan baru yang tidak diminta; kontak yang membatalkan lewat chat ditangani operator/agent seperti percakapan biasa. |
| Koneksi Google Calendar tenant (Fase 13G) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | OAuth per tenant dari halaman Appointments memakai klien OAuth PLATFORM (Panel Admin: `google_oauth_client_id` publik + `google_oauth_client_secret` rahasia; pola resolver & kejujuran 11B — tanpa klien platform, connect menjawab 422 `GOOGLE_NOT_CONFIGURED`, bukan tombol mati). Token tenant terenkripsi envelope yang sama dengan kredensial channel. Sinkronisasi adalah PENINGKATAN, bukan syarat: booking selalu berhasil internal; buat/hapus event Google berjalan via outbox (`appointment.google_sync`) dan kegagalannya tercatat di booking (`googleSyncStatus`/`googleSyncError`) TANPA pernah menggagalkan booking. Freebusy Google memotong slot di mesin slot yang sama. Bukti live menunggu klien OAuth Google Cloud milik user (project + Calendar API + consent screen + redirect URI `https://botara.my.id/api/google/oauth/callback`). |
| Komentar IG/Messenger — daftar | Ada | Ada | Ada — `GET /v1/comments` (`comments:read`) | `listComments()` | `list_comments` (baca) | `sk comments list` | Sejak Fase 10B. |
| Komentar — sembunyikan/tampilkan | Ada | Ada | Ada — `POST /v1/comments/:id/hide\|unhide` (`comments:write`) | `hideComment()` / `unhideComment()` | `hide_comment` / `unhide_comment` (tulis) | `sk comments hide` / `sk comments unhide` | Helper moderasi yang sama dengan dashboard: Graph dulu, lokal sesudahnya. |
| Broadcast — daftar & detail + statistik | Ada | Ada | **Ada (baru 15A)** — `GET /v1/broadcasts`, `GET /v1/broadcasts/:id` (`broadcasts:read`) | `listBroadcasts()` / `getBroadcast()` | `list_broadcasts` / `get_broadcast` (baca) | `sk broadcasts list` / `sk broadcasts get` | Paginasi kursor sama seperti dashboard. |
| Broadcast — buat/edit/jadwal/kirim/batal | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk broadcasts send` ditahan | Radius ledak: pengiriman massal tetap tidak boleh terpicu API key. Mesin opt-in + segmentasi Fase 13C SUDAH ada dan ditegakkan di alur dashboard (gerbang `require_opt_in`, template, 24 jam); keputusan dashboard-only dipertahankan karena pengiriman massal adalah aksi operator bervolume. |
| Broadcast — gerbang opt-in & pratinjau audiens | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Fase 13C: kolom `require_opt_in` (bawaan true untuk WhatsApp, selain itu false; dapat diubah selama draft) + endpoint pratinjau `GET /broadcasts/audience-preview` yang memakai fungsi klasifikasi inti yang SAMA dengan materialisasi penerima saat dispatch — satu logika, tanpa duplikasi. Alasan skip baru: `not_opted_in`. |
| Segmen kontak — daftar & detail | Ada | Ada | **Ada (baru 13C)** — `GET /v1/segments`, `GET /v1/segments/:id` (`segments:read`) | `listSegments()` / `getSegment()` | `list_segments` / `get_segment` (baca) | `sk segments list` / `sk segments get` | Evaluator SATU di core dipakai daftar kontak, pratinjau broadcast, dan materialisasi dispatch. Hitungan anggota tidak disimpan di respons — permukaan hitungan adalah pratinjau (dashboard). |
| Segmen kontak — buat/edit/hapus | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Segmen adalah artefak kurasi UI (pembuat kondisi visual + definisi kompleks); tulis dibatasi sesi dashboard owner/admin (keputusan Fase 13C). |
| Opt-in broadcast — pengaturan tenant & status kontak | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Fase 13C: kata kunci opt-in/opt-out tambahan tenant + teks konfirmasi adalah konfigurasi perilaku inbox (kartu "Opt-in Broadcast" di halaman Broadcasts). Status kontak terekspos ADITIF di serializer kontak semua permukaan: `optInStatus` (tersimpan) + `optInEffectiveStatus`/`optInSource`/`optInAt` (turunan/jejak). Konversi growth link SENGAJA bukan opt-in pemasaran (klik/memulai chat ≠ persetujuan). |
| Broadcast — penerima per broadcast | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Statistik agregat sudah terekspos lewat detail; daftar penerima memuat identitas kontak massal — ditahan sampai ada kebutuhan integrasi konkret. |
| Broadcast — uji A/B: konfigurasi varian B + rincian per varian | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Fase 13D: `abSplitPercentB` + isi/template varian B diatur di formulir dashboard (kolom varian SENGAJA tidak ditambahkan ke `BroadcastResponse` agar permukaan v1 tidak ikut berubah); rincian per varian dari `GET /broadcasts/:id/ab-results` (penugasan deterministik hash broadcast+kontak, alasan skip 13C utuh per varian). Atribusi balasan SENGAJA tidak dihitung: tidak ada tautan tersimpan dari pesan masuk ke (broadcast, varian), jadi angka balasan akan menjadi tebakan. Penugasan & hasil eksperimen adalah artefak kurasi builder/pelaporan operator — alasan yang sama seperti baris broadcast & flow di atas. |
| Flow — daftar & detail (termasuk graf) | Ada | Ada | **Ada (baru 15A)** — `GET /v1/flows`, `GET /v1/flows/:id` (`flows:read`) | `listFlows()` / `getFlow()` | `list_flows` / `get_flow` (baca) | `sk flows list` / `sk flows get` | Graf ikut terbaca (artefak tenant sendiri, bukan rahasia lintas tenant). |
| Flow — buat/edit graf/aktivasi/arsip | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Graf adalah artefak builder visual; aktivasi mengubah perilaku live terhadap pelanggan — keduanya keputusan Fase 12A/12B yang dipertahankan. |
| Flow — run & langkah run | Ada | Ada | Dashboard-only (sengaja) | — | — | `sk flows runs` (kandidat) | Observabilitas eksekusi saat ini konsumsi operator di dashboard; kandidat permukaan baca berikutnya bila ada kebutuhan. |
| Flow — eksperimen A/B: mode eksperimen split + hasil | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Fase 13D: config `experiment`/`experimentLabel`/`conversionNodeId` hidup DI DALAM graf node ab_split (graf memang sudah terbaca v1 sejak 15A, sama seperti `percentA` — bukan permukaan baru); yang dashboard-only adalah HASILNYA: `GET /flows/:id/experiments` (penugasan unik per varian dari tabel `flow_experiment_assignments`, run/selesai/konversi, putusan uji z dua-proporsi dengan pagar sampel minimum — tanpa klaim signifikansi di bawah pagar). Hasil eksperimen adalah artefak pelaporan builder/operator, sejajar preseden run flow di atas. |
| Flow — node questionnaire (Fase 13E) | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Node `questionnaire` adalah bagian dari GRAF flow (seperti semua tipe node lain sejak 8A/12A): config-nya (`questions[]`, tenggat per pertanyaan, `maxInvalidAttempts`, `invalidPrompt?`, `completionTag?`) hidup di dalam graf yang memang sudah terbaca v1 lewat baris "Flow — daftar & detail" di atas — BUKAN permukaan baru, jadi tidak ada rute/SDK/MCP yang ditambahkan fase ini. Eksekusinya memakai mesin parkir `wait_reply` yang sama (context.wait + state `context.questionnaire`); tidak ada skema DB baru. Catatan definisi: produk tidak punya registri definisi field custom — target `custom:<key>` divalidasi terhadap himpunan kunci `custom_fields` yang dibawa kontak tenant (`QUESTIONNAIRE_TARGET_UNKNOWN` saat aktivasi; pemeriksaan ulang setiap pertanyaan hendak dikirim → keluar `invalid`/lewati dengan outcome `target_missing`). |
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
| Growth links — daftar & detail + statistik | Ada | Ada | **Ada (baru 13B)** — `GET /v1/growth-links`, `GET /v1/growth-links/:id` (`growth_links:read`) | `listGrowthLinks()` / `getGrowthLink()` | `list_growth_links` / `get_growth_link` (baca) | `sk growth-links list` / `sk growth-links get` | Statistik (klik / tampilan picker / konversi) DITURUNKAN dari `growth_link_events`, bukan penghitung tersimpan. Serializer sama persis dengan dashboard. |
| Growth links — buat/edit/nonaktif/hapus | Ada | Ada | Dashboard-only (sengaja) | — | — | — | Slug publik + branding adalah artefak kurasi UI (keputusan Fase 13B): URL-nya tersebar di bio/iklan/cetakan, jadi perubahannya dibatasi sesi dashboard owner/admin. |
| Tautan publik `/go/:slug` & landing picker | Ada | — (publik) | Permukaan publik non-v1 | — | — | — | Pola yang sama seperti `/pay/:code`: tanpa kunci, slug publik adalah alamatnya. Mencatat `click`/`picker_view` lalu 302 ke platform (wa.me / t.me / m.me / ig.me / halaman webchat). Atribusi kontak terjadi di jalur inbound (Telegram `/start`, referral Meta, sesi webchat `src`) — WhatsApp memang tidak punya payload kedatangan, jadi untuk WA hanya klik yang tercatat (dinyatakan jujur di UI). |
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

## Pembaruan Fase 13B (2026-11-03) — Growth Tools

- **28 rute** API publik v1 (bertambah 2: growth links baca).
- **15 scope** API key: 3 tulis + 12 baca — scope baru
  `growth_links:read` ikut menjadi bawaan kunci baru (preseden yang
  sama seperti scope baca 15A).
- **28 metode** publik SDK dan **28 tool** MCP: 23 baca / 5 tulis
  (tool tulis tidak berubah; growth links baca saja).
- `pnpm check:drift` lulus pada permukaan yang diperluas.

## Pembaruan Fase 13C (2026-11-03) — Mesin Opt-in Broadcast + Segmentasi

- **30 rute** API publik v1 (bertambah 2: segmen baca).
- **16 scope** API key: 3 tulis + 13 baca — scope baru
  `segments:read` ikut menjadi bawaan kunci baru (preseden yang sama).
- **30 metode** publik SDK dan **30 tool** MCP: 25 baca / 5 tulis
  (tool tulis tidak berubah; segmen baca saja).
- Kontrak kontak berubah ADITIF: `optInEffectiveStatus`,
  `optInSource`, `optInAt` di serializer bersama dashboard + v1
  (`optInStatus` tersimpan tetap dipertahankan — regresi nol).
- `pnpm check:drift` lulus pada permukaan yang diperluas; rantai
  verifikasi terisolasi Fase 13C: **82 PASS / 0 FAIL** (consent
  keyword dua arah + konfirmasi sekali per transisi, paritas
  pratinjau↔materialisasi, evaluator 8 tipe kondisi + all/any,
  isolasi tenant, regresi 7C/10A, verify-sdk + verify-mcp hijau).

## Pembaruan Fase 13F (2026-11-03) — Katalog + Keranjang Commerce

- **32 rute** API publik v1 (bertambah 2: order baca).
- **17 scope** API key: 3 tulis + 14 baca — scope baru `orders:read`
  ikut menjadi bawaan kunci baru (preseden yang sama seperti
  scope baca 15A/13B/13C).
- **32 metode** publik SDK dan **32 tool** MCP: 27 baca / 5 tulis
  (tool tulis tidak berubah; order baca saja).
- Skema baru: `carts` + `cart_items` (keranjang terbuka unik per
  kontak via indeks unik parsial; harga baris adalah snapshot saat
  item PERTAMA ditambahkan) dan `orders` + `order_items` (snapshot
  checkout; total dihitung server). `payment_links` menjadi
  dual-varian: `product_id` nullable + `order_id` + CHECK tepat
  satu target — halaman publik `/pay/:code` melayani kedua varian
  tanpa perubahan permukaan.
- Node flow baru `show_catalog` (katalog bernomor → parkir pilihan
  "N" / "NxM" → branch added/invalid/timeout) dan `cart_checkout`
  (ringkasan + order + satu tautan bayar → branch
  checked_out/empty_cart); `view_cart` SENGAJA dilipat ke langkah
  tampil checkout, bukan node ketiga.
- `pnpm check:drift` lulus pada permukaan yang diperluas.

## Pembaruan Fase 13G (2026-11-03) — Janji Temu + Google Calendar

- **34 rute** API publik v1 (bertambah 2: booking janji + layanan
  janji, keduanya baca).
- **18 scope** API key: 3 tulis + 15 baca — scope baru
  `appointments:read` ikut menjadi bawaan kunci baru (preseden
  yang sama seperti scope baca 15A/13B/13C/13F).
- **34 metode** publik SDK dan **34 tool** MCP: 29 baca / 5 tulis
  (tool tulis tidak berubah; janji temu baca saja — alasan di
  baris matriks).
- Skema baru (migrasi 0006): `appointment_services`,
  `appointment_settings` (zona waktu + lead time per tenant),
  `appointment_availability` (jendela mingguan), `bookings`
  (constraint eksklusi GiST `bookings_no_overlap_confirmed` atas
  rentang booking confirmed per tenant — anti-double-booking di
  lapisan data), `google_calendar_connections` (token terenkripsi,
  unik per tenant).
- Fase ini bekerja PENUH tanpa Google (kalender internal);
  Google Calendar adalah sinkronisasi tambahan: event dibuat/
  dihapus via outbox, freebusy memotong slot, kegagalan sinkron
  tercatat di booking dan tidak pernah menggagalkan booking.
- `pnpm check:drift` lulus pada permukaan yang diperluas.

## Pembaruan Fase 14A (2026-11-03) — Pembayaran Asli Midtrans + Xendit

- **34 rute** API publik v1 — TIDAK berubah: fase ini tidak menambah
  rute v1, scope, metode SDK, atau tool MCP. Yang berubah adalah
  PERILAKU di balik permukaan yang sudah ada (tautan bayar & order),
  bukan permukaannya.
- **18 scope** API key — tidak berubah (3 tulis + 15 baca).
- Skema baru (migrasi 0007): `payment_provider_configs` (satu baris
  per tenant; provider aktif + environment aktif + kunci Midtrans/
  Xendit sandbox & production sebagai envelope terenkripsi +
  token callback Xendit per environment) dan kolom
  `payment_links.provider_environment` (snapshot per tautan),
  `provider_ref` (token Snap / id invoice), `checkout_url`.
- Provider tautan kini mengikuti konfigurasi TENANT: sesi checkout
  dibuat saat tautan dibuat (Snap `POST /snap/v1/transactions`
  dengan order_id = kode tautan; Xendit `POST /v2/invoices` dengan
  external_id = kode tautan). Kegagalan provider membatalkan
  pembuatan tautan dengan kode provider (502 di dashboard) — tidak
  ada fallback diam-diam ke simulasi.
- Penyelesaian pembayaran sungguhan HANYA lewat webhook
  (`/payments/webhook/midtrans|xendit`): verifikasi kriptografis
  per tenant, jumlah wajib sama dengan amount tautan, idempoten
  (transisi hanya dari pending; audit `payment.paid` sekali), dan
  order 13F membalik lewat hook sinkron yang sama. Endpoint
  simulate-pay menolak tautan non-simulasi (409
  `PAYMENT_NOT_SIMULATION`). Kedaluwarsa tetap ditegakkan lokal
  (lazy/bulk yang sudah ada) — untuk provider sungguhan itu adalah
  kebenaran TAMPILAN: Snap/invoice di provider punya masa berlakunya
  sendiri dan webhook `expire`/`EXPIRED` provider tetap didengar
  selama tautan masih pending di kita.
- Dashboard: Settings → Payments (provider, toggle environment,
  kunci per environment tertutup, uji koneksi berkode jujur
  mengikuti preseden probe Resend 11B, URL webhook untuk
  didaftarkan di dashboard provider). Halaman `/pay/:code`:
  simulasi berlabel seperti sebelumnya; provider sungguhan
  mengarahkan pembeli ke `checkoutUrl` (pengalihan di sisi halaman
  karena `/pay/:code` adalah rute SPA — API-nya JSON).
- Bukti live menunggu akun merchant milik user (sandbox Midtrans /
  Xendit + kunci ditempel di Settings → Payments + URL webhook
  didaftarkan di dashboard provider); seluruh rantai fase ini
  dibuktikan terhadap server mock provider.
- `pnpm check:drift` lulus (34 rute, tanpa perubahan permukaan).

