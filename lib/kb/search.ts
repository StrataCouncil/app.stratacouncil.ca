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

export async function searchKnowledge(
  supabase: SupabaseClient,
  corpId: string,
  strippedQuery: string,
  { matchCount = 12, threshold = 0.35 } = {}
): Promise<KnowledgeHit[]> {
  const [vector] = await embed([strippedQuery.slice(0, 8000)], "query");
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    p_corporation_id: corpId,
    p_query_embedding: toVectorLiteral(vector),
    p_match_count: matchCount,
    p_match_threshold: threshold,
  });
  if (error) throw new Error(`Knowledge search failed: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    scope: r.scope as KnowledgeHit["scope"],
    documentId: (r.document_id as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    sourceAct: (r.source_act as string | null) ?? null,
    text: r.chunk_text as string,
    similarity: r.similarity as number,
  }));
}
