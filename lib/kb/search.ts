import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toVectorLiteral } from "@/lib/kb/embed";

/**
 * Semantic search over the knowledge base for one corporation (doc02 §3):
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
}

type Scope = KnowledgeHit["scope"];

/**
 * Two searches with one embedding: the strata's own documents and
 * cross-platform precedent share one set of slots, legislation has its own,
 * so neither can crowd the other out of an answer.
 */
export async function searchKnowledge(
  supabase: SupabaseClient,
  corpId: string,
  strippedQuery: string,
  { matchCount = 12, legislationCount = 8, threshold = 0.35 } = {}
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
  const [records, legislation] = await Promise.all([
    run(["corporation", "global_precedent"], matchCount),
    run(["legislation"], legislationCount),
  ]);
  return [...records, ...legislation];
}
