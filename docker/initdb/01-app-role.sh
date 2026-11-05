#!/bin/sh
# Provisioning cluster Postgres (hanya jalan SEKALI saat volume kosong,
# lewat docker-entrypoint-initdb.d):
# buat role aplikasi `sk_app` — non-superuser, NOBYPASSRLS — agar RLS
# tenant benar-benar berlaku untuk koneksi API (pola yang sama dengan
# staging Botara). Role SENGAJA tidak dibuat oleh migrasi: ia objek
# tingkat cluster (lihat kepala packages/db/migrations/0009_*.sql);
# migrasi 0009 yang memberi grant-nya begitu role ini ada.
#
# Password dibaca dari env container SK_APP_PASSWORD (diisi compose dari
# .env.production server; nilainya hex hasil `openssl rand`, aman untuk
# SQL literal). Script ini tidak pernah mencetak password.
set -e

if [ -z "${SK_APP_PASSWORD:-}" ]; then
  echo "SK_APP_PASSWORD kosong — role sk_app tidak dibuat" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sk_app') THEN
      CREATE ROLE sk_app LOGIN PASSWORD '${SK_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END
  \$\$;
EOSQL
echo "role sk_app siap"
