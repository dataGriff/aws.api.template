#!/usr/bin/env bash
# Run a curated example query by name against the selected environment's DB.
#   task db:query -- todos_by_tenant
# Connection comes from DATABASE_URL (defaults to the local stack). Queries may
# reference psql variables :tenant / :status — override with TENANT=... STATUS=...
set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: task db:query -- <query_name>"
  echo "available:"
  ls -1 packages/api/src/db/queries/*.sql | sed 's#.*/##; s#\.sql$##; s/^/  - /'
  exit 1
fi

FILE="packages/api/src/db/queries/${NAME}.sql"
[[ -f "$FILE" ]] || { echo "no such query: $NAME ($FILE)"; exit 1; }

DATABASE_URL="${DATABASE_URL:-postgresql://app:app@localhost:5432/app}"
psql "$DATABASE_URL" \
  -v "tenant=${TENANT:-tenant-1}" \
  -v "status=${STATUS:-open}" \
  -f "$FILE"
