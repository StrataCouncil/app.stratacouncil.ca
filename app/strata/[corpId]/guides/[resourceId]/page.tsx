import { SubscribeCta } from "@/components/SubscribeCta";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { LibraryDisclaimer } from "@/components/library/LibraryDisclaimer";
import { LibraryArticle } from "@/components/library/LibraryArticle";
import { getPublishedLibraryItem, listPublishedLibrary, type PublishedLibraryEntry } from "@/lib/data/library";
import { getStrataAccess } from "@/lib/data/strata";
import { logUserActivity } from "@/lib/user-activity";
import { isUuid } from "@/lib/library/library";
import {
  isDownloadableKind,
  isTemplateLocked,
  knowledgeResourceKindLabels,
  knowledgeResources,
} from "@/lib/library/catalogue";

/**
 * A single Library resource, as its own page — the "click a
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
 * see the note on `reviewStatus` in lib/library/catalogue.ts for why.
 */
export default async function KnowledgeResourcePage({
  params,
}: {
  params: Promise<{ corpId: string; resourceId: string }>;
}) {
  const { corpId, resourceId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  if (isUuid(resourceId)) {
    const item = await getPublishedLibraryItem(resourceId);
    if (!item) notFound();
    await logUserActivity({ kind: "guide_opened", strata: corpId, ref: item.id, label: item.title });
    return <LibraryItemPage item={item} corpId={corpId} subscribed={access.subscribed} />;
  }
  // Placeholder articles show on the Library as "Coming soon" and don't
  // open; an old link to one lands back on the Library.
  if (!knowledgeResources.some((r) => r.id === resourceId)) notFound();
  redirect(`/strata/${corpId}/guides`);
}

/** A published Library item (0049). Templates are for subscribers. */
async function LibraryItemPage({ item, corpId, subscribed }: { item: PublishedLibraryEntry; corpId: string; subscribed: boolean }) {
  const locked = isTemplateLocked(item, subscribed);
  const others = (await listPublishedLibrary()).filter((r) => r.id !== item.id);
  const related = others
    .map((r) => ({ r, score: r.tags.filter((t) => item.tags.includes(t)).length + (r.kind === item.kind ? 0.5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.r);
  const updated = new Date(item.publishedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <StrataSphereNav active="guides" />

      <Link href={`/strata/${corpId}/guides`} className="kb-article__back">
        &larr; Library
      </Link>

      <div className="kb-article">
        <article className="kb-article__main" data-testid="library-item">
          <div className="kb-card__meta-row" style={{ marginBottom: "0.6rem" }}>
            <span className={`kb-card__kind kb-card__kind--${item.kind}`}>{knowledgeResourceKindLabels[item.kind]}</span>
            <div className="kb-card__meta-row-right">
              {locked && (
                <span className="kb-lock-badge" title="Requires a Stratasphere™ subscription">
                  Subscription
                </span>
              )}
              <span className="pill pill--locked">BC</span>
            </div>
          </div>

          <h1 className="kb-article__title">{item.title}</h1>
          <p className="kb-article__summary">{item.summary}</p>
          <span className="card__meta">Updated {updated}</span>
          <div style={{ marginTop: "1.25rem" }}>
            <LibraryDisclaimer compact />
          </div>

          {isDownloadableKind(item.kind) && !locked && (
            <div className="template-download" data-testid="template-download">
              <a className="button button-secondary button-small" href={`/strata/${corpId}/guides/${item.id}/template.docx`} data-testid="template-docx">
                Download as Word (.docx)
              </a>
              {item.kind === "form" ? (
                <p>Filled in with your strata&rsquo;s name and plan number, ready to adapt and use.</p>
              ) : (
                <p>
                  Filled in with your strata&rsquo;s name and plan number. Adapt it to your strata, review and approve it as a
                  council, add the date it&rsquo;s activated, then upload the approved policy to{" "}
                  <Link href={`/strata/${corpId}/documents`}>Documents</Link> if you wish.
                </p>
              )}
            </div>
          )}

          {locked ? (
            <div className="lock-panel" style={{ marginTop: "1.75rem" }} data-testid="template-lock-panel">
              <h2>This {item.kind === "form" ? "form" : "template"} requires a subscription</h2>
              <p>
                Policy templates and forms are the part of the Library that&rsquo;s behind Stratasphere&trade;. Playbooks and
                guides stay free for every connected member.
              </p>
              <SubscribeCta testId="template-subscribe-cta" />
            </div>
          ) : (
            <LibraryArticle markup={item.markup} />
          )}
        </article>

        <aside className="kb-article__sidebar">
          {item.sources.length > 0 && (
            <div className="kb-sidebar-block">
              <h3>Legislation referenced</h3>
              <ul className="kb-sidebar-list">
                {item.sources.map((s) => (
                  <li key={s.chunkId}>{s.label}</li>
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
                    <Link href={`/strata/${corpId}/guides/${r.id}`}>{r.title}</Link>
                    <span className="kb-sidebar-list__kind">{knowledgeResourceKindLabels[r.kind]}</span>
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
