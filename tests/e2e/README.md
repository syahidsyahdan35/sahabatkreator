# Sahabat Kreator — E2E (Playwright)

Suite pengujian browser SUNGGUHAN (Fase QA-1) terhadap aplikasi yang live:
alur auth, workspace, kontak, webchat dua arah, automation keyword &
sequence, persetujuan saran AI agent, produk & pembayaran simulasi, serta
UX shell (bahasa, tema, mobile).

## Cara menjalankan

```bash
# dari root repo
pnpm --filter @sahabat-kreator/e2e test
```

Target diatur lewat env `E2E_BASE_URL` (default `https://botara.my.id`):

```bash
E2E_BASE_URL=https://botara.my.id pnpm --filter @sahabat-kreator/e2e test
```

## Di mana suite sebaiknya berjalan

**Di server staging** — bukan dari VM pengembangan. Alasannya: POST dari
VM ke domain publik selalu timeout (artefak proxy egress VM), sedangkan
dari server, POST ke `https://botara.my.id` lancar (terbukti di semua fase
pengembangan). Inilah jalur yang benar-benar dipakai sejak Fase QA-1
(hasil run penuh: 13/13 lulus, ±3,5 menit).

Persiapan server (semuanya per-user, TANPA sudo — sudo di server meminta
password):

1. Server hanya punya Bun; Playwright butuh Node. Node mandiri dipasang
   dari tarball resmi ke `~/opt/node` (v22.14.0).
2. Browser: `playwright install chromium` mengunduh Chromium ke
   `~/.cache/ms-playwright` seperti biasa.
3. Chromium butuh 8 library sistem yang belum ada di server
   (libatk, libatk-bridge, libatspi, libcups, libxcomposite, libxdamage,
   libavahi). Tanpa sudo, paket `.deb`-nya diunduh dengan
   `apt-get download` lalu diekstrak (bukan diinstall) ke
   `~/opt/chromelibs/root`, dan dipakai lewat `LD_LIBRARY_PATH`:

```bash
# sekali saja di server
mkdir -p ~/opt/chromelibs/debs && cd ~/opt/chromelibs/debs
apt-get download libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 \
  libxcomposite1 libxdamage1 libavahi-common3 libavahi-client3
cd ~/opt/chromelibs && for d in debs/*.deb; do dpkg-deb -x "$d" root; done

# menjalankan suite di server
cd ~/sahabat-kreator/tests/e2e
LD_LIBRARY_PATH=$HOME/opt/chromelibs/root/usr/lib/x86_64-linux-gnu \
E2E_BASE_URL=https://botara.my.id \
  ~/opt/node/bin/node node_modules/@playwright/test/cli.js test
```

Fallback bila Chromium kelak tidak bisa berjalan di server: jalankan dari
VM lewat tunnel SSH ke web staging di server
(`ssh -L 15180:127.0.0.1:5180 ...`) dengan `E2E_BASE_URL` diarahkan ke
tunnel — variabel env yang sama, tanpa mengubah suite.

## Konvensi suite

- Satu file spec per area di `specs/`; helper bersama di `helpers.ts`.
- Setiap run membuat akun uji BARU berawalan `e2e-...@sk.test` dan nama
  unik per run — suite aman diulang; data uji tertinggal di staging
  memang disengaja (staging berisi akun uji semua fase).
- Selektor berbasis role/teks yang terlihat pengguna, bukan class CSS.
- `retries: 0` dan screenshot+trace hanya saat gagal
  (`tests/e2e/test-results/`, tidak di-commit): kegagalan dilaporkan apa
  adanya, bukan ditutup retry.
- Pendaftaran akun auth tahan rate limit: staging di balik Cloudflare
  Tunnel membuat semua lalu lintas tampak dari satu IP, jadi jendela
  rate limit bawaan Better Auth terbagi untuk semua peminta. Helper
  `submitAuthForm` menunggu jendelanya lewat dan mengirim ulang bila
  alert "Too many requests" muncul — assertion keberhasilannya sendiri
  tidak dilemahkan.
