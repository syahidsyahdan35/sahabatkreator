# Uji lokal lewat Cloudflare Tunnel + Neon + Upstash

Tujuan: menguji alur yang **butuh URL publik HTTPS** (dialog OAuth Meta,
callback, webhook bertanda tangan) tanpa men-deploy ke VPS staging.

Bukan pengganti staging. Yang diuji di sini adalah *perilaku* kode; yang
tidak diuji: systemd, `.env.staging` byte-identik, reverse-proxy produksi.

---

## 1. Arsitektur

```
browser ──► https://<host-tunnel>            (Cloudflare edge, TLS)
                 │
            cloudflared (mesin lokal)
                 │
                 ▼
        Vite dev server :5173  ◄── satu-satunya origin publik
                 ├── /api/*       ──► Hono API       :3101
                 ├── /realtime/*  ──► gateway WS     :3103
                 └── /go/*        ──► Hono API       :3101
worker (BullMQ)  ──► Upstash Redis
api / worker     ──► Neon Postgres
```

Kenapa cukup **satu** tunnel ke port 5173: `apps/web/vite.config.ts` sudah
meneruskan `/api`, `/realtime`, dan `/go` ke port lokal. Jadi dashboard dan
API tetap **satu origin** — cookie sesi same-origin, tidak perlu CORS, dan
`window.location.origin` di web otomatis menjadi URL tunnel.

---

## 2. Neon (Postgres)

1. Buat project, region **Singapore** (`ap-southeast-1`) — paling dekat.
2. Catat dua connection string dari dashboard:
   - **owner** (migrasi): `postgres://neondb_owner:…@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   - **pooled** (aplikasi): host mengandung `-pooler`
3. **Buat role aplikasi — jangan lewati langkah ini.**

   ```sql
   CREATE ROLE sk_app LOGIN PASSWORD '<password-kuat>';
   ```

   Alasannya bukan formalitas: migrasi proyek ini **tidak** memakai
   `FORCE ROW LEVEL SECURITY`, sehingga **pemilik tabel melewati RLS**.
   `neondb_owner` adalah pemilik tabel. Kalau aplikasi connect sebagai
   owner, Row Level Security tidak berjalan sama sekali — isolasi tenant
   bocor tanpa satu pun error. Uji lokal akan "lulus" sambil menguji
   sistem yang berbeda dari produksi.

4. Jalankan rantai migrasi + grant + audit dari mesin lokal:

   ```bash
   export MIGRATION_DATABASE_URL='postgres://neondb_owner:…@ep-xxx…/neondb?sslmode=require'
   pnpm --filter @sahabat-kreator/db db:migrate
   pnpm --filter @sahabat-kreator/db db:grant
   pnpm --filter @sahabat-kreator/db db:doctor    # harus exit 0
   ```

   `db:grant` idempoten; `db:doctor` memeriksa hak DML nyata, RLS aktif,
   dan default privileges. Kalau doctor gagal, jangan lanjut — API akan
   hidup tapi setiap query "permission denied".

5. Ekstensi: `vector` (pgvector) dan `btree_gist` dibuat oleh migrasi.
   Neon mendukung keduanya; `neondb_owner` boleh `CREATE EXTENSION`.

**Soal pooler:** `-pooler` adalah pgbouncer transaction mode. Helper
`withTenant` memakai `set_config('app.tenant_id', …, true)` yang bersifat
transaksi-lokal — kompatibel. Jangan menambahkan prepared statement
bernama di jalur query.

---

## 3. Upstash (Redis)

1. Buat database, region sama dengan Neon.
2. `REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379`
   (ioredis mendukung `rediss://` / TLS secara bawaan).

**Risiko yang harus diketahui:** BullMQ membutuhkan koneksi *blocking*
(`maxRetriesPerRequest: null`) dan membuka beberapa koneksi sekaligus,
sementara free tier Upstash membatasi jumlah koneksi bersamaan dan bisa
menolak perintah blocking. Gejala: worker restart-loop atau
`max clients reached`.

Kalau itu terjadi, **campur saja**: queue/worker pakai Redis lokal,
API tetap Upstash.

```bash
docker compose up -d redis        # redis lokal di :6379
# lalu worker dijalankan dengan REDIS_URL=redis://localhost:6379
```

---

## 4. Tunnel

### Opsi A — named tunnel (stabil, disarankan)

Butuh satu domain di Cloudflare. URL tetap, jadi redirect URI Meta cukup
didaftarkan **sekali**.

```bash
cloudflared tunnel login          # sekali saja, membuka browser
cloudflared tunnel create sk-local
cloudflared tunnel list           # catat ID tunnel (kolom pertama)
cloudflared tunnel route dns sk-local dev.<domain-anda>
```

`~/.cloudflared/config.yml` — **path kredensial harus path Windows**, karena
`cloudflared` di Windows tidak memahami `/c/Users/...` gaya Git Bash:

```yaml
tunnel: <tunnel-id>
credentials-file: C:\Users\<user>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: dev.<domain-anda>
    service: http://localhost:5173
  - service: http_status:404
```

Konversi path kalau perlu: `cygpath -w ~/.cloudflared/<tunnel-id>.json`.

```bash
cloudflared tunnel run sk-local
```

Catatan: `tunnel route dns` gagal bila record sudah ada — aman, lanjutkan.

### Opsi B — quick tunnel (tanpa domain)

```bash
cloudflared tunnel --url http://localhost:5173
```

URL `https://<acak>.trycloudflare.com` **berubah setiap kali dijalankan**.
Konsekuensinya: redirect URI di Meta console harus di-paste ulang tiap
start. Untuk uji sekali jalan tidak masalah; untuk iterasi, Opsi A jauh
lebih nyaman.

---

## 5. `.env`

```bash
cp .env.example .env
```

Yang **wajib** diubah untuk skenario ini:

| Variabel | Nilai |
|---|---|
| `DATABASE_URL` | connection string **pooled**, user `sk_app` |
| `REDIS_URL` | `rediss://…upstash.io:6379` (atau `redis://localhost:6379`) |
| `BETTER_AUTH_URL` | `https://<host-tunnel>` — origin yang dilihat browser |
| `DEV_TUNNEL_HOST` | `<host-tunnel>` **tanpa** `https://` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `CHANNEL_TOKEN_SECRET` | base64 dari 32 byte acak |
| `META_APP_ID`, `META_APP_SECRET` | dari Meta App Dashboard |
| `META_WEBHOOK_VERIFY_TOKEN` | string acak pilihan sendiri |
| `META_ENGAGEMENT_SCOPES` | **biarkan `0`** — justru ini yang sedang diuji |

`API_PORT` biarkan `3101` (sudah diselaraskan dengan proxy Vite; nilai lain
membuat dashboard tidak bisa memanggil API).

`BETTER_AUTH_URL` menentukan redirect URI OAuth:
`${BETTER_AUTH_URL}/api/meta/oauth/callback`. Karena itu ia harus URL
tunnel, bukan `localhost`.

---

## 6. Menjalankan

Repo ini **tidak** memakai dotenv — `loadEnv()` membaca `process.env`
langsung. Muat `.env` ke shell sekali, lalu semua proses mewarisinya:

```bash
set -a; . ./.env; set +a
```

`pnpm dev` di root hanya menjalankan API + web. Untuk uji penuh jalankan
**empat** proses (terminal terpisah, semuanya setelah `set -a` di atas):

```bash
pnpm --filter @sahabat-kreator/api      dev
pnpm --filter @sahabat-kreator/realtime dev
pnpm --filter @sahabat-kreator/worker   dev
pnpm --filter @sahabat-kreator/web      dev
```

Lalu tunnel (Opsi A atau B).

Alternatif tanpa mengubah shell: `tsx --env-file=../../.env watch src/index.ts`
(sudah diverifikasi bekerja pada tsx 4.x).

---

## 7. Meta App Dashboard

1. **Valid OAuth Redirect URIs** → tambahkan
   `https://<host-tunnel>/api/meta/oauth/callback`
2. **Webhook** → Callback URL `https://<host-tunnel>/api/meta/webhook`,
   Verify Token = `META_WEBHOOK_VERIFY_TOKEN`
3. App tetap **Development Mode**; akun yang dipakai menguji harus terdaftar
   sebagai Admin/Developer/Tester di app.
4. `META_ENGAGEMENT_SCOPES` tetap `0` → dialog hanya meminta
   `pages_show_list`, `pages_messaging`, `pages_manage_metadata`,
   `business_management`. Kalau dialog masih menyebut
   `pages_read_engagement` dan kawan-kawan, berarti flag/`.env` salah
   terbaca — bukan masalah di Meta.

---

## 8. Verifikasi

```bash
# API hidup dan melihat DB/Redis
curl -s https://<host-tunnel>/api/health
curl -s https://<host-tunnel>/api/ready

# Halaman dashboard (bukan 403 — bukti allowedHosts benar)
curl -s -o /dev/null -w '%{http_code}\n' https://<host-tunnel>/
```

Di UI:

1. Daftar akun → buat workspace (menulis lewat `sk_app`, jadi RLS dan
   grant ikut teruji).
2. Hubungkan Page → **periksa URL dialog**: `scope=` hanya berisi 4 izin
   core. Ini inti perbaikan `404d1f7`.
3. Setujui → callback mendarat di `/api/meta/oauth/callback` → kanal
   tersimpan.
4. Kirim pesan ke Page → webhook masuk (cek log API: tanda tangan valid),
   worker memproses, balasan terkirim.
5. Moderasi komentar: `POST /api/tenants/:id/comments/:commentId/hide`.
   Di Development Mode ini **berhasil** untuk Page milik akun tester —
   Graph tidak menegakkan izin di mode itu. Penolakan izin hanya muncul
   di Live Mode tanpa Advanced Access, dan itu memang tidak bisa
   direproduksi lokal.

---

## 9. Jebakan yang sudah ditemui

| Gejala | Sebab |
|---|---|
| Semua request tunnel dijawab **403** | Vite ≥5.4.12 menolak Host tak dikenal. Isi `DEV_TUNNEL_HOST`. |
| `/api/*` 502 / koneksi ditolak | `API_PORT` bukan `3101`, proxy Vite menunjuk port kosong. |
| Login "berhasil" tapi sesi hilang | `BETTER_AUTH_URL` tidak sama dengan origin browser → cookie tidak terkirim. |
| Query "permission denied" | Migrasi dijalankan tapi `db:grant` belum; atau `DATABASE_URL` memakai owner sementara grant untuk `sk_app`. |
| Data tenant lain terlihat | Aplikasi connect sebagai `neondb_owner` (pemilik tabel) → RLS dilewati. |
| Worker restart-loop, `max clients reached` | Batas koneksi Upstash free tier. Pindahkan worker ke Redis lokal. |
| Redirect URI mismatch saat callback | URL quick tunnel berubah; daftarkan ulang di Meta, atau pakai named tunnel. |
