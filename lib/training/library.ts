/**
 * The Knowledge Base as Council Training's source (0037, 0041). Pure,
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

/** The section labels a reference names: "Strata Property Act, s. 37" → ["s. 37"]; "Standard Bylaw 23" → ["Standard Bylaw 23"]. */
export function citationLabels(reference: string): string[] {
  const labels = new Set<string>();
  for (const m of reference.matchAll(/\bs(?:ection|s?\.)?\s*(\d{1,3}(?:\.\d{1,3})?)/gi)) labels.add(`s. ${m[1]}`);
  for (const m of reference.matchAll(/Standard Bylaw\s+(\d{1,3}(?:\.\d{1,3})?)/gi)) labels.add(`Standard Bylaw ${m[1]}`);
  return [...labels];
}

export interface CitableDocument {
  id: string;
  title: string;
  shortName: string | null;
}

const normalized = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * The Knowledge Base entries a reference names, by title ("Strata Property
 * Act, s. 37") or by an abbreviation of three or more capitals ("SPA s. 37").
 * Empty when it names none ("s. 37" alone), so the lookup spans them all.
 */
export function namedDocuments(reference: string, docs: CitableDocument[]): string[] {
  const ref = normalized(reference);
  return docs
    .filter((d) => {
      if (d.title && ref.includes(normalized(d.title))) return true;
      const short = d.shortName?.trim();
      return Boolean(short && /^[A-Z][A-Za-z]{2,}$/.test(short) && new RegExp(`\\b${short}\\b`).test(reference));
    })
    .map((d) => d.id);
}

/** Most-cited first when a bare section number matches several entries. */
const CITATION_ORDER = ["strata property act", "strata property regulation", "real estate services act", "real estate services rules"];

export function byCitationOrder(a: { documentTitle: string; label: string }, b: { documentTitle: string; label: string }): number {
  const rank = (t: string) => {
    const i = CITATION_ORDER.indexOf(t.toLowerCase().trim());
    return i === -1 ? CITATION_ORDER.length : i;
  };
  return rank(a.documentTitle) - rank(b.documentTitle) || a.documentTitle.localeCompare(b.documentTitle) || a.label.localeCompare(b.label);
}
