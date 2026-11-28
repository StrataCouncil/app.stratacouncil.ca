import { tz } from "@/lib/time-zone";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ResourcesNav } from "@/components/ResourcesNav";
import { LibraryDisclaimer } from "@/components/library/LibraryDisclaimer";
import { LibraryArticle } from "@/components/library/LibraryArticle";
import { LibraryShare } from "@/components/library/LibraryShare";
import { APP_URL } from "@/lib/app-url";
import { getPublishedLibraryItem, listPublishedLibrary, type PublishedLibraryEntry } from "@/lib/data/library";
import { logUserActivity } from "@/lib/user-activity";
import { isUuid } from "@/lib/library/library";
import {
  isDownloadableKind,
  knowledgeResourceKindLabels,
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
 * In Resources (2026-11-12): free for everyone signed in, with or without a
 * strata. Policy templates and forms download blank.
 *
 * `reviewStatus` is a data field only, not shown anywhere on this page —
 * see the note on `reviewStatus` in lib/library/catalogue.ts for why.
 */
const publishedItem = cache(getPublishedLibraryItem);

/** The item's name as the page title: the browser tab, the share sheet, and the top of a printed page. */
export async function generateMetadata({ params }: { params: Promise<{ resourceId: string }> }): Promise<Metadata> {
  const { resourceId } = await params;
  const item = isUuid(resourceId) ? await publishedItem(resourceId) : null;
  return item ? { title: `${item.title} | StrataCouncil.ca` } : {};
}

export default async function KnowledgeResourcePage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const { resourceId } = await params;
  if (isUuid(resourceId)) {
    const item = await publishedItem(resourceId);
    if (!item) notFound();
    await logUserActivity({ kind: "guide_opened", strata: null, ref: item.id, label: item.title });
    return <LibraryItemPage item={item} />;
  }
  // The old placeholder articles had short ids ("kb3"); a link to one lands back on the Library.
  if (/^kb\d+$/.test(resourceId)) redirect("/library");
  notFound();
}

/** A published Library item (0049). Templates and forms download blank. */
async function LibraryItemPage({ item }: { item: PublishedLibraryEntry }) {
  const others = (await listPublishedLibrary()).filter((r) => r.id !== item.id);
  const related = others
    .map((r) => ({ r, score: r.tags.filter((t) => item.tags.includes(t)).length + (r.kind === item.kind ? 0.5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.r);
  const pageUrl = `${APP_URL}/library/${item.id}`;
  const updated = new Date(item.publishedAt).toLocaleDateString("en-CA", { timeZone: tz("America/Vancouver", item.publishedAt), year: "numeric", month: "long", day: "numeric" });

  return (
    <AppShell>
      <div className="wrap page">
      <ResourcesNav active={isDownloadableKind(item.kind) ? "templates" : "library"} />

      {isDownloadableKind(item.kind) ? (
        <Link href="/templates" className="kb-article__back">
          &larr; Forms &amp; Templates
        </Link>
      ) : (
        <Link href="/library" className="kb-article__back">
          &larr; Library
        </Link>
      )}

      <div className="kb-article">
        <article className="kb-article__main" data-testid="library-item">
          <div className="kb-card__meta-row" style={{ marginBottom: "0.6rem" }}>
            <span className={`kb-card__kind kb-card__kind--${item.kind}`}>{knowledgeResourceKindLabels[item.kind]}</span>
            <div className="kb-card__meta-row-right">
              <span className="pill pill--locked">BC</span>
            </div>
          </div>

          <h1 className="kb-article__title">{item.title}</h1>
          <p className="kb-article__summary">{item.summary}</p>
          <span className="card__meta">Updated {updated}</span>
          <LibraryShare url={pageUrl} title={item.title} />
          <div style={{ marginTop: "1.25rem" }}>
            <LibraryDisclaimer compact />
          </div>

          {isDownloadableKind(item.kind) && (
            <div className="template-download" data-testid="template-download">
              <a className="button button-secondary button-small" href={`/library/${item.id}/template.docx`} data-testid="template-docx">
                Download as Word (.docx)
              </a>
              {item.kind === "form" ? (
                <p>A blank form, ready to fill in with your strata&rsquo;s details.</p>
              ) : (
                <p>
                  A blank template. Fill in your strata&rsquo;s details, adapt it, review and approve it as a council, add the
                  date it&rsquo;s activated, then upload the approved policy to your strata&rsquo;s Documents if you wish.
                </p>
              )}
            </div>
          )}

          <LibraryArticle markup={item.markup} />

          {/* On paper only: the sidebar doesn't print, so its sources come here, with the page's address. */}
          <div className="lib-print-only" aria-hidden="true">
            {item.sources.length > 0 && (
              <>
                <h2 className="lib-print-only__title">Legislation referenced</h2>
                <ul>
                  {item.sources.map((s) => (
                    <li key={s.chunkId}>{s.label}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="lib-print-only__url">{pageUrl}</p>
          </div>
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
                    <Link href={`/library/${r.id}`}>{r.title}</Link>
                    <span className="kb-sidebar-list__kind">{knowledgeResourceKindLabels[r.kind]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      </div>
    </AppShell>
  );
}
