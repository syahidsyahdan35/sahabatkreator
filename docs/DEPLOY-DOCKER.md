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
server dengan `openssl rand -hex`, tidak pernah lewat chat/log):

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

## Sisa setelah DNS menunjuk ke server

1. `sudo certbot --nginx -d sahabatkreator.my.id` (atau Origin Certificate
   Cloudflare bila proxy oranye aktif dengan mode Full/Strict), lalu
   pastikan redirect HTTP→HTTPS.
2. Daftar admin pertama `mas@romo.com` (allowlist platform admin).
3. Isi Panel Admin: Meta app (id/secret/config IG/WA — callback menjadi
   `https://sahabatkreator.my.id/api/meta/oauth/callback`), OpenRouter,
   R2, Resend.
