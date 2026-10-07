# Database tests

Plain-SQL tests for the migrations, the access rules (RLS and grants) and the
database functions. They run on every pull request (`.github/workflows/checks.yml`).

- `setup/supabase-stubs.sql`: stand-ins for the Supabase pieces the migrations
  use (roles, `auth`, `storage`, `auth.uid()`).
- `setup/seed.sql`: test people and one strata (BCS-1234), made through the real
  functions, plus the core create/join/invite/roles checks.
- `suites/*.sql`: one file per area (`demo.sql` also loads the demo site's own
  tables and functions, `supabase/demo/demo.sql`). Each runs on a fresh copy of the seeded
  database. A check is `select pg_temp.expect('what should be true', <condition>);`
  and "signing in" is `set role authenticated; set test.uid = '<user uuid>';`.

Run locally with Postgres 16 + pgvector and the usual `PG*` settings:

    npm run test:db

Migrations from `0016` on must be safe to re-run; the runner applies them twice.
Adding a migration or a database rule: add or extend a suite in the same PR.
