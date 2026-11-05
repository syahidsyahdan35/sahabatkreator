# Sahabat Kreator — image Docker untuk deploy sahabatkreator.my.id.
#
# Dua target dari satu berkas (dipilih lewat `target:` di
# docker-compose.prod.yml):
#   --target app : runtime Node untuk api / worker / realtime / migrate
#                  (seluruh tree monorepo hasil build, meniru layout staging:
#                  dist per app + node_modules workspace; `pg` tetap eksternal
#                  di bundle tsup sehingga node_modules memang dibutuhkan).
#   --target web : nginx berisi dist statis apps/web (SPA fallback).
#                  Routing /api, /realtime, /go dipegang nginx HOST sebagai
#                  edge (lihat docs/DEPLOY-DOCKER.md) — sesuai catatan di
#                  apps/web/vite.config.ts: di produksi jalur itu pindah ke
#                  reverse-proxy, bukan Vite preview.
#
# pnpm hanya hidup di tahap builder ini (package manager monorepo,
# packageManager: pnpm@9.15.9). Host tidak perlu node/pnpm sama sekali.

FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NODE_OPTIONS=--max-old-space-size=3072
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/index.js"]

FROM nginx:1.27-alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
