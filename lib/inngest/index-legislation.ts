import { NonRetriableError } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { embed, toVectorLiteral } from "@/lib/kb/embed";
import { extractDocumentText } from "@/lib/kb/extract";
import { chunkLegislation, detectCurrentTo } from "@/lib/kb/legislation";
import { stripForLibrary } from "@/lib/kb/privacy";
import { LEGISLATION_INDEX_EVENT, inngest } from "@/lib/inngest/client";
import { LEGISLATION_BUCKET } from "@/lib/legislation";
import { mirrorLegislationToDemo } from "@/lib/demo-mirror";

/**
 * Index one legislation library entry (doc04 §5): read the file on our own
 * servers, split Acts and regulations by section, embed, and replace the
 * entry's chunks. Guidance is PII-stripped first; Acts and regulations are
 * public law and go as written (see stripForLibrary).
 */
export const indexLegislation = inngest.createFunction(
  {
    id: "index-legislation",
    triggers: [{ event: LEGISLATION_INDEX_EVENT }],
    retries: 3,
    concurrency: { key: "event.data.legislationId", limit: 1 },
    onFailure: async ({ event, error }) => {
      const id = (event.data.event.data as { legislationId?: string }).legislationId;
      if (!id) return;
      await createAdminClient()
        .from("legislation_documents")
        .update({ indexing_status: "failed", indexing_error: friendly(error) })
        .eq("id", id);
    },
  },
  async ({ event, step }) => {
    const id = (event.data as { legislationId: string }).legislationId;

    const extracted = await step.run("extract", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("legislation_documents")
        .select("id, storage_path, file_name, mime_type, current_to")
        .eq("id", id)
        .maybeSingle();
      if (!doc || !doc.storage_path) return { status: "gone" as const };
      await admin.from("legislation_documents").update({ indexing_status: "processing", indexing_error: null }).eq("id", id);

      const { data, error } = await admin.storage.from(LEGISLATION_BUCKET).download(doc.storage_path);
      if (error || !data) throw new Error(`Couldn't read the stored file: ${error?.message ?? "missing"}`);
      const result = await extractDocumentText(new Uint8Array(await data.arrayBuffer()), doc.file_name ?? "", doc.mime_type);
      if (result.status === "needs_text" || (result.status === "ok" && !result.text.trim())) {
        await admin.from("legislation_documents").update({ indexing_status: "needs_text" }).eq("id", id);
        return { status: "stopped" as const };
      }
      if (result.status === "unsupported") {
        await admin
          .from("legislation_documents")
          .update({ indexing_status: "not_indexable", indexing_error: result.reason })
          .eq("id", id);
        return { status: "stopped" as const };
      }
      await admin
        .from("legislation_documents")
        .update({ document_text: result.text, current_to: doc.current_to ?? detectCurrentTo(result.text) })
        .eq("id", id);
      return { status: "ok" as const };
    });

    if (extracted.status !== "ok") return extracted;

    const indexed = await step.run("embed", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("legislation_documents")
        .select("id, title, short_name, kind, current_to, document_text")
        .eq("id", id)
        .maybeSingle();
      if (!doc) throw new NonRetriableError("The library entry was deleted.");

      const text = doc.kind === "guidance" ? stripForLibrary(doc.document_text as string) : (doc.document_text as string);
      const { chunks, sections } = chunkLegislation(text, {
        title: doc.title,
        shortName: doc.short_name,
        kind: doc.kind,
        currentTo: doc.current_to,
      });
      if (!chunks.length) throw new NonRetriableError("No text to index.");
      const vectors = await embed(
        chunks.map((c) => c.text),
        "document"
      );
      const rows = chunks.map((c, i) => ({
        scope: "legislation",
        legislation_document_id: id,
        source_act: doc.title,
        title: c.title,
        chunk_text: c.text,
        embedding: toVectorLiteral(vectors[i]),
        chunk_index: i,
      }));

      await admin.from("knowledge_chunks").delete().eq("legislation_document_id", id);
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await admin.from("knowledge_chunks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(`Saving chunks failed: ${error.message}`);
      }
      await admin
        .from("legislation_documents")
        .update({
          indexing_status: "indexed",
          indexing_error: null,
          indexed_at: new Date().toISOString(),
          section_count: sections,
          chunk_count: rows.length,
        })
        .eq("id", id);
      return { status: "indexed", sections, chunks: rows.length };
    });

    // The demo site answers from the same library (lib/demo-mirror.ts).
    // Best effort: the console's copy button catches anything missed.
    await step.run("copy to the demo", async () => {
      const r = await mirrorLegislationToDemo();
      return r.ok ? { copied: r.copied } : { skipped: r.error };
    });
    return indexed;
  }
);

function friendly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("VOYAGE_API_KEY")) return "Indexing isn't set up yet (missing embeddings key).";
  return message.slice(0, 300);
}
