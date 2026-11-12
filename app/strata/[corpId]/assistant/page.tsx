import { SubscribeCta } from "@/components/SubscribeCta";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { StratasphereChat } from "@/components/StratasphereChat";
import { getStrataAccess } from "@/lib/data/strata";
import { IndexingNote } from "@/components/IndexingNote";
import { listConversations } from "@/lib/data/conversations";
import { createClient } from "@/lib/supabase/server";
import { demoAllowanceLeft } from "@/lib/demo-usage";

/**
 * The Stratasphere assistant: paid, and for council members, managers, and
 * admins only (0090). Conversations are the signed-in person's own (0033).
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);

  if (!access?.stratasphere) {
    return (
      <>
        <StrataSphereNav active="assistant" />
        <h2 style={{ marginBottom: "1rem" }}>Stratasphere&trade;</h2>
        <div className="lock-panel">
          <h2>Ask questions about your strata&rsquo;s records</h2>
          {access?.subscribed ? (
            <p>Stratasphere&trade; is for council members, managers, and admins.</p>
          ) : (
            <>
              <p>
                Stratasphere&trade; answers from your strata&rsquo;s bylaws, minutes, documents, and decisions, with
                its sources, and from BC strata legislation. It comes with a subscription.
              </p>
              <SubscribeCta testId="assistant-subscribe-cta" />
            </>
          )}
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const [{ conversations, projects }, { data: corp }, { count }, demoLeft] = await Promise.all([
    listConversations(corpId),
    supabase.from("strata_corporations").select("building_name, legal_name").eq("strata_plan_number", corpId).maybeSingle(),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("corporation_id", corpId)
      .eq("indexing_status", "indexed"),
    demoAllowanceLeft(),
  ]);

  return (
    <>
      <StrataSphereNav active="assistant" />
      <IndexingNote corpId={access.corpId} subscribed={access.subscribed} />
      <StratasphereChat
        corpId={corpId}
        corpName={corp?.building_name || corp?.legal_name || corpId}
        indexedDocuments={count ?? 0}
        initialConversations={conversations}
        initialProjects={projects}
        demoLeft={demoLeft?.chat ?? null}
      />
    </>
  );
}
