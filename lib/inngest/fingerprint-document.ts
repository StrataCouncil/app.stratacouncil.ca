import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/fingerprint";
import { CORPORATION_FINGERPRINT_EVENT, DOCUMENT_FINGERPRINT_EVENT, inngest } from "@/lib/inngest/client";

/**
 * Fingerprint stored files (0065): read the file on our own servers and
 * save the SHA-256 of its bytes on the document row, so Documents can
 * spot identical copies. Links have no file and are skipped.
 */
export const fingerprintDocument = inngest.createFunction(
  {
    id: "fingerprint-document",
    triggers: [{ event: DOCUMENT_FINGERPRINT_EVENT }],
    retries: 3,
    concurrency: { key: "event.data.documentId", limit: 1 },
  },
  async ({ event, step }) => {
    const documentId = (event.data as { documentId: string }).documentId;
    return step.run("hash", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("documents")
        .select("id, storage_path, content_sha256")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc?.storage_path) return { status: "no file" };
      if (doc.content_sha256) return { status: "done already" };
      const slash = doc.storage_path.indexOf("/");
      const { data, error } = await admin.storage
        .from(doc.storage_path.slice(0, slash))
        .download(doc.storage_path.slice(slash + 1));
      if (error || !data) throw new Error(`Couldn't read the stored file: ${error?.message ?? "missing"}`);
      const hash = await sha256Hex(await data.arrayBuffer());
      const { error: saveError } = await admin.from("documents").update({ content_sha256: hash }).eq("id", documentId);
      if (saveError) throw new Error(`Couldn't save the fingerprint: ${saveError.message}`);
      return { status: "ok" };
    });
  }
);

/**
 * A strata's files from before fingerprints existed: queued once a day at
 * most per strata (idempotency), when someone opens Documents.
 */
export const fingerprintCorporation = inngest.createFunction(
  {
    id: "fingerprint-corporation",
    triggers: [{ event: CORPORATION_FINGERPRINT_EVENT }],
    idempotency: "event.data.corporationId",
  },
  async ({ event, step }) => {
    const corporationId = (event.data as { corporationId: string }).corporationId;
    const ids = await step.run("find", async () => {
      const { data } = await createAdminClient()
        .from("documents")
        .select("id")
        .eq("corporation_id", corporationId)
        .is("content_sha256", null)
        .not("storage_path", "is", null)
        .limit(2000);
      return (data ?? []).map((d) => d.id as string);
    });
    if (ids.length) {
      await step.sendEvent(
        "fingerprint-each",
        ids.map((documentId) => ({ name: DOCUMENT_FINGERPRINT_EVENT, data: { documentId } }))
      );
    }
    return { queued: ids.length };
  }
);
