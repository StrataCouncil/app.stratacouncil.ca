/**
 * Voyage AI embeddings (voyage-3, 1024 dimensions — doc02 §1). Callers
 * pass PII-stripped text only.
 */
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const BATCH = 64;

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set.");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: batch, model: MODEL, input_type: inputType }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) throw new Error("Voyage returned the wrong number of embeddings.");
    out.push(...ordered.map((d) => d.embedding));
  }
  return out;
}

/** pgvector's text form. */
export function toVectorLiteral(v: number[]) {
  return `[${v.join(",")}]`;
}
