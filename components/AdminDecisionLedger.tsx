"use client";

import { useMemo, useState } from "react";

export interface AdminDecision {
  id: string;
  date: string;
  title: string;
  motionText: string | null;
  mover: string | null;
  seconder: string | null;
  votes: string;
  source: string;
}

/**
 * A strata's decision ledger in the Super Admin console, searchable by any
 * word in the title, motion, mover, seconder, date or meeting type. Every
 * word typed has to match, in any order.
 */
export function AdminDecisionLedger({ decisions }: { decisions: AdminDecision[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return decisions;
    return decisions.filter((d) => {
      const hay = [d.date, d.title, d.motionText ?? "", d.mover ?? "", d.seconder ?? "", d.source].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [decisions, query]);

  if (decisions.length === 0) return <p className="roster-notice">No decisions recorded yet.</p>;

  return (
    <div>
      <input
        type="search"
        className="kb-search"
        placeholder="Search decisions: a word in the motion, a mover, a year, a meeting type…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="admin-decision-search"
      />
      <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
        {query.trim() ? `${filtered.length} of ${decisions.length} decisions` : `${decisions.length} decisions`}
      </p>
      {filtered.length === 0 ? (
        <p className="card__meta">No decision matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table" data-testid="admin-decisions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Decision</th>
                <th>Moved / seconded</th>
                <th data-center="true">For / against / abstain</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{d.date}</td>
                  <td>
                    <strong>{d.title}</strong>
                    {d.motionText && <div className="roster-table__meta">{d.motionText}</div>}
                  </td>
                  <td>
                    {d.mover || "—"}
                    <div className="roster-table__meta">{d.seconder || "—"}</div>
                  </td>
                  <td data-center="true">{d.votes}</td>
                  <td>{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
