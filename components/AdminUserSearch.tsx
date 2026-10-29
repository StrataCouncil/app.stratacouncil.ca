"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STAGE_LABELS, STAGES, type Stage } from "@/lib/admin-users";
import type { AdminPersonRow } from "@/lib/data/admin-users";

type SortKey = "signedUp" | "lastSeen" | "name" | "training" | "questions";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "signedUp", label: "Newest sign-ups" },
  { key: "lastSeen", label: "Last seen" },
  { key: "name", label: "Name" },
  { key: "training", label: "Most training" },
  { key: "questions", label: "Most Stratasphere questions" },
];

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" }) : "Never");

/**
 * The Users tab's table: search by name, email or strata; filter by the
 * furthest stage reached or "needs a follow-up"; sort. Clicking a funnel
 * stage above the table (on the page) sets the same filter through ?stage=.
 */
export function AdminUserSearch({ people, initialStage }: { people: AdminPersonRow[]; initialStage: Stage | "follow-up" | "" }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage | "follow-up" | "">(initialStage);
  const [sort, setSort] = useState<SortKey>("signedUp");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = people.filter((p) => {
      if (stage === "follow-up" && !p.followUp) return false;
      if (stage && stage !== "follow-up" && !p.reached.includes(stage)) return false;
      if (!q) return true;
      return [p.name, p.email, p.campaign ?? "", ...p.regions, ...p.stratas.map((s) => `${s.name} ${s.planNumber}`)].join(" ").toLowerCase().includes(q);
    });
    const by: Record<SortKey, (a: AdminPersonRow, b: AdminPersonRow) => number> = {
      signedUp: (a, b) => b.signedUpAt.localeCompare(a.signedUpAt),
      lastSeen: (a, b) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? ""),
      name: (a, b) => a.name.localeCompare(b.name),
      training: (a, b) => b.modulesFinished - a.modulesFinished || b.credentials - a.credentials,
      questions: (a, b) => b.questions30 - a.questions30,
    };
    return [...list].sort(by[sort]);
  }, [people, query, stage, sort]);

  return (
    <div data-testid="admin-user-search">
      <div className="admin-user-filters">
        <input
          type="search"
          className="kb-search"
          placeholder="Search by name, email, strata or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="admin-user-query"
        />
        <label>
          <span className="visually-hidden">Show</span>
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage | "follow-up" | "")} data-testid="admin-user-stage">
            <option value="">Everyone</option>
            <option value="follow-up">Worth a follow-up</option>
            {STAGES.slice(1).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} data-testid="admin-user-sort">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="card__meta" style={{ margin: "0.5rem 0 0.75rem" }}>
        {filtered.length} of {people.length} {people.length === 1 ? "person" : "people"}
      </p>

      {filtered.length === 0 ? (
        <p className="roster-notice" data-testid="admin-user-empty">
          Nobody matches.
        </p>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table admin-user-table" data-testid="admin-user-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Signed up</th>
                <th>Last seen</th>
                <th>Stratas</th>
                <th>Training</th>
                <th data-center="true">Questions (30 days)</th>
                <th>Library</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} data-testid={`admin-user-row-${p.id}`}>
                  <td>
                    <Link href={`/admin/users/${p.id}`}>{p.name}</Link>
                    {p.isSuperAdmin && <span className="pill pill--accent admin-user-staff">Staff</span>}
                    <div className="roster-table__meta">{p.email}</div>
                  </td>
                  <td>
                    {date(p.signedUpAt)}
                    {p.campaign && <div className="roster-table__meta">from {p.campaign}</div>}
                  </td>
                  <td>{date(p.lastSignInAt)}</td>
                  <td>
                    {p.stratas.length === 0 ? (
                      <span className="roster-table__na">None</span>
                    ) : (
                      p.stratas.map((s) => (
                        <div key={s.planNumber}>
                          {s.name}
                          {s.status === "invited" && <span className="roster-table__meta"> (invited)</span>}
                        </div>
                      ))
                    )}
                    {p.regions.length > 0 && <div className="roster-table__meta">{p.regions.join(" · ")}</div>}
                  </td>
                  <td>
                    {p.modulesFinished} of {p.modulesTotal} modules
                    {p.credentials > 0 && (
                      <div className="roster-table__meta">
                        {p.credentials} {p.credentials === 1 ? "credential" : "credentials"}
                      </div>
                    )}
                  </td>
                  <td data-center="true">{p.questions30}</td>
                  <td>
                    {p.libraryOpens + p.downloads === 0 ? (
                      <span className="roster-table__na">None</span>
                    ) : (
                      <>
                        {p.libraryOpens} {p.libraryOpens === 1 ? "guide" : "guides"}
                        <div className="roster-table__meta">
                          {p.downloads} {p.downloads === 1 ? "download" : "downloads"}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    {STAGE_LABELS[p.stage]}
                    {p.followUp && <div className="admin-user-followup">{p.followUp}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
