import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { KnowledgeLibrary, type LibraryCard } from "@/components/KnowledgeLibrary";
import { listPublishedLibrary } from "@/lib/data/library";
import { getStrataAccess } from "@/lib/data/strata";
import { knowledgeResources } from "@/lib/placeholder-data";

/**
 * The Knowledge Library — jurisdiction-scoped (doc01 §3b), free with one
 * exception: policy templates require a Stratasphere™ subscription (see
 * `isTemplateLocked` in placeholder-data.ts). Leads the Stratasphere™ nav
 * on purpose: this is the thing a brand-new council member gets immediate
 * value from, before anything else here means much to them. Playbooks,
 * policy templates, operational guides, financial insights, legislation
 * updates and emergency playbooks all live in one searchable set rather
 * than scattered across separate tabs — see `KnowledgeLibrary` for the
 * search/filter behavior and each card's own page (`/guides/[resourceId]`)
 * for the full article.
 */
export default async function GuidesPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const subscribed = access.subscribed;
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
    <>
      <StrataSphereNav active="guides" />
      <h2 style={{ marginBottom: "0.3rem" }}>Library</h2>
      <p className="card__meta" style={{ marginBottom: "1.25rem" }}>
        A growing, free library of playbooks, operational guides,
        financial insights, legislation updates and emergency playbooks
        for every connected member &mdash; plus downloadable, editable
        policy templates with a Stratasphere&trade; subscription.
      </p>
      <KnowledgeLibrary
        resources={cards}
        corpId={corpId}
        subscribed={subscribed}
      />
    </>
  );
}
