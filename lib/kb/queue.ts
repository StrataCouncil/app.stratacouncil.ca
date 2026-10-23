import {
  CORPORATION_FINGERPRINT_EVENT,
  DOCUMENT_FINGERPRINT_EVENT,
  DOCUMENT_INDEX_EVENT,
  LEGISLATION_INDEX_EVENT,
  inngest,
} from "@/lib/inngest/client";

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

/** The same, for Knowledge Base entries (Super Admin uploads). */
export async function queueLegislationIndexing(legislationIds: string[]) {
  if (legislationIds.length === 0) return;
  try {
    await inngest.send(legislationIds.map((legislationId) => ({ name: LEGISLATION_INDEX_EVENT, data: { legislationId } })));
  } catch (err) {
    console.error("[queueLegislationIndexing]", err instanceof Error ? err.message : err);
  }
}

/** Fingerprint newly stored files, so identical copies can be found. */
export async function queueDocumentFingerprints(documentIds: string[]) {
  if (documentIds.length === 0) return;
  try {
    await inngest.send(documentIds.map((documentId) => ({ name: DOCUMENT_FINGERPRINT_EVENT, data: { documentId } })));
  } catch (err) {
    console.error("[queueDocumentFingerprints]", err instanceof Error ? err.message : err);
  }
}

/** Fingerprint every stored file of a strata that doesn't have one yet (files from before 0065). */
export async function queueCorporationFingerprints(corporationId: string) {
  try {
    await inngest.send({ name: CORPORATION_FINGERPRINT_EVENT, data: { corporationId } });
  } catch (err) {
    console.error("[queueCorporationFingerprints]", err instanceof Error ? err.message : err);
  }
}
