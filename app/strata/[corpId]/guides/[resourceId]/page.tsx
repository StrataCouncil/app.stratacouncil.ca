import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import {
  currentCorporation,
  isTemplateLocked,
  knowledgeResourceKindLabels,
  knowledgeResources,
  relatedKnowledgeResources,
} from "@/lib/placeholder-data";

/**
 * A single Knowledge Library resource, as its own page — the "click a
 * headline, get an article with a related-reading sidebar" reading Jeremy
 * asked for, not a modal or an expanding card. Each resource already had
 * everything a list view needs (`summary`, `checklist`, tags); this page
 * is what a reader gets once they're actually here for the content
 * (`body`) plus the two things a blog layout adds: legislation citations
 * and related articles.
 *
 * Locked policy templates (`isTemplateLocked`) still get a real page —
 * title, summary, tags all render — but the article body and download
 * action are replaced with the same `lock-panel` upgrade pattern used for
 * the Stratasphere™ assistant, rather than 404ing or hiding the resource
 * entirely. Browsing the paywall is part of the incentive.
 *
 * `reviewStatus` is a data field only, not shown anywhere on this page —
 * see the note on `reviewStatus` in placeholder-data.ts for why.
 */
export default async function KnowledgeResourcePage({
  params,
}: {
  params: Promise<{ corpId: string; resourceId: string }>;
}) {
  const { resourceId } = await params;
  const resource = knowledgeResources.find((r) => r.id === resourceId);
  if (!resource) notFound();

  const subscribed = currentCorporation.subscriptionStatus === "active";
  const locked = isTemplateLocked(resource, subscribed);
  const related = relatedKnowledgeResources(resource, knowledgeResources);

  return (
    <>
      <StrataSphereNav active="guides" />

      <Link href={`/strata/${currentCorporation.id}/guides`} className="kb-article__back">
        &larr; Knowledge library
      </Link>

      <div className="kb-article">
        <article className="kb-article__main">
          <div className="kb-card__meta-row" style={{ marginBottom: "0.6rem" }}>
            <span className={`kb-card__kind kb-card__kind--${resource.kind}`}>
              {knowledgeResourceKindLabels[resource.kind]}
            </span>
            <div className="kb-card__meta-row-right">
              {locked && (
                <span className="kb-lock-badge" title="Requires a Stratasphere™ subscription">
                  &#128274; Subscription
                </span>
              )}
              {resource.jurisdictionLevel === "federal" && (
                <span className="pill pill--federal" title="Federal legislation — applies regardless of province">
                  Federal
                </span>
              )}
              {resource.jurisdictionLevel === "provincial" && resource.jurisdiction && (
                <span className="pill pill--locked">{resource.jurisdiction}</span>
              )}
            </div>
          </div>

          <h1 className="kb-article__title">{resource.title}</h1>
          <p className="kb-article__summary">{resource.summary}</p>
          <span className="card__meta">Updated {resource.updatedAt}</span>

          {locked ? (
            <div className="lock-panel" style={{ marginTop: "1.75rem" }} data-testid="template-lock-panel">
              <h2>This template requires a subscription</h2>
              <p>
                Policy templates are downloadable, editable documents &mdash; the one
                part of the Knowledge Library that&rsquo;s behind Stratasphere&trade;.
                Playbooks, guides, financial insights and legislation updates stay
                free for every connected member.
              </p>
              <Link
                href={`/strata/${currentCorporation.id}/billing`}
                className="button button-primary"
                data-testid="template-subscribe-cta"
              >
                Subscribe to Stratasphere&trade;
              </Link>
            </div>
          ) : (
            <>
              <div className="kb-article__body">
                {resource.body.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>

              {resource.checklist && resource.checklist.length > 0 && (
                <div className="kb-article__section">
                  <h2>Checklist</h2>
                  <ul className="kb-card__checklist kb-article__checklist">
                    {resource.checklist.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {resource.commonMistakes && (
                <div className="kb-article__callout">
                  <strong>Common mistake</strong>
                  <p>{resource.commonMistakes}</p>
                </div>
              )}

              {resource.kind === "policy_template" && (
                <button className="button button-primary" style={{ alignSelf: "flex-start" }}>
                  Download template
                </button>
              )}
            </>
          )}

          <div className="kb-card__tags" style={{ marginTop: "1.5rem" }}>
            {resource.tags.map((tag) => (
              <span className="kb-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </article>

        <aside className="kb-article__sidebar">
          {resource.legislationReferences && resource.legislationReferences.length > 0 && (
            <div className="kb-sidebar-block">
              <h3>Legislation referenced</h3>
              <ul className="kb-sidebar-list">
                {resource.legislationReferences.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ul>
            </div>
          )}

          {related.length > 0 && (
            <div className="kb-sidebar-block">
              <h3>Related</h3>
              <ul className="kb-sidebar-list kb-sidebar-list--links">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/strata/${currentCorporation.id}/guides/${r.id}`}>
                      {r.title}
                    </Link>
                    <span className="kb-sidebar-list__kind">
                      {knowledgeResourceKindLabels[r.kind]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
