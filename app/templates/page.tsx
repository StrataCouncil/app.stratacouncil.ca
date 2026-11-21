import { AppShell } from "@/components/AppShell";
import { KnowledgeLibrary, type LibraryCard } from "@/components/KnowledgeLibrary";
import { LibraryDisclaimer } from "@/components/library/LibraryDisclaimer";
import { ResourcesNav } from "@/components/ResourcesNav";
import { listPublishedLibrary } from "@/lib/data/library";
import { isFormOrTemplate } from "@/lib/library/catalogue";

// Read per request: published items change, and the page needs the signed-in person.
export const dynamic = "force-dynamic";

/**
 * Forms & Templates, in Resources (2026-11-13): the Library's policy
 * templates and forms, on a page of their own. Published the same way as
 * the rest of the Library (Super Admin); free for everyone signed in, with
 * or without a strata. Each opens on its own page (`/library/[resourceId]`)
 * and downloads blank as Word, for the council to fill in.
 */
export default async function TemplatesPage() {
  const published = await listPublishedLibrary();
  const cards: LibraryCard[] = [
    ...published.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      tags: r.tags,
      jurisdictionLevel: "provincial" as const,
      jurisdiction: "BC",
    })),
  ].filter((c) => isFormOrTemplate(c.kind));

  return (
    <AppShell>
      <div className="wrap page">
        <ResourcesNav active="templates" />
        <div className="page-header">
          <h1>Forms &amp; Templates</h1>
          <p>
            Policy templates and forms for BC strata councils, ready to download as Word and fill in with your
            strata&rsquo;s details. Free for everyone.
          </p>
        </div>
        <LibraryDisclaimer />
        <KnowledgeLibrary resources={cards} placeholder="Search forms and templates…" />
      </div>
    </AppShell>
  );
}
