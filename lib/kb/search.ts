import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toVectorLiteral } from "@/lib/kb/embed";
import { containsWhole, exactStrings, searchWords } from "@/lib/kb/keywords";

/**
 * Semantic search over one corporation's indexed passages (doc02 §3):
 * its own chunks, the global precedent pool, and legislation. Runs through
 * the signed-in user's client so match_knowledge_chunks enforces
 * membership and Stratasphere access itself. The query must already be
 * PII-stripped — it goes to Voyage to be embedded.
 */
export interface KnowledgeHit {
  id: string;
  scope: "corporation" | "global_precedent" | "legislation";
  documentId: string | null;
  title: string | null;
  sourceAct: string | null;
  text: string;
  similarity: number;
  /** How it was found: by meaning (the default), by its words, or as an exact string from the question. */
  match?: "meaning" | "words" | "exact";
}

type Scope = KnowledgeHit["scope"];

/**
 * Three searches with one embedding, each with its own slots, so none can
 * crowd another out of an answer: the strata's own documents (16),
 * cross-platform precedent (4), and legislation (8). Until PR 5 the strata's
 * documents and precedent shared 14 slots, so passages from other stratas
 * could push out the strata's own records.
 */
export async function searchKnowledge(
  supabase: SupabaseClient,
  corpId: string,
  strippedQuery: string,
  { ownCount = 16, precedentCount = 4, legislationCount = 8, threshold = 0.25 } = {}
): Promise<KnowledgeHit[]> {
  const [vector] = await embed([strippedQuery.slice(0, 8000)], "query");
  const literal = toVectorLiteral(vector);
  const run = async (scopes: Scope[], count: number) => {
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      p_corporation_id: corpId,
      p_query_embedding: literal,
      p_match_count: count,
      p_match_threshold: threshold,
      p_scopes: scopes,
    });
    if (error) throw new Error(`Knowledge search failed: ${error.message}`);
    return (data ?? []).map(
      (r: Record<string, unknown>): KnowledgeHit => ({
        id: r.id as string,
        scope: r.scope as Scope,
        documentId: (r.document_id as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        sourceAct: (r.source_act as string | null) ?? null,
        text: r.chunk_text as string,
        similarity: r.similarity as number,
      })
    );
  };
  const [own, precedent, legislation] = await Promise.all([
    run(["corporation"], ownCount),
    precedentCount > 0 ? run(["global_precedent"], precedentCount) : Promise.resolve([] as KnowledgeHit[]),
    run(["legislation"], legislationCount),
  ]);
  return [...own, ...precedent, ...legislation];
}

/**
 * The strata's own passages that hold the question's exact strings (lot and
 * bylaw numbers, quoted phrases, reference numbers) or its words
 * (keyword_knowledge_chunks, 0095), to sit alongside the meaning search.
 * Every passage with an exact string, as a whole word, is kept; the best
 * `wordCount` by words. Through the person's own client: the function
 * checks their Stratasphere access.
 */
export async function searchKeywords(
  supabase: SupabaseClient,
  corpId: string,
  strippedQuery: string,
  { wordCount = 6 } = {}
): Promise<KnowledgeHit[]> {
  const exact = exactStrings(strippedQuery);
  const words = searchWords(strippedQuery);
  if (!exact.length && !words.length) return [];
  const { data, error } = await supabase.rpc("keyword_knowledge_chunks", {
    p_corporation_id: corpId,
    p_terms: words,
    p_exact: exact,
    p_count: wordCount,
  });
  if (error) throw new Error(`Keyword search failed: ${error.message}`);
  const hits: KnowledgeHit[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const text = r.chunk_text as string;
    const isExact = Boolean(r.exact);
    // The database matches inside words ("SL12" in "SL120"); keep whole ones only.
    if (isExact && !exact.some((e) => containsWhole(text, e))) continue;
    hits.push({
      id: r.id as string,
      scope: "corporation",
      documentId: (r.document_id as string | null) ?? null,
      title: (r.title as string | null) ?? null,
      sourceAct: null,
      text,
      similarity: isExact ? 1 : Math.min(Number(r.rank) || 0, 1),
      match: isExact ? "exact" : "words",
    });
  }
  return hits;
}
