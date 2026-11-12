import { AppShell } from "@/components/AppShell";
import { KnowledgeLibrary, type LibraryCard } from "@/components/KnowledgeLibrary";
import { LibraryDisclaimer } from "@/components/library/LibraryDisclaimer";
import { ResourcesNav } from "@/components/ResourcesNav";
import { listPublishedLibrary } from "@/lib/data/library";
import { knowledgeResources } from "@/lib/library/catalogue";

// Read per request: published items change, and the page needs the signed-in person.
export const dynamic = "force-dynamic";

/**
 * The Library, in Resources (2026-11-12): free for everyone signed in,
 * whether or not they belong to a strata, and on any screen. Playbooks,
 * guides, policy templates, and forms in one searchable set (see
 * `KnowledgeLibrary`); each item has its own page (`/library/[resourceId]`).
 * Templates and forms download blank, for the council to fill in.
 */
export default async function LibraryPage() {
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
    ...knowledgeResources.map((r) => ({ ...r, sample: true })),
  ];

  return (
    <AppShell>
      <div className="wrap page">
        <ResourcesNav active="library" />
        <div className="page-header">
          <h1>Library</h1>
          <p>
            Playbooks, practical guides, and emergency playbooks for BC strata councils, with policy templates and forms
            you can download and adapt. Free for everyone.
          </p>
        </div>
        <LibraryDisclaimer />
        <KnowledgeLibrary resources={cards} />
      </div>
    </AppShell>
  );
}
