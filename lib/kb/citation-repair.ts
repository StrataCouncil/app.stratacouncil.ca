/**
 * Repairing citations to Knowledge Base passages that no longer exist
 * (doc02 §3). A citation is stored as { chunkId, label }, where the label
 * is "<entry title>, <section title>" ("Strata Property Act, s. 45 Notice
 * requirements...") or just the entry title for guidance. When a passage is
 * gone (its entry was deleted, or re-indexing renumbered it), the label
 * still says what was cited.
 *
 * Pure: no database. The rules are deliberately strict, so nothing is
 * guessed:
 *   - re-linked automatically only when the label names a section ("s. 45",
 *     "Standard Bylaw 20", "Form B") of an entry that is in the library, and
 *     that section exists there;
 *   - everything else goes to a Super Admin to choose a section or remove
 *     it, with the entry to look in when one is known.
 */

export interface LibraryDoc {
  id: string;
  title: string;
}

export interface LibraryChunk {
  id: string;
  title: string | null;
  legislationDocumentId: string;
  chunkIndex: number;
}

export interface ParsedLabel {
  /** The entry the label names, as written in the label. */
  document: string;
  /** "s. 45", "Standard Bylaw 20", "Form B", or null when the label names a whole entry. */
  ref: string | null;
}

const REF = /^(.*?),\s+((?:s\.|Standard Bylaw|Form)\s+[0-9A-Z]+(?:\.[0-9]+)?)(?=\s|$)/;

export function parseCitationLabel(label: string): ParsedLabel {
  const clean = label.replace(/\s+/g, " ").trim();
  const m = REF.exec(clean);
  if (m) return { document: m[1].trim(), ref: m[2] };
  return { document: clean.replace(/,.*$/, "").trim(), ref: null };
}

export function normTitle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Entries that were deleted, and the entry a replacement should be looked
 * for in. Only the Standard Bylaws are the same law in a new place; the
 * others are different laws, so a replacement is never automatic for them.
 */
const SUCCESSORS: Record<string, { title: string; sameLaw: boolean }> = {
  "bc strata property standard bylaws": { title: "strata property act", sameLaw: true },
  "standard bylaws": { title: "strata property act", sameLaw: true },
  "canadian human rights act": { title: "human rights code", sameLaw: false },
  "personal information protection and electronic documents act": { title: "personal information protection act", sameLaw: false },
  "freedom of information and protection of privacy act": { title: "personal information protection act", sameLaw: false },
};

export type Repair =
  | { kind: "relink"; chunkId: string; label: string }
  | { kind: "review"; lookIn: string | null; reason: string };

/** The section a ref names in an entry: its first passage, or null. "s. 45" never matches "s. 450". */
export function findSection(ref: string, chunks: LibraryChunk[]): LibraryChunk | null {
  const hits = chunks.filter((c) => {
    const t = (c.title ?? "").trim();
    return t === ref || t.startsWith(`${ref} `);
  });
  hits.sort((a, b) => a.chunkIndex - b.chunkIndex);
  return hits[0] ?? null;
}

export function labelFor(documentTitle: string, chunkTitle: string | null) {
  const t = (chunkTitle ?? "").trim();
  return t && t !== documentTitle ? `${documentTitle}, ${t}` : documentTitle;
}

/** What to do with one citation whose passage is gone. */
export function planRepair(label: string, docs: LibraryDoc[], chunksByDoc: Map<string, LibraryChunk[]>): Repair {
  const parsed = parseCitationLabel(label);
  const byTitle = new Map(docs.map((d) => [normTitle(d.title), d]));
  const named = byTitle.get(normTitle(parsed.document));
  const successor = SUCCESSORS[normTitle(parsed.document)];
  const target = named ?? (successor ? byTitle.get(successor.title) : undefined);

  if (!target) return { kind: "review", lookIn: null, reason: `"${parsed.document}" is no longer in the Knowledge Base.` };
  if (!named && successor && !successor.sameLaw) {
    return { kind: "review", lookIn: target.id, reason: `"${parsed.document}" was removed; ${target.title} is a different law, so choose a section or remove the citation.` };
  }
  if (!parsed.ref) {
    return { kind: "review", lookIn: target.id, reason: `The citation names "${parsed.document}" without a section; choose the section it relies on.` };
  }
  const section = findSection(parsed.ref, chunksByDoc.get(target.id) ?? []);
  if (!section) return { kind: "review", lookIn: target.id, reason: `${target.title} has no ${parsed.ref} now.` };
  return { kind: "relink", chunkId: section.id, label: labelFor(target.title, section.title) };
}
