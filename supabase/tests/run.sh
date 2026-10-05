#!/usr/bin/env bash
# Database tests: every migration, then every migration from 0016 on a
# second time (the house rule: migrations are safe to re-run; 0001–0015
# predate it), the seed, then each suite in supabase/tests/suites on its
# own fresh copy.
# A suite fails by raising an error; each passing check prints "OK".
#
# Needs Postgres 16 with pgvector, reached through the usual PG* settings
# (PGHOST, PGPORT, PGUSER, PGPASSWORD). Locally:  npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
TEMPLATE=sc_test_template
RERUN_FROM=0016

"${PSQL[@]}" -d postgres -c "drop database if exists $TEMPLATE" -c "create database $TEMPLATE"
"${PSQL[@]}" -d "$TEMPLATE" -f supabase/tests/setup/supabase-stubs.sql
for pass in 1 2; do
  for f in supabase/migrations/*.sql; do
    num=$(basename "$f" | cut -c1-4)
    if [ "$pass" = 2 ] && [ "$num" \< "$RERUN_FROM" ]; then continue; fi
    if ! out=$("${PSQL[@]}" -d "$TEMPLATE" -f "$f" 2>&1); then
      echo "FAIL migration $f (run $pass)"; echo "$out" | grep -iE "error" | head -5; exit 1
    fi
  done
  if [ "$pass" = 1 ]; then echo "Migrations applied"; else echo "Migrations from $RERUN_FROM re-run safely"; fi
done
if ! out=$("${PSQL[@]}" -d "$TEMPLATE" -f supabase/tests/setup/seed.sql 2>&1); then
  echo "FAIL seed"; echo "$out" | grep -iE "error|FAILED" | head -5; exit 1
fi
echo "Seed and core flow: $(echo "$out" | grep -c OK) checks"

failed=0
for suite in supabase/tests/suites/*.sql; do
  name=$(basename "$suite" .sql)
  db="sc_test_${name//-/_}"
  "${PSQL[@]}" -d postgres -c "drop database if exists $db" -c "create database $db template $TEMPLATE"
  if out=$("${PSQL[@]}" -d "$db" -f "$suite" 2>&1); then
    echo "PASS $name ($(echo "$out" | grep -c OK) checks)"
  else
    echo "FAIL $name"; echo "$out" | grep -iE "error|FAILED" | head -5; failed=1
  fi
  "${PSQL[@]}" -d postgres -c "drop database if exists $db"
done
exit $failed
