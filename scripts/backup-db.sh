#!/usr/bin/env bash
# =============================================================================
# Backup database Sahabat Kreator — pg_dump terkompresi + manifest
# (Fase 14C; runbook lengkap: docs/PRODUCTION.md §7, inventaris rahasia:
# docs/SECRETS-RUNBOOK.md)
#
# Bentuk staging/produksi kita: Postgres berjalan sebagai container
# Docker (`sahabat-kreator-pg`) dan pg_dump dijalankan DI DALAM container
# dengan role migrasi — skrip ini tidak pernah membutuhkan kredensial di
# baris perintah selain nama role (role itu login lewat trust lokal
# container / .pgpass server; URL berisi kata sandi tidak dipakai di
# sini).
#
# Yang dicadangkan skrip ini HANYA database. Aset non-DB (didokumentasikan,
# TIDAK disalin skrip ini):
# - Objek media/KB hidup di bucket Cloudflare R2 sisi provider — DB hanya
#   menyimpan kuncinya; perlindungan objek adalah urusan R2 (lihat
#   PRODUCTION.md §7).
# - Berkas .env server (.env.staging / .env.production) adalah rahasia
#   sisi server: TIDAK PERNAH disalin ke repo atau ke folder backup ini.
#   Yang perlu dijaga operator hanyalah daftar NAMANYA
#   (.env.production.example) + nilai yang disimpan di pengelola rahasia
#   milik pemilik platform.
# - Konfigurasi systemd & tunnel didokumentasikan di PRODUCTION.md.
#
# Konfigurasi lewat env (default = bentuk staging):
#   SK_BACKUP_DIR       folder keluaran        (default /home/ubuntu/backups)
#   SK_PG_CONTAINER     nama container pg      (default sahabat-kreator-pg)
#   SK_PG_USER          role pg_dump           (default sk_migration)
#   SK_PG_DB            nama database          (default sahabat_kreator_staging)
#   SK_BACKUP_KEEP      jumlah dump terakhir per DB yang dipertahankan
#                       (default 14; 0 = jangan pangkas)
#
# Keluaran per run: <db>-<UTC YYYYMMDDTHHMMSSZ>.sql.gz + berkas
# <nama>.manifest (key=value: db, created_at, file, bytes, sha256,
# tables, policies, migrations — jumlah baris jurnal drizzle bila tabel
# jurnalnya ada, selain itu "n/a"). Baris terakhir stdout:
#   BACKUP_OK file=<path> sha256=<hex> bytes=<n> tables=<n> policies=<n>
#
# Jadwal yang DIREKOMENDASIKAN (belum dipasang di server mana pun —
# pemasangan cron adalah langkah operator saat go-live):
#   30 3 * * *  ubuntu  SK_PG_DB=sahabat_kreator_prod \
#     /home/ubuntu/sahabat-kreator/scripts/backup-db.sh >> \
#     /home/ubuntu/backups/backup.log 2>&1
# =============================================================================
set -euo pipefail

BACKUP_DIR="${SK_BACKUP_DIR:-/home/ubuntu/backups}"
CONTAINER="${SK_PG_CONTAINER:-sahabat-kreator-pg}"
PG_USER="${SK_PG_USER:-sk_migration}"
PG_DB="${SK_PG_DB:-sahabat_kreator_staging}"
KEEP="${SK_BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="${PG_DB}-${STAMP}"
FINAL="${BACKUP_DIR}/${BASE}.sql.gz"
TMP="${BACKUP_DIR}/.${BASE}.sql.gz.tmp"

cleanup_tmp() { rm -f "$TMP"; }
trap cleanup_tmp EXIT

echo "[backup] pg_dump ${PG_DB} (container ${CONTAINER}, role ${PG_USER}) → ${FINAL}"
# --no-owner/--no-privileges: dump harus bisa di-restore oleh role pemilik
# DB tujuan mana pun (restore rehearsal memakai role buangan tersendiri).
docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" \
  --no-owner --no-privileges | gzip -9 > "$TMP"
mv "$TMP" "$FINAL"
trap - EXIT

BYTES="$(stat -c %s "$FINAL")"
SHA256="$(sha256sum "$FINAL" | awk '{print $1}')"

psql_count() {
  docker exec "$CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" | tr -d '[:space:]'
}
TABLES="$(psql_count "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
POLICIES="$(psql_count "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
# Jurnal drizzle ditanyakan TERPISAH: referensi langsung ke
# drizzle.__drizzle_migrations dalam query yang sama dengan penjaga
# to_regclass tetap gagal di tahap parse bila skema drizzle belum ada
# (DB hasil terapan SQL manual, mis. DB rehearsal) — to_regclass sendiri
# aman dan mengembalikan NULL.
HAS_JOURNAL="$(psql_count "SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN 'yes' ELSE 'no' END")"
if [ "$HAS_JOURNAL" = "yes" ]; then
  MIGRATIONS="$(psql_count "SELECT count(*) FROM drizzle.__drizzle_migrations")"
else
  MIGRATIONS="n/a"
fi

MANIFEST="${FINAL}.manifest"
{
  echo "db=${PG_DB}"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "file=$(basename "$FINAL")"
  echo "bytes=${BYTES}"
  echo "sha256=${SHA256}"
  echo "tables=${TABLES}"
  echo "policies=${POLICIES}"
  echo "migrations=${MIGRATIONS}"
} > "$MANIFEST"
echo "[backup] manifest → ${MANIFEST}"

if [ "$KEEP" -gt 0 ]; then
  # Pangkas dump tertua untuk DB yang sama (manifest ikut dibuang).
  mapfile -t OLD < <(ls -1t "${BACKUP_DIR}/${PG_DB}-"*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" || true)
  for f in "${OLD[@]}"; do
    echo "[backup] pangkas lama: $f"
    rm -f "$f" "$f.manifest"
  done
fi

echo "BACKUP_OK file=${FINAL} sha256=${SHA256} bytes=${BYTES} tables=${TABLES} policies=${POLICIES}"
