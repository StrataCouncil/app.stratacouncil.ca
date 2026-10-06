/**
 * The Legislation Library as Council Training's source (0037, 0041). Pure,
 * so it can be tested without a database. Library passages are one per Act
 * or Regulation section (or a plain chunk of a guidance document), each
 * opening with its citation, e.g. "Strata Property Act, section 45: Notice
 * of general meetings". Slides cite them by id (lib/training/slides.ts).
 */

export interface LibraryPassage {
  id: string;
  documentId: string;
  documentTitle: string;
  kind: "act" | "regulation" | "guidance";
  /** "s. 45 Notice of general meetings", or the guidance document's title. */
  label: string;
  text: string;
  chunkIndex: number;
  similarity: number;
}

/** One list from several searches: each passage once, at its best match, best first. */
export function mergeHits(lists: LibraryPassage[][]): LibraryPassage[] {
  const best = new Map<string, LibraryPassage>();
  for (const list of lists) {
    for (const p of list) {
      const seen = best.get(p.id);
      if (!seen || p.similarity > seen.similarity) best.set(p.id, p);
    }
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity);
}
