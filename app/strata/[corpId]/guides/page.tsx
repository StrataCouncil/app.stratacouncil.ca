import { StrataSphereNav } from "@/components/StrataSphereNav";
import { KnowledgeLibrary } from "@/components/KnowledgeLibrary";
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
  const subscribed = (await getStrataAccess(corpId))?.subscribed ?? false;

  return (
    <>
      <StrataSphereNav active="guides" />
      <h2 style={{ marginBottom: "0.3rem" }}>Knowledge library</h2>
      <p className="card__meta" style={{ marginBottom: "1.25rem" }}>
        A growing, free library of playbooks, operational guides,
        financial insights, legislation updates and emergency playbooks
        for every connected member &mdash; plus downloadable, editable
        policy templates with a Stratasphere&trade; subscription.
      </p>
      <KnowledgeLibrary
        resources={knowledgeResources}
        corpId={corpId}
        subscribed={subscribed}
      />
    </>
  );
}
