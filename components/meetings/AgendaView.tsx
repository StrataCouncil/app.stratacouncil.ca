"use client";

import { useState } from "react";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { openInNewTab } from "@/lib/open-in-tab";
import {
  decisionTypeLabels,
  groupByCategory,
  resolutionTypeLabels,
  resolutionTypeShort,
  type AgendaItem,
} from "@/lib/meetings/agenda";

/**
 * The agenda as members see it before the meeting: no editing, no private
 * notes, but every item opens to its rationale, financial implications,
 * risks, motion and attachments, so everyone arrives prepared.
 */
function hasDetail(it: AgendaItem) {
  return Boolean(it.background?.trim() || it.financial?.trim() || it.risks?.trim() || it.motion?.text?.trim() || it.atts.length);
}

function ItemDetail({ corpId, it }: { corpId: string; it: AgendaItem }) {
  const [error, setError] = useState("");
  async function open(a: AgendaItem["atts"][number]) {
    setError("");
    if (a.kind === "link" && !a.documentId) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    const documentId = a.documentId;
    if (!documentId) return;
    const res = await openInNewTab(() => getDocumentDownloadUrl(corpId, documentId, { view: true }));
    if (!res.ok) setError(res.error);
  }
  const sections: [string, string | undefined][] = [
    ["Background / rationale", it.background],
    ["Financial implications", it.financial],
    ["Risks / compliance", it.risks],
  ];
  return (
    <div className="agenda-detail" data-testid={`agenda-detail-${it.id}`}>
      <p className="agenda-detail__type">
        {resolutionTypeLabels[it.type]}
        {it.motion ? ` · ${decisionTypeLabels[it.motion.dt]}` : ""}
      </p>
      {it.motion?.text?.trim() && (
        <div className="agenda-detail__section">
          <h4>Proposed motion</h4>
          <p className="agenda-detail__motion">{it.motion.text}</p>
        </div>
      )}
      {sections
        .filter(([, body]) => body?.trim())
        .map(([label, body]) => (
          <div className="agenda-detail__section" key={label}>
            <h4>{label}</h4>
            <p>{body}</p>
          </div>
        ))}
      {it.atts.length > 0 && (
        <div className="agenda-detail__section">
          <h4>Attachments</h4>
          <ul className="agenda-detail__atts">
            {it.atts.map((a) => (
              <li key={a.id}>
                <button type="button" className="link-button" onClick={() => open(a)}>
                  {a.title}
                </button>
                <span className="roster-table__meta"> {a.kind === "link" ? "Link" : "File"}</span>
              </li>
            ))}
          </ul>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function AgendaView({ corpId, agenda }: { corpId: string; agenda: AgendaItem[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  if (agenda.length === 0) return <p className="card__meta">The agenda hasn&rsquo;t been built yet.</p>;
  const expandable = agenda.filter(hasDetail).map((i) => i.id);
  const allOpen = expandable.length > 0 && expandable.every((id) => openIds.has(id));
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="agenda-builder" data-testid="agenda-view">
      {expandable.length > 0 && (
        <div className="agenda-view__tools">
          <p className="card__meta">Open an item to read its background, motion and attachments before the meeting.</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(expandable))}
            data-testid="agenda-expand-all"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      {groupByCategory(agenda).map((cat) => (
        <div className="agenda-cat" key={cat.id}>
          <div className="agenda-cat__head">
            <h3 className="agenda-cat__label">{cat.name}</h3>
          </div>
          <ol className="agenda-items">
            {cat.items.map((it) => {
              const detail = hasDetail(it);
              const isOpen = openIds.has(it.id);
              return (
                <li className="agenda-item agenda-item--view" key={it.id} data-open={isOpen || undefined}>
                  <div className="agenda-item__row">
                    <span className="agenda-item__num">{it.num}.</span>
                    <span className="agenda-item__text">
                      {detail ? (
                        <button
                          type="button"
                          className="agenda-item__toggle"
                          onClick={() => toggle(it.id)}
                          aria-expanded={isOpen}
                          data-testid={`agenda-toggle-${it.id}`}
                        >
                          {it.text}
                        </button>
                      ) : (
                        it.text
                      )}
                      {!isOpen && it.motion?.text && <span className="agenda-item__motion">{it.motion.text}</span>}
                    </span>
                    {it.atts.length > 0 && (
                      <span className="roster-table__meta">
                        {it.atts.length} {it.atts.length === 1 ? "attachment" : "attachments"}
                      </span>
                    )}
                    {it.deferred && <span className="pill">Deferred</span>}
                    <span className={`rtag rtag--${it.type.toLowerCase()}`}>{resolutionTypeShort[it.type]}</span>
                  </div>
                  {isOpen && <ItemDetail corpId={corpId} it={it} />}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
