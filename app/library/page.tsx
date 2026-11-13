import { AppShell } from "@/components/AppShell";
import { KnowledgeLibrary, type LibraryCard } from "@/components/KnowledgeLibrary";
import { LibraryDisclaimer } from "@/components/library/LibraryDisclaimer";
import { ResourcesNav } from "@/components/ResourcesNav";
import { listPublishedLibrary } from "@/lib/data/library";
import { isFormOrTemplate, knowledgeResources } from "@/lib/library/catalogue";

// Read per request: published items change, and the page needs the signed-in person.
export const dynamic = "force-dynamic";

/**
 * The Library, in Resources (2026-11-12): free for everyone signed in,
 * whether or not they belong to a strata, and on any screen. Playbooks and
 * guides in one searchable set (see `KnowledgeLibrary`); each item has its
 * own page (`/library/[resourceId]`). Policy templates and forms are on
 * their own page, Forms & Templates (app/templates/page.tsx).
 */
export default async function LibraryPage() {
  const published = await listPublishedLibrary();
  const all: LibraryCard[] = [
    ...published.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      tags: r.tags,
      jurisdictionLevel: "provincial" as const,
      jurisdiction: "BC",
    })),
    ...knowledgeResources.map((r) => ({ ...r, sample: true })),
  ];
  const cards = all.filter((c) => !isFormOrTemplate(c.kind));

  return (
    <AppShell>
      <div className="wrap page">
        <ResourcesNav active="library" />
        <div className="page-header">
          <h1>Library</h1>
          <p>
            Playbooks, practical guides, and emergency playbooks for BC strata councils. Free for everyone. Policy
            templates and forms are in <a href="/templates">Forms &amp; Templates</a>.
          </p>
        </div>
        <LibraryDisclaimer />
        <KnowledgeLibrary resources={cards} />
      </div>
    </AppShell>
  );
}
