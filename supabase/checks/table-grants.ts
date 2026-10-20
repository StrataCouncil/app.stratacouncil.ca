/**
 * Every table a migration creates states its own access (2026-10-20).
 *
 * From October 30, 2026, Supabase no longer grants the Data API roles
 * access to new tables in `public`, and the defaults 0016 set may go with
 * it. A table created without grants would apply cleanly and then fail in
 * the app with "permission denied". So, in the same file as the
 * `create table`:
 *   - row-level security is enabled;
 *   - `service_role` (the server) is granted access;
 *   - `authenticated` (signed-in users) is either granted what it needs or
 *     explicitly revoked, for server-only tables.
 * `anon` gets nothing (0016: nothing is read before sign-in), so no rule
 * for it beyond never granting.
 *
 * Applies to migrations from 0016 on, every one of which already does
 * this (0016 granted the tables created before it), and to the demo's own
 * tables (supabase/demo/demo.sql). Run by `npm test`.
 */

export const FIRST_CHECKED_MIGRATION = 16;

export interface GrantProblem {
  table: string;
  problem: string;
}

/** Statements outside comments and dollar-quoted bodies. */
function statements(sql: string): string[] {
  const clean = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return clean.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const bare = (name: string) => name.trim().replace(/^public\./i, "").replace(/"/g, "").toLowerCase();

export function tableGrantProblems(sql: string): GrantProblem[] {
  const stmts = statements(sql);
  const created = new Set<string>();
  const rls = new Set<string>();
  const granted = new Map<string, Set<string>>();
  const revoked = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, table: string, roles: string[]) => {
    const set = m.get(table) ?? new Set<string>();
    roles.forEach((r) => set.add(r));
    m.set(table, set);
  };

  for (const s of stmts) {
    let m = /^create (?:unlogged )?table (?:if not exists )?([\w."]+)/i.exec(s);
    if (m) {
      created.add(bare(m[1]));
      continue;
    }
    m = /^alter table (?:if exists )?(?:only )?([\w."]+) enable row level security$/i.exec(s);
    if (m) {
      rls.add(bare(m[1]));
      continue;
    }
    m = /^(grant|revoke) .*? on (?:table )?([\w.", ]+?) (to|from) (.+)$/i.exec(s);
    if (m && !/ on (all|function|schema|sequence|routine|procedure|type|foreign) /i.test(s)) {
      const roles = m[4].split(",").map((r) => r.trim().replace(/\s.*$/, "").toLowerCase());
      for (const t of m[2].split(",")) add(m[1].toLowerCase() === "grant" ? granted : revoked, bare(t), roles);
    }
  }

  const problems: GrantProblem[] = [];
  for (const table of created) {
    if (!rls.has(table)) problems.push({ table, problem: "row-level security is not enabled" });
    if (!granted.get(table)?.has("service_role")) problems.push({ table, problem: "no grant to service_role" });
    if (!granted.get(table)?.has("authenticated") && !revoked.get(table)?.has("authenticated")) {
      problems.push({ table, problem: "no grant to authenticated (or revoke, for a server-only table)" });
    }
    if (granted.get(table)?.has("anon")) problems.push({ table, problem: "granted to anon" });
  }
  return problems;
}
