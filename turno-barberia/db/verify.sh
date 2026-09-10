#!/usr/bin/env bash
# Aplica el esquema + semillas y corre la suite completa contra un
# PostgreSQL real en Docker.
#
# Si no tienes Docker, usa el camino rápido (PostgreSQL en WASM):
#   npm ci && npm run db:test
#
#   ./db/verify.sh [version_de_postgres]      # por defecto 16
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PGVER="${1:-16}"

echo ">> Levantando PostgreSQL ${PGVER} efímero..."
CID=$(docker run -d -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=ocpos_verify "postgres:${PGVER}-alpine")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

until docker exec "$CID" pg_isready -U postgres -d ocpos_verify >/dev/null 2>&1; do sleep 1; done

echo ">> Copiando db/ al contenedor..."
docker cp "$DIR" "$CID:/tmp/db"

echo ">> Aplicando esquema, semillas y suite de tests..."
docker exec -w /tmp/db/tests "$CID" \
  psql -U postgres -d ocpos_verify -v ON_ERROR_STOP=1 -f run_tests.sql

echo ">> Verificando cobertura de RLS..."
MISSING=$(docker exec "$CID" psql -U postgres -d ocpos_verify -tAc \
  "SELECT count(*) FROM app.v_rls_coverage WHERE NOT (rls_enabled AND rls_forced AND has_policy);")
if [ "$MISSING" != "0" ]; then
  docker exec "$CID" psql -U postgres -d ocpos_verify -c \
    "SELECT * FROM app.v_rls_coverage WHERE NOT (rls_enabled AND rls_forced AND has_policy);"
  echo "ERROR: $MISSING tabla(s) con tenant_id sin RLS forzado." >&2
  exit 1
fi

echo ""
echo "=== TODO OK sobre PostgreSQL ${PGVER}: esquema, semillas y tests ==="
