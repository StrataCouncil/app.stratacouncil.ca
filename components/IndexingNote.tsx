import { createAdminClient } from "@/lib/supabase/admin";

/**
 * While Stratasphere is still reading a subscribed strata's documents
 * (2026-11-12): how many are left, and that answers may not include them
 * yet. Shown on Ask and Documents; gone as soon as the count is zero. On
 * subscribing, every document stored while unsubscribed is read once
 * (queueWaitingDocuments), which can take a while for a large library.
 *
 * Server only, after the page has checked the person's access. Counts
 * documents queued or being read; 'waiting' ones too, in case a strata has
 * just subscribed and the queue hasn't picked them up yet.
 */
export async function countDocumentsBeingRead(corpId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("corporation_id", corpId)
    .in("indexing_status", ["pending", "processing", "waiting"]);
  return count ?? 0;
}

export async function IndexingNote({ corpId, subscribed }: { corpId: string; subscribed: boolean }) {
  if (!subscribed) return null;
  const n = await countDocumentsBeingRead(corpId);
  if (n === 0) return null;
  return (
    <p className="sync-note" role="status" style={{ marginBottom: "1.25rem" }} data-testid="indexing-note">
      <span>
        Stratasphere&trade; is still reading {n === 1 ? "1 document" : `${n.toLocaleString("en-CA")} documents`}. Answers may not
        include {n === 1 ? "it" : "them"} until {n === 1 ? "it's" : "they're"} read, which can take up to 24 hours.
      </span>
    </p>
  );
}
