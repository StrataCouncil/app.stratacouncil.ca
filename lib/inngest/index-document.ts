import { NonRetriableError } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeJson } from "@/lib/ai/claude";
import { chunkText } from "@/lib/kb/chunk";
import { embed, toVectorLiteral } from "@/lib/kb/embed";
import { extractDocumentText } from "@/lib/kb/extract";
import { fetchLink, LinkFetchError } from "@/lib/kb/fetch-link";
import { loadStripContext, stripForCorporation, stripForGlobal } from "@/lib/kb/privacy";
import { DOCUMENT_INDEX_EVENT, inngest } from "@/lib/inngest/client";

/**
 * Index one document into the knowledge base (doc02 §1, doc04 §5):
 *
 *   1. extract — read the file (or fetch the link once) on our own
 *      servers, store the raw text on the document row, which only the
 *      corporation's members can read.
 *   2. embed — strip PII, classify the document type from a stripped
 *      sample, chunk, embed with Voyage, replace this document's chunks.
 *      If the corporation is subscribed right now, also write an
 *      identity-stripped copy into the global precedent pool.
 *
 * Nothing unstripped is ever sent to Voyage or Anthropic.
 */

export const DOC_TYPES = [
  "bylaws",
  "strata-plan",
  "minutes",
  "financial",
  "correspondence",
  "contract",
  "template",
  "policy",
  "disclosure",
  "other",
] as const;

export const indexDocument = inngest.createFunction(
  {
    id: "index-document",
    triggers: [{ event: DOCUMENT_INDEX_EVENT }],
    retries: 3,
    concurrency: { key: "event.data.documentId", limit: 1 },
    onFailure: async ({ event, error }) => {
      const documentId = (event.data.event.data as { documentId?: string }).documentId;
      if (!documentId) return;
      await createAdminClient()
        .from("documents")
        .update({ indexing_status: "failed", indexing_error: friendly(error) })
        .eq("id", documentId);
    },
  },
  async ({ event, step }) => {
    const documentId = (event.data as { documentId: string }).documentId;

    const extracted = await step.run("extract", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("documents")
        .select("id, corporation_id, storage_path, file_name, mime_type, source_type, url")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc || !doc.corporation_id) return { status: "gone" as const };
      await admin.from("documents").update({ indexing_status: "processing", indexing_error: null }).eq("id", documentId);

      let bytes: Uint8Array;
      let name = doc.file_name ?? "";
      let mime = doc.mime_type as string | null;
      try {
        if (doc.source_type === "link") {
          const fetched = await fetchLink(doc.url!);
          bytes = fetched.bytes;
          mime = fetched.contentType.split(";")[0];
          name = new URL(fetched.finalUrl).pathname.split("/").pop() || "page.html";
        } else {
          const slash = doc.storage_path!.indexOf("/");
          const { data, error } = await admin.storage
            .from(doc.storage_path!.slice(0, slash))
            .download(doc.storage_path!.slice(slash + 1));
          if (error || !data) throw new Error(`Couldn't read the stored file: ${error?.message ?? "missing"}`);
          bytes = new Uint8Array(await data.arrayBuffer());
        }
      } catch (err) {
        if (err instanceof LinkFetchError) throw new NonRetriableError(err.message);
        throw err;
      }

      const result = await extractDocumentText(bytes, name, mime);
      if (result.status === "needs_text") {
        await admin.from("documents").update({ indexing_status: "needs_text" }).eq("id", documentId);
        return { status: "stopped" as const };
      }
      if (result.status === "unsupported") {
        await admin
          .from("documents")
          .update({ indexing_status: "not_indexable", indexing_error: result.reason })
          .eq("id", documentId);
        return { status: "stopped" as const };
      }
      if (!result.text.trim()) {
        await admin.from("documents").update({ indexing_status: "needs_text" }).eq("id", documentId);
        return { status: "stopped" as const };
      }
      await admin.from("documents").update({ document_text: result.text }).eq("id", documentId);
      return { status: "ok" as const };
    });

    if (extracted.status !== "ok") return extracted;

    return step.run("embed", async () => {
      const admin = createAdminClient();
      const { data: doc } = await admin
        .from("documents")
        .select("id, corporation_id, title, document_text")
        .eq("id", documentId)
        .single();
      const corpId = doc!.corporation_id as string;
      const ctx = await loadStripContext(admin, corpId);
      const stripped = stripForCorporation(doc!.document_text as string, ctx);
      const title = stripForCorporation(doc!.title ?? "", ctx);

      const docType = await classify(stripped).catch(() => "other");

      const chunks = chunkText(stripped);
      const vectors = await embed(chunks, "document");

      const { data: sub } = await admin.from("subscriptions").select("status").eq("corporation_id", corpId).maybeSingle();
      const subscribed = sub?.status === "active";

      const rows: Record<string, unknown>[] = chunks.map((chunk, i) => ({
        scope: "corporation",
        corporation_id: corpId,
        document_id: documentId,
        title,
        chunk_text: chunk,
        embedding: toVectorLiteral(vectors[i]),
        chunk_index: i,
      }));

      if (subscribed) {
        const globalChunks = chunkText(stripForGlobal(doc!.document_text as string, ctx));
        const globalVectors = await embed(globalChunks, "document");
        rows.push(
          ...globalChunks.map((chunk, i) => ({
            scope: "global_precedent",
            source_corporation_id: corpId,
            document_id: documentId,
            title: docType,
            chunk_text: chunk,
            embedding: toVectorLiteral(globalVectors[i]),
            chunk_index: i,
          }))
        );
      }

      // Re-indexing replaces this document's corporation chunks. Global
      // precedent copies are never deleted (doc02 §0 — no removal from the
      // pool); a re-index of a subscribed document adds a fresh copy.
      await admin.from("knowledge_chunks").delete().eq("document_id", documentId).eq("scope", "corporation");
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await admin.from("knowledge_chunks").insert(rows.slice(i, i + 200));
        if (error) throw new Error(`Saving chunks failed: ${error.message}`);
      }

      await admin
        .from("documents")
        .update({ indexing_status: "indexed", indexing_error: null, indexed_at: new Date().toISOString(), doc_type: docType })
        .eq("id", documentId);
      return { status: "indexed", chunks: chunks.length, global: subscribed };
    });
  }
);

async function classify(strippedText: string) {
  const { docType } = await askClaudeJson<{ docType: string }>({
    effort: "low",
    maxTokens: 4000,
    system: "You classify documents filed by a BC strata corporation. Reply with the single best type.",
    messages: [{ role: "user", content: `Document sample:\n\n${strippedText.slice(0, 2000)}` }],
    schema: {
      type: "object",
      properties: { docType: { type: "string", enum: [...DOC_TYPES] } },
      required: ["docType"],
      additionalProperties: false,
    },
  });
  return (DOC_TYPES as readonly string[]).includes(docType) ? docType : "other";
}

function friendly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("VOYAGE_API_KEY")) return "Indexing isn't set up yet (missing embeddings key).";
  return message.slice(0, 300);
}
