/**
 * Laying out the passages found for a question (lib/ai/stratasphere.ts),
 * so each piece of text reaches the model once:
 *
 *  - Identical text is sent once. A strata often has the same document on
 *    file more than once (the same PDF in two folders); its passages are
 *    then identical, and the copy's title is noted instead ("also filed as").
 *  - Passages from one document go together under one heading, and
 *    neighbouring passages are joined: documents are indexed in pieces that
 *    overlap by about 200 characters (lib/kb/chunk.ts), so two neighbours
 *    found for the same question would otherwise repeat that overlap.
 *
 * Nothing is dropped: every passage found is in the result, in full.
 * Pure, so it's unit-tested directly (tests/passages.test.ts).
 */

export interface PassageHit {
  id: string;
  documentId: string | null;
  title: string | null;
  sourceAct?: string | null;
  text: string;
  similarity: number;
}

export interface PassageGroup {
  documentId: string | null;
  title: string | null;
  sourceAct: string | null;
  /** The best relevance among the group's passages. */
  relevance: number;
  /** Continuous stretches of the document, each made of one or more neighbouring passages. */
  segments: string[];
  passageIds: string[];
  /** Titles of other documents holding identical passages. */
  alsoFiledAs: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * How much of the start of `b` repeats the end of `a` (the indexing
 * overlap), or 0 if `b` doesn't follow on from `a`.
 */
export function overlapLength(a: string, b: string): number {
  const probe = b.slice(0, 40);
  if (probe.length < 20) return 0;
  const tailStart = Math.max(0, a.length - 600);
  let p = a.indexOf(probe, tailStart);
  while (p !== -1) {
    const tail = a.slice(p);
    if (b.startsWith(tail) && tail.length < b.length) return tail.length;
    p = a.indexOf(probe, p + 1);
  }
  return 0;
}

export function arrangePassages(hits: PassageHit[]): { groups: PassageGroup[]; charsSaved: number } {
  const before = hits.reduce((n, h) => n + h.text.length, 0);

  // 1. Identical text once; the copy's title is remembered.
  const firstByText = new Map<string, PassageHit>();
  const copiesOf = new Map<PassageHit, Set<string>>();
  const unique: PassageHit[] = [];
  for (const h of hits) {
    const key = norm(h.text);
    const first = firstByText.get(key);
    if (!first) {
      firstByText.set(key, h);
      unique.push(h);
      continue;
    }
    if (h.documentId !== first.documentId && h.title && h.title !== first.title) {
      if (!copiesOf.has(first)) copiesOf.set(first, new Set());
      copiesOf.get(first)!.add(h.title);
    }
  }

  // 2. One group per document, in the order the documents were first found.
  const order: string[] = [];
  const byDoc = new Map<string, PassageHit[]>();
  for (const h of unique) {
    const key = h.documentId ?? `passage:${h.id}`;
    if (!byDoc.has(key)) {
      byDoc.set(key, []);
      order.push(key);
    }
    byDoc.get(key)!.push(h);
  }

  const groups: PassageGroup[] = order.map((key) => {
    const list = byDoc.get(key)!;
    // 3. Join neighbours: each segment remembers where its first passage was found.
    let segments = list.map((h, i) => ({ text: h.text, rank: i }));
    let joined = true;
    while (joined && segments.length > 1) {
      joined = false;
      outer: for (let i = 0; i < segments.length; i++) {
        for (let j = 0; j < segments.length; j++) {
          if (i === j) continue;
          const k = overlapLength(segments[i].text, segments[j].text);
          if (k > 0) {
            const merged = { text: segments[i].text + segments[j].text.slice(k), rank: Math.min(segments[i].rank, segments[j].rank) };
            segments = segments.filter((_, n) => n !== i && n !== j);
            segments.push(merged);
            joined = true;
            break outer;
          }
        }
      }
    }
    segments.sort((a, b) => a.rank - b.rank);
    const also = new Set<string>();
    for (const h of list) for (const t of copiesOf.get(h) ?? []) also.add(t);
    return {
      documentId: list[0].documentId,
      title: list[0].title,
      sourceAct: list[0].sourceAct ?? null,
      relevance: Math.max(...list.map((h) => h.similarity)),
      segments: segments.map((s) => s.text),
      passageIds: list.map((h) => h.id),
      alsoFiledAs: [...also],
    };
  });

  const after = groups.reduce((n, g) => n + g.segments.reduce((m, s) => m + s.length, 0), 0);
  return { groups, charsSaved: before - after };
}

/** The groups as the model reads them: one heading per document, its stretches separated by [...]. */
export function passagesText(groups: PassageGroup[], prefix = ""): string {
  return groups
    .map((g, i) => {
      const parts = [`${prefix}${i + 1}`];
      if (g.title) parts.push(g.title);
      if (g.sourceAct && g.sourceAct !== g.title) parts.push(g.sourceAct);
      parts.push(`relevance ${g.relevance.toFixed(2)}`);
      if (g.alsoFiledAs.length) parts.push(`identical copy also filed as: ${g.alsoFiledAs.map((t) => `"${t}"`).join(", ")}`);
      return `[${parts.join(" | ")}]\n${g.segments.join("\n[...]\n")}`;
    })
    .join("\n\n");
}
