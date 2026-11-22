import { randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchBcLawsCurrentTo, fetchBcLawsText } from "@/lib/kb/bclaws";
import { LEGISLATION_INDEX_EVENT, LEGISLATION_REFRESH_EVENT, inngest } from "@/lib/inngest/client";
import { LEGISLATION_BUCKET } from "@/lib/legislation";
import { IS_DEMO } from "@/lib/demo";

/**
 * Knowledge Base entries read from the source (0101). An entry with a BC
 * Laws link is fetched from BC Laws as HTML, stored as text, and indexed
 * by index-legislation. Refreshing only replaces the text when BC Laws has
 * a newer consolidation than the one stored (or `force` is set, or there is
 * no text yet). The demo site never fetches: it copies the live library
 * (lib/demo-mirror.ts).
 */
export const refreshLegislation = inngest.createFunction(
  {
    id: "refresh-legislation",
    triggers: [{ event: LEGISLATION_REFRESH_EVENT }],
    retries: 2,
    concurrency: [{ limit: 2 }, { key: "event.data.legislationId", limit: 1 }],
    onFailure: async ({ event, error }) => {
      const id = (event.data.event.data as { legislationId?: string }).legislationId;
      if (!id) return;
      await createAdminClient()
        .from("legislation_documents")
        .update({ source_error: (error instanceof Error ? error.message : String(error)).slice(0, 300), source_checked_at: new Date().toISOString() })
        .eq("id", id);
    },
  },
  async ({ event, step }) => {
    if (IS_DEMO) return { skipped: "demo" };
    const { legislationId: id, force } = event.data as { legislationId: string; force?: boolean };

    const result = await step.run("fetch and store", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("legislation_documents")
        .select("id, title, source_url, current_to, storage_path")
        .eq("id", id)
        .maybeSingle();
      if (!doc) throw new NonRetriableError("The library entry was deleted.");
      if (!doc.source_url) throw new NonRetriableError("This entry has no BC Laws link.");
      const checkedAt = new Date().toISOString();

      // One request first: most weeks nothing has changed.
      if (!force && doc.storage_path && doc.current_to) {
        const latest = await fetchBcLawsCurrentTo(doc.source_url);
        if (latest && latest <= doc.current_to) {
          await admin.from("legislation_documents").update({ source_checked_at: checkedAt, source_error: null }).eq("id", id);
          return { changed: false as const, currentTo: doc.current_to as string };
        }
      }

      const { text, currentTo, parts } = await fetchBcLawsText(doc.source_url);
      if (!currentTo) throw new Error("BC Laws didn't say what date this version is current to.");
      const bytes = new TextEncoder().encode(text);
      const fileName = `${(doc.title as string).replace(/[^\w\- ]+/g, "").trim() || "document"}.txt`;
      const path = `${randomUUID()}/${fileName.replace(/\s+/g, "_")}`;
      const { error: upErr } = await admin.storage.from(LEGISLATION_BUCKET).upload(path, bytes, { contentType: "text/plain; charset=utf-8" });
      if (upErr) throw new Error(`Couldn't store the text: ${upErr.message}`);

      const { error } = await admin
        .from("legislation_documents")
        .update({
          storage_path: path,
          file_name: fileName,
          mime_type: "text/plain",
          size_bytes: bytes.byteLength,
          current_to: currentTo,
          indexing_status: "pending",
          indexing_error: null,
          source_checked_at: checkedAt,
          source_error: null,
        })
        .eq("id", id);
      if (error) {
        await admin.storage.from(LEGISLATION_BUCKET).remove([path]);
        throw new Error(`Couldn't update the entry: ${error.message}`);
      }
      if (doc.storage_path && doc.storage_path !== path) await admin.storage.from(LEGISLATION_BUCKET).remove([doc.storage_path]);
      return { changed: true as const, currentTo, parts, previous: (doc.current_to as string | null) ?? null };
    });

    if (result.changed) await step.sendEvent("index", { name: LEGISLATION_INDEX_EVENT, data: { legislationId: id } });
    return result;
  }
);

/** Every Monday, 1:41 a.m. PT: check each entry with a BC Laws link for a newer consolidation. */
export const checkLegislationSources = inngest.createFunction(
  { id: "check-legislation-sources", triggers: [{ cron: "TZ=America/Vancouver 41 1 * * 1" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    if (IS_DEMO) return { skipped: "demo" };
    const ids = await step.run("find", async () => {
      const { data } = await createAdminClient().from("legislation_documents").select("id").not("source_url", "is", null);
      return (data ?? []).map((d) => d.id as string);
    });
    if (ids.length) await step.sendEvent("refresh", ids.map((legislationId) => ({ name: LEGISLATION_REFRESH_EVENT, data: { legislationId } })));
    return { checked: ids.length };
  }
);
