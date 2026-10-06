import { createAdminClient } from "@/lib/supabase/admin";
import { embed, toVectorLiteral } from "@/lib/kb/embed";
import { mergeHits, type LibraryPassage } from "@/lib/training/library";

/**
 * Searching the Legislation Library for Council Training (0037). Server
 * only, with the service role: the search function isn't open to learners
 * or councils. Queries are the module's own title and objectives (no
 * personal information) and go to Voyage to be embedded.
 */

type Row = { id: string; legislation_document_id: string; title: string | null; chunk_text: string; chunk_index: number; similarity: number };

async function withDocuments(rows: Row[]): Promise<LibraryPassage[]> {
  const ids = [...new Set(rows.map((r) => r.legislation_document_id))];
  if (!ids.length) return [];
  const { data: docs } = await createAdminClient().from("legislation_documents").select("id, title, kind").in("id", ids);
  const docBy = new Map((docs ?? []).map((d) => [d.id as string, d]));
  return rows.flatMap((r) => {
    const d = docBy.get(r.legislation_document_id);
    if (!d) return [];
    return [
      {
        id: r.id,
        documentId: r.legislation_document_id,
        documentTitle: d.title as string,
        kind: (d.kind as LibraryPassage["kind"]) ?? "guidance",
        label: r.title || (d.title as string),
        text: r.chunk_text,
        chunkIndex: r.chunk_index,
        similarity: r.similarity,
      },
    ];
  });
}

/** The library passages that best match these questions, each once, best first. */
export async function searchLibrary(queries: string[], { perQuery = 10, threshold = 0.3, limit = 40 } = {}): Promise<LibraryPassage[]> {
  const clean = queries.map((q) => q.trim().slice(0, 4000)).filter(Boolean);
  if (!clean.length) return [];
  const vectors = await embed(clean, "query");
  const admin = createAdminClient();
  const lists = await Promise.all(
    vectors.map(async (v) => {
      const { data, error } = await admin.rpc("match_library_for_training", {
        p_query_embedding: toVectorLiteral(v),
        p_match_count: perQuery,
        p_match_threshold: threshold,
      });
      if (error) throw new Error(`Library search failed: ${error.message}`);
      return withDocuments((data ?? []) as Row[]);
    })
  );
  return mergeHits(lists).slice(0, limit);
}

/** Chosen passages by id (for a build), in no particular order. */
export async function loadPassages(ids: string[]): Promise<LibraryPassage[]> {
  if (!ids.length) return [];
  const { data, error } = await createAdminClient()
    .from("knowledge_chunks")
    .select("id, legislation_document_id, title, chunk_text, chunk_index")
    .in("id", ids.slice(0, 200))
    .eq("scope", "legislation");
  if (error) throw new Error(`Couldn't read the library passages: ${error.message}`);
  return withDocuments((data ?? []).map((r) => ({ ...(r as Omit<Row, "similarity">), similarity: 1 })));
}

/**
 * The passages a reference names ("Strata Property Act, s. 45",
 * "Standard Bylaw 23"), looked up by their labels rather than by meaning.
 */
export async function passagesForCitations(references: string[]): Promise<LibraryPassage[]> {
  const labels = new Set<string>();
  for (const ref of references) {
    for (const m of ref.matchAll(/\bs(?:ection|s?\.)?\s*(\d{1,3}(?:\.\d{1,3})?)/gi)) labels.add(`s. ${m[1]}`);
    for (const m of ref.matchAll(/Standard Bylaw\s+(\d{1,3}(?:\.\d{1,3})?)/gi)) labels.add(`Standard Bylaw ${m[1]}`);
  }
  if (!labels.size) return [];
  const admin = createAdminClient();
  const columns = "id, legislation_document_id, title, chunk_text, chunk_index";
  const rows = (
    await Promise.all(
      [...labels].slice(0, 30).map(async (label) => {
        // "s. 45" alone, or "s. 45 Notice of general meetings" (never "s. 450").
        const [exact, headed] = await Promise.all([
          admin.from("knowledge_chunks").select(columns).eq("scope", "legislation").eq("title", label).limit(4),
          admin.from("knowledge_chunks").select(columns).eq("scope", "legislation").like("title", `${label} %`).limit(4),
        ]);
        for (const r of [exact, headed]) if (r.error) console.error("[passagesForCitations]", label, r.error.message);
        return [...(exact.data ?? []), ...(headed.data ?? [])];
      })
    )
  ).flat();
  return withDocuments(rows.map((r) => ({ ...(r as Omit<Row, "similarity">), similarity: 1 })));
}
