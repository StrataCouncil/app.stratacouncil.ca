import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_INDEX_EVENT, LEGISLATION_INDEX_EVENT, inngest } from "@/lib/inngest/client";

/**
 * Scanned PDFs filed before OCR existed (0071) are still marked "No text
 * layer", with no OCR attempt. Every hour, queue up to 50 of them for
 * indexing, which now reads their scanned pages. Once OCR has been tried
 * on a document (ocr_attempted_at), it isn't picked up again: one that
 * still can't be read stays as it is until someone re-indexes it.
 *
 * Spreadsheets (.xlsx, .csv) and photos (.jpg, .png) stored before they
 * could be read (2026-11-28) are marked "not indexable"; they're queued the
 * same way, 50 an hour, until none are left.
 *
 * Scans read before the careful second reading (lib/kb/ocr.ts, 2026-11-28)
 * are read again once, 20 an hour: re-reading sets ocr_attempted_at to
 * now, past REREAD_BEFORE, so each is picked up only once.
 */
const NEWLY_READABLE = ["xlsx", "csv", "jpg", "jpeg", "png"];
const REREAD_BEFORE = "2026-12-01T00:00:00Z";

export const rereadScans = inngest.createFunction(
  { id: "reread-scans", triggers: [{ cron: "17 * * * *" }] },
  async ({ step }) => {
    const ids = await step.run("find", async () => {
      const admin = createAdminClient();
      const [{ data: docs }, { data: entries }, { data: newlyReadable }, { data: olderScans }] = await Promise.all([
        admin.from("documents").select("id").eq("indexing_status", "needs_text").is("ocr_attempted_at", null).order("uploaded_at").limit(50),
        admin.from("legislation_documents").select("id").eq("indexing_status", "needs_text").is("ocr_attempted_at", null).limit(20),
        admin
          .from("documents")
          .select("id")
          .eq("indexing_status", "not_indexable")
          .or(NEWLY_READABLE.map((ext) => `file_name.ilike.%.${ext}`).join(","))
          .order("uploaded_at")
          .limit(50),
        admin
          .from("documents")
          .select("id")
          .eq("indexing_status", "indexed")
          .eq("text_source", "ocr")
          .lt("ocr_attempted_at", REREAD_BEFORE)
          .order("uploaded_at")
          .limit(20),
      ]);
      return {
        documents: [...(docs ?? []), ...(newlyReadable ?? []), ...(olderScans ?? [])].map((d) => d.id as string),
        legislation: (entries ?? []).map((e) => e.id as string),
      };
    });
    const events = [
      ...ids.documents.map((documentId) => ({ name: DOCUMENT_INDEX_EVENT, data: { documentId } })),
      ...ids.legislation.map((legislationId) => ({ name: LEGISLATION_INDEX_EVENT, data: { legislationId } })),
    ];
    if (events.length) await step.sendEvent("queue", events);
    return { queued: events.length };
  }
);
