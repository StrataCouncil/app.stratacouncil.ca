import { DOCUMENT_INDEX_EVENT, LEGISLATION_INDEX_EVENT, inngest } from "@/lib/inngest/client";

/**
 * Ask the background indexer to (re)index documents. Failure to queue is
 * logged, not thrown: the row stays `pending`, the repository shows it as
 * not indexed yet, and the Index button retries.
 */
export async function queueDocumentIndexing(documentIds: string[]) {
  if (documentIds.length === 0) return;
  try {
    await inngest.send(documentIds.map((documentId) => ({ name: DOCUMENT_INDEX_EVENT, data: { documentId } })));
  } catch (err) {
    console.error("[queueDocumentIndexing]", err instanceof Error ? err.message : err);
  }
}

/** The same, for legislation library entries (Super Admin uploads). */
export async function queueLegislationIndexing(legislationIds: string[]) {
  if (legislationIds.length === 0) return;
  try {
    await inngest.send(legislationIds.map((legislationId) => ({ name: LEGISLATION_INDEX_EVENT, data: { legislationId } })));
  } catch (err) {
    console.error("[queueLegislationIndexing]", err instanceof Error ? err.message : err);
  }
}
