import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { FIRST_CHECKED_MIGRATION, tableGrantProblems } from "../supabase/checks/table-grants.ts";

const root = new URL("../supabase/", import.meta.url);

test("every new table states its grants, with row-level security on", () => {
  const files = readdirSync(new URL("migrations/", root))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= FIRST_CHECKED_MIGRATION)
    .map((f) => `migrations/${f}`);
  files.push("demo/demo.sql");
  const problems = files.flatMap((f) =>
    tableGrantProblems(readFileSync(new URL(f, root), "utf8")).map((p) => `${f}: ${p.table}: ${p.problem}`)
  );
  assert.deepEqual(problems, []);
});

test("the grants check catches a table without grants", () => {
  const sql = `
    create table if not exists public.widgets (id uuid primary key);
    create index if not exists widgets_idx on public.widgets (id);`;
  assert.deepEqual(
    tableGrantProblems(sql).map((p) => p.problem),
    ["row-level security is not enabled", "no grant to service_role", "no grant to authenticated (or revoke, for a server-only table)"]
  );
});

test("the grants check accepts member tables and server-only tables", () => {
  const sql = `
    -- A member table; grant select on public.gadgets to anon in a comment doesn't count.
    create table if not exists public.gadgets (id uuid primary key);
    alter table public.gadgets enable row level security;
    grant select, insert, update, delete on public.gadgets to authenticated;
    grant all on public.gadgets to service_role;
    create or replace function public.f() returns void language plpgsql as $$
    begin create table public.ignored (id int); end $$;
    create table public.secrets (id uuid primary key);
    alter table public.secrets enable row level security;
    revoke all on public.secrets from anon, authenticated;
    grant all on public.secrets to service_role;`;
  assert.deepEqual(tableGrantProblems(sql), []);
});

test("the grants check refuses anon", () => {
  const sql = `
    create table public.open (id int);
    alter table public.open enable row level security;
    grant select on public.open to anon, authenticated;
    grant all on public.open to service_role;`;
  assert.deepEqual(tableGrantProblems(sql).map((p) => p.problem), ["granted to anon"]);
});
