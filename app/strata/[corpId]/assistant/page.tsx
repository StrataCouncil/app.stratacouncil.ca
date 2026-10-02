import { SubscribeCta } from "@/components/SubscribeCta";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { StratasphereChat } from "@/components/StratasphereChat";
import { getStrataAccess } from "@/lib/data/strata";
import { listConversations } from "@/lib/data/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * Standalone Stratasphere assistant: never free, not even during the
 * trial window (doc01 §4b). Only the embedded Meeting Mode assistant is
 * ever free. Conversations are the signed-in person's own (0019).
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  const subscribed = access?.subscribed ?? false;

  if (!subscribed) {
    return (
      <>
        <StrataSphereNav active="assistant" />
        <h2 style={{ marginBottom: "1rem" }}>Stratasphere&trade;</h2>
        <div className="lock-panel">
          <h2>Ask questions about your strata&rsquo;s documents</h2>
          <p>
            The standalone Stratasphere&trade; assistant requires an active
            subscription &mdash; it&rsquo;s never part of the free tier, even
            during your one free meeting.
          </p>
          <SubscribeCta testId="assistant-subscribe-cta" />
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const [{ conversations, projects }, { data: corp }, { count }] = await Promise.all([
    listConversations(corpId),
    supabase.from("strata_corporations").select("building_name, legal_name").eq("strata_plan_number", corpId).maybeSingle(),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("corporation_id", corpId)
      .eq("indexing_status", "indexed"),
  ]);

  return (
    <>
      <StrataSphereNav active="assistant" />
      <StratasphereChat
        corpId={corpId}
        corpName={corp?.building_name || corp?.legal_name || corpId}
        indexedDocuments={count ?? 0}
        initialConversations={conversations}
        initialProjects={projects}
      />
    </>
  );
}
