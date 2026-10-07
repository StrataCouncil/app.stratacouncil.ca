#!/usr/bin/env bash
# Brings the demo database (demo.stratacouncil.ca) up to date: every
# migration in supabase/migrations that hasn't run there yet, in order,
# then supabase/demo/demo.sql (safe to re-run, so it runs every time).
#
# Run by .github/workflows/demo-database.yml on every push to main, with
# the DEMO_DATABASE_URL secret. The live database is never touched: its
# migrations are still run by hand in the Supabase SQL editor.
#
# Each migration runs in one transaction together with the line recording
# it in stratacouncil_meta.applied_migrations, so a migration that fails
# leaves nothing half-done and is tried again on the next run.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DEMO_DATABASE_URL:?DEMO_DATABASE_URL is not set}"
PSQL=(psql "$DEMO_DATABASE_URL" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" <<'SQL'
create schema if not exists stratacouncil_meta;
revoke all on schema stratacouncil_meta from public;
create table if not exists stratacouncil_meta.applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

applied=$("${PSQL[@]}" -At -c "select name from stratacouncil_meta.applied_migrations")
count=0
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  if grep -qxF "$name" <<<"$applied"; then continue; fi
  echo "Running $name"
  "${PSQL[@]}" --single-transaction -f "$f" \
    -c "insert into stratacouncil_meta.applied_migrations (name) values ('$name')"
  count=$((count + 1))
done
echo "Migrations run: $count"

"${PSQL[@]}" --single-transaction -f supabase/demo/demo.sql
echo "Demo tables and functions up to date"
