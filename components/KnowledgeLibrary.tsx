"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  isTemplateLocked,
  knowledgeResourceKindLabels,
  type KnowledgeResource,
  type KnowledgeResourceKind,
} from "@/lib/placeholder-data";

const kinds = Object.keys(knowledgeResourceKindLabels) as KnowledgeResourceKind[];

/**
 * The Knowledge Library — search + filter over the full playbook/
 * template/guide/insight/legislation set (doc01 §3b), not six separate
 * lists. A new council member searching "noise complaint" or "reserve
 * fund" shouldn't have to guess which content type it lives under.
 *
 * Each card is a link into its own detail page (`/guides/[resourceId]`)
 * — this is meant to read like a blog/news index, not a static summary
 * list. Policy templates behind the paywall (`isTemplateLocked`) still
 * render and still link through — the detail page is where the actual
 * upgrade pitch lives — but the card itself is visually greyed with a
 * lock badge so the free/paid boundary is obvious before clicking in.
 *
 * The card itself stays deliberately small — title, one-line summary,
 * and just enough badge context (kind, lock, jurisdiction) to scan a
 * grid of them quickly. Checklist steps and tags are real content, but
 * they're detail-page content: showing them here made every card as
 * tall as an article rather than an index entry, working against the
 * "index you scan, then click into" structure this is meant to be.
 *
 * Published Library items (0049) come first; the sample articles from
 * placeholder-data.ts follow, each with a "Sample" pill, until they're
 * replaced.
 *
 * Client-side filtering only — this is a few dozen records, not a
 * corpus that needs real search infrastructure. Matches against title,
 * summary and tags, case-insensitively.
 *
 * `reviewStatus` is a data field only now — no "Review due" filter pill
 * or card badge anywhere in this view. It was originally shown to
 * Super Admins as a maintenance note, but that made it visible in this
 * account's own view of the library (Jeremy's test profile is a Super
 * Admin), which read as clutter/noise on what's supposed to be a
 * polished member-facing resource, not an editorial dashboard. If an
 * actual content-maintenance view is ever built, it belongs on its own
 * admin-only screen, not layered onto the library members browse.
 */
/** A card in the list: a published Library item, or one of the sample articles. */
export type LibraryCard = Pick<KnowledgeResource, "id" | "kind" | "title" | "summary" | "tags" | "jurisdictionLevel" | "jurisdiction"> & {
  sample?: boolean;
};

export function KnowledgeLibrary({
  resources,
  corpId,
  subscribed,
}: {
  resources: LibraryCard[];
  corpId: string;
  subscribed: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<KnowledgeResourceKind | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (activeKind !== "all" && r.kind !== activeKind) return false;
      if (!q) return true;
      const haystack = [r.title, r.summary, ...r.tags].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [resources, query, activeKind]);

  const countFor = (kind: KnowledgeResourceKind | "all") =>
    kind === "all" ? resources.length : resources.filter((r) => r.kind === kind).length;

  return (
    <div data-testid="knowledge-library">
      <input
        type="search"
        className="kb-search"
        placeholder="Search playbooks, templates, guides, legislation…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="knowledge-search"
      />

      <div className="kb-filters" data-testid="knowledge-filters">
        <button
          className="kb-filter-pill"
          data-active={activeKind === "all"}
          onClick={() => setActiveKind("all")}
        >
          All <span className="kb-filter-pill__count">{countFor("all")}</span>
        </button>
        {kinds.map((kind) => (
          <button
            key={kind}
            className="kb-filter-pill"
            data-active={activeKind === kind}
            onClick={() => setActiveKind(kind)}
            data-testid={`knowledge-filter-${kind}`}
          >
            {knowledgeResourceKindLabels[kind]}{" "}
            <span className="kb-filter-pill__count">{countFor(kind)}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="card__meta" data-testid="knowledge-empty">
          Nothing matches &ldquo;{query}&rdquo; in{" "}
          {activeKind === "all" ? "any category" : knowledgeResourceKindLabels[activeKind]}.
        </p>
      ) : (
        <div className="grid-cards kb-grid" data-testid="knowledge-results">
          {filtered.map((r) => {
            const locked = isTemplateLocked(r, subscribed);
            return (
              <Link
                href={`/strata/${corpId}/guides/${r.id}`}
                className="card kb-card"
                data-locked={locked}
                key={r.id}
                data-testid={`knowledge-card-${r.id}`}
              >
                <div className="kb-card__meta-row">
                  <span className={`kb-card__kind kb-card__kind--${r.kind}`}>
                    {knowledgeResourceKindLabels[r.kind]}
                  </span>
                  <div className="kb-card__meta-row-right">
                    {r.sample && (
                      <span className="pill pill--sample" title="A sample article, not yet reviewed">
                        Sample
                      </span>
                    )}
                    {locked && (
                      <span className="kb-lock-badge" title="Requires a Stratasphere™ subscription">
                        Subscription
                      </span>
                    )}
                    {r.jurisdictionLevel === "federal" && (
                      <span className="pill pill--federal" title="Federal legislation — applies regardless of province">
                        Federal
                      </span>
                    )}
                    {r.jurisdictionLevel === "provincial" && r.jurisdiction && (
                      <span className="pill pill--locked">{r.jurisdiction}</span>
                    )}
                  </div>
                </div>
                <h3>{r.title}</h3>
                <p>{r.summary}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
