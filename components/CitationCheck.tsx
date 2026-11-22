"use client";

import { useState } from "react";
import Link from "next/link";
import { checkCitations, chooseCitation } from "@/app/admin/legislation/actions";
import type { CitationReport, ReviewItem } from "@/lib/kb/citation-repair-server";

/**
 * Citations to Knowledge Base passages that no longer exist (Super Admin).
 * The check re-links every citation whose section is certain (the same
 * section of an entry still in the library) and lists the rest here, each
 * with up to three suggested sections, to use one or remove the citation.
 * The same certain re-links also run after every re-index and deletion.
 */
export function CitationCheck() {
  const [report, setReport] = useState<CitationReport | null>(null);
  const [open, setOpen] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    const res = await checkCitations();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setReport(res.report);
    setOpen(res.report.review);
  }

  async function choose(item: ReviewItem, replacementId: string | null) {
    setError("");
    const res = await chooseCitation({ where: item.where, rowId: item.rowId, chunkId: item.chunkId, replacementId });
    if (!res.ok) return setError(res.error);
    setOpen((list) => list.filter((x) => !(x.rowId === item.rowId && x.chunkId === item.chunkId)));
  }

  return (
    <section className="legis-upload" style={{ marginTop: "2rem" }}>
      <div className="legis-upload__head">
        <div>
          <h2>Citations</h2>
          <p className="roster-table__meta">
            Training slides, Library items and recall cases cite sections of the Knowledge Base. When a section&rsquo;s
            passage is replaced or its entry deleted, the check re-links the citation to the same section where that&rsquo;s
            certain, and lists the rest here.
          </p>
        </div>
        <button type="button" className="button button-secondary" onClick={run} disabled={busy}>
          {busy ? "Checking" : "Check citations"}
        </button>
      </div>

      {error && (
        <p className="legis-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <>
          <p>
            {report.relinked.length} re-linked to the same section
            {report.publishedPatched ? ` (${report.publishedPatched} published slides updated)` : ""}.
            {report.droppedUnread ? ` ${report.droppedUnread} unused references removed (AI build inputs and suggestions).` : ""}{" "}
            {open.length ? `${open.length} need a choice.` : "Nothing needs a choice."}
          </p>
          {report.relinked.length > 0 && (
            <details>
              <summary>Re-linked</summary>
              <ul>
                {report.relinked.map((r, i) => (
                  <li key={i} className="roster-table__meta">
                    {r.heading}: {r.from === r.to ? r.to : `${r.from} → ${r.to}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {open.length > 0 && (
            <ul className="citation-review">
              {open.map((item) => (
                <li key={`${item.rowId}-${item.chunkId}`} style={{ margin: "1rem 0" }}>
                  <div>
                    <Link href={item.href}>{item.heading}</Link>
                  </div>
                  <div>
                    <strong>{item.label}</strong>
                  </div>
                  <div className="roster-table__meta">{item.reason}</div>
                  {item.candidates.map((c) => (
                    <div key={c.chunkId} style={{ marginTop: "0.5rem" }}>
                      <button type="button" className="link-button" onClick={() => choose(item, c.chunkId)}>
                        Use {c.label}
                      </button>
                      <div className="roster-table__meta">{c.snippet}…</div>
                    </div>
                  ))}
                  <div style={{ marginTop: "0.5rem" }}>
                    <button type="button" className="link-button agenda-danger" onClick={() => choose(item, null)}>
                      Remove this citation
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
