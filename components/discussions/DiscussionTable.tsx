"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DiscussionSummary } from "@/lib/data/discussions";
import { resultLabel, STATUS_LABELS, VOTE_LABELS } from "@/lib/discussions/tally";

const PAGE = 10;

const date = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "short", day: "numeric" });

/** The Discussions list (0081): one row each, newest first, with search and pages. */
export function DiscussionTable(props: { corpId: string; discussions: DiscussionSummary[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? props.discussions.filter((d) => `${d.title} ${d.motion} ${d.authorName}`.toLowerCase().includes(t)) : props.discussions;
  }, [q, props.discussions]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const rows = shown.slice(at * PAGE, at * PAGE + PAGE);

  return (
    <div className="discussion-table" data-testid="discussions-list">
      <div className="discussion-table__tools">
        <input
          type="search"
          placeholder="Search discussions"
          aria-label="Search discussions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          data-testid="discussions-search"
        />
        <span className="card__meta">
          {shown.length} {shown.length === 1 ? "discussion" : "discussions"}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Discussion</th>
            <th scope="col">Result</th>
            <th scope="col">Opened</th>
            <th scope="col">Last activity</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const r = resultLabel(d);
            return (
              <tr key={d.id} data-testid={`discussion-${d.id}`}>
                <td>
                  <Link href={`/strata/${props.corpId}/discussions/${d.id}`} className="discussion-table__title">
                    {d.title}
                  </Link>
                  <div className="card__meta">Opened by {d.authorName || "a council member"}</div>
                  {d.myVote !== undefined && d.voteRequired && (
                    <div className="discussion-myvote" data-vote={d.myVote ?? "none"} data-testid={`discussion-myvote-${d.id}`}>
                      {d.myVote ? `Your vote: ${VOTE_LABELS[d.myVote]}` : d.status === "open" ? "You haven't voted yet" : "You didn't vote"}
                    </div>
                  )}
                </td>
                <td>
                  <span className="discussion-result" data-tone={r.tone} data-testid={`discussion-result-${d.id}`}>
                    {r.label}
                  </span>
                </td>
                <td>{date(d.createdAt)}</td>
                <td>{date(d.lastActivityAt)}</td>
                <td>
                  <span className="meeting-status discussion-status" data-tone={d.status} data-testid={`discussion-status-${d.id}`}>
                    {d.status === "open" ? "Open" : d.status === "awaiting_ratification" ? "Closed" : STATUS_LABELS[d.status]}
                  </span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="card__meta">
                No discussions match &ldquo;{q}&rdquo;.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {pages > 1 && (
        <nav className="discussion-table__pages" aria-label="Pages">
          <button type="button" className="button button-secondary button-small" onClick={() => setPage(at - 1)} disabled={at === 0}>
            Previous
          </button>
          <span className="card__meta">
            Page {at + 1} of {pages}
          </span>
          <button type="button" className="button button-secondary button-small" onClick={() => setPage(at + 1)} disabled={at >= pages - 1}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
