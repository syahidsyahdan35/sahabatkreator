# Deploy Docker — sahabatkreator.my.id (server claw-vps2)

Deploy kedua Sahabat Kreator, terpisah dari staging `botara.my.id`
(docs/DEPLOY-STAGING.md — systemd + Cloudflare Tunnel). Di sini:

- Server: `43.173.6.204` (Ubuntu 24.04, user `ubuntu`, sudo passwordless),
  clone di `~/sahabat-kreator` (mode pull, deploy key repo di `~/.ssh` server).
- **Semua aplikasi = container Docker.** Host hanya punya Docker + nginx;
  TIDAK ada node/pnpm/systemd-unit untuk aplikasi. pnpm hanya hidup di
  tahap builder Dockerfile (package manager monorepo).
- **Tanpa tunnel.** nginx host adalah edge; DNS `sahabatkreator.my.id`
  diarahkan langsung ke IP server oleh pemilik domain (Cloudflare).
- TLS (certbot/Let's Encrypt) dilakukan SETELAH DNS menunjuk ke server —
  sebelum itu site hanya menjawab HTTP dengan Host header yang benar.

## Topologi

| Jalur publik (nginx host) | Tujuan | Keterangan |
| --- | --- | --- |
| `/` | `127.0.0.1:5180` web container | nginx-in-container, SPA statis |
| `/api/`, `/go/` | `127.0.0.1:3101` api container | Hono, bridge network |
| `/realtime/` | `127.0.0.1:3103` realtime | websocket, upgrade header |

Container lain: `db` (pgvector pg16, publish loopback 5434),
`redis` (publish loopback 6381), `migrate` (sekali jalan, exit 0 =
gerbang start api/worker/realtime), `worker` (tanpa port).
`realtime` memakai `network_mode: host` — alasannya tertulis di kepala
`docker-compose.prod.yml`.

## Env server: `.env.production`

Satu-satunya berkas rahasia, di root clone server, mode 600, tidak
pernah di-commit (`.env.*` di-.gitignore). Isi (nilai digenerate DI
server, tidak pernah lewat chat/log). FORMAT WAJIB: dua secret kripto
harus `openssl rand -base64 32` (base64 dari tepat 32 byte —
`packages/core` deriveKey menolak format lain; hex PERNAH menyebabkan
500 pertama di Panel Admin deployment ini, 2026-11-05, lalu diperbaiki
sebelum ada data terenkripsi): `CHANNEL_TOKEN_SECRET` dan
`PLATFORM_SETTINGS_SECRET`. Sisanya bebas (hex aman):

- `NODE_ENV=production`, `API_PORT=3101`, `REALTIME_PORT=3103`
- `BETTER_AUTH_URL=https://sahabatkreator.my.id`
- `PLATFORM_ADMIN_EMAILS=mas@romo.com`
- Secret baru: `BETTER_AUTH_SECRET`, `CHANNEL_TOKEN_SECRET`,
  `PLATFORM_SETTINGS_SECRET`, `WEBCHAT_SECRET`
- `SK_MIGRATION_PASSWORD`, `SK_APP_PASSWORD` (password dua role PG)
- `DATABASE_URL` (role `sk_app`, host `db:5432`),
  `MIGRATION_DATABASE_URL` (role `sk_migration`, host `db:5432`),
  `REDIS_URL=redis://redis:6379`

Role `sk_app` dibuat oleh `docker/initdb/01-app-role.sh` saat volume PG
pertama kali lahir; grant-nya datang dari migrasi 0009. Kunci
Meta/OpenRouter/R2/Resend sengaja kosong dulu — diisi lewat Panel Admin
(string kosong = tidak diset, sejak commit 5549e9c).

## Perintah

Selalu dari `~/sahabat-kreator` di server, selalu dengan env file:

```sh
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
$COMPOSE build            # build image app + web dari commit checkout saat ini
$COMPOSE up -d            # migrate berjalan dulu, lalu api/worker/realtime/web
$COMPOSE ps               # status; migrate harus Exited (0)
$COMPOSE logs -f api      # log per service: api|worker|realtime|web|db|redis
curl http://127.0.0.1:3101/api/health
```

Update rilis berikutnya: `git fetch origin && git reset --hard origin/main`
lalu ulangi `build` + `up -d`. Tidak ada rsync dist dan tidak ada restart
unit manual — compose mengganti container yang image-nya berubah.

Verifikasi minimal tiap deploy: health OK lokal, `curl -H 'Host:
sahabatkreator.my.id' http://127.0.0.1/` dari nginx host membalas HTML
app, dan hitungan DB tidak berubah tanpa sebab.

## Status: LIVE di server (2026-11-05)

Deploy pertama selesai dari commit `eb72998` (kode `9e85a00`):
image `sahabat-kreator-app:latest` 735 MB, `sahabat-kreator-web:latest`
77,6 MB; migrate exit 0 (jurnal 10); `/api/health` + `/api/ready`
(database+redis ok) hijau; web 200 dan `/brand/logo.png` persis
188.804 byte; bundle `pg` eksternal tepat 1 per app (api/worker/
realtime); DB perawan (tenants/users/channels = 0). Verifikasi publik
sementara lewat `curl -H 'Host: sahabatkreator.my.id'
http://43.173.6.204/` — menunggu DNS.

Catatan server: mesin yang sama juga menjalankan `sahabatkreator.com`
PROD (127.0.0.1:3001, proyek compose `sahabatkreator`, Cloudflare
Origin SSL) dan aplikasi `toeflynk` (:3000) dari pengaturan terpisah.
Stack dokumen ini (proyek `sahabat-kreator`, port 3101/3103/5180/
5434/6381) berdiri sendiri dan tidak menyentuh mereka. Staging .com
(`app.sahabatkreator.com`, :3002) DIHAPUS 2026-11-05 atas perintah
pemilik server (container + volume + image + blok nginx; backup conf
di server `sahabatkreator.conf.bak-20261105085253`), sekalian
pembersihan build cache Docker ±5,65 GB — disk bebas naik 36→43 GB.

DNS `sahabatkreator.my.id` + `www` sudah diproxy Cloudflare (anycast)
dan mode SSL zone-nya Full/Full-Strict (edge selalu bicara 443 ke
origin), jadi langkah TLS di bawah BUKAN opsional: tanpa blok 443 +
Origin Certificate zone ini, https dibalas 301 ke sahabatkreator.com
oleh blok default origin.

## TLS: SELESAI (2026-11-05) — pola sama persis dengan .com

DNS @ + www diproxy Cloudflare; Origin Certificate zone
`sahabatkreator.my.id` (SAN `*.sahabatkreator.my.id` +
`sahabatkreator.my.id`, Cloudflare Origin CA, berlaku s.d. Nov 2041)
terpasang di `/etc/nginx/ssl/sahabatkreator-myid/origin.crt|key`
(key mode 600 root). Blok 443 di `conf.d/sahabatkreator-myid.conf`
melayani @ + www (real_ip_header CF-Connecting-IP, body 110m/300s),
port 80 redirect 301 ke https. Terverifikasi publik:
`https://sahabatkreator.my.id/api/health` ok lewat Cloudflare
(Full/Strict menerima cert origin), www 200, http → 301 https.

## Sisa berikutnya (sisi pemilik akun)

1. Daftar admin pertama `mas@romo.com` di
   `https://sahabatkreator.my.id/register` (allowlist platform admin).
2. Isi Panel Admin: Meta app (id/secret/config IG/WA — callback menjadi
   `https://sahabatkreator.my.id/api/meta/oauth/callback` dan webhook
   `https://sahabatkreator.my.id/api/meta/webhook`), OpenRouter, R2,
   Resend.
