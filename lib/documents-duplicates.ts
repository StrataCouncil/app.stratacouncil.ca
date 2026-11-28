/**
 * Copies of the same document in a strata's Documents (0103): the same
 * file (content_sha256) or the same text (text_fingerprint, for a
 * re-export or re-scan). Pure, so it can be tested; the server action in
 * app/strata/[corpId]/documents/actions.ts reads the rows.
 */

export interface DuplicateCandidate {
  id: string;
  title: string;
  category: string | null;
  sourceType: string;
  uploadedAt: string;
  sha256: string | null;
  textFingerprint: string | null;
  /** How many agenda items attach it. */
  uses: number;
}

export interface DuplicateGroup {
  /** The copy to keep unless someone chooses another. */
  keepId: string;
  /** Oldest first. */
  copies: DuplicateCandidate[];
  /** Same file (every copy identical) or only the same text. */
  match: "file" | "text";
}

/** Part of the strata's records: never removed as a duplicate (merge_duplicate_document refuses). */
export function isRecord(d: Pick<DuplicateCandidate, "sourceType">): boolean {
  return d.sourceType === "minutes" || d.sourceType === "historic_minutes" || d.sourceType === "strata_plan";
}

/** Which copy to keep: a record if there is one, then one in a folder, then the most attached, then the oldest. */
export function suggestedKeep(copies: DuplicateCandidate[]): DuplicateCandidate {
  return [...copies].sort(
    (a, b) =>
      Number(isRecord(b)) - Number(isRecord(a)) ||
      Number(Boolean(b.category)) - Number(Boolean(a.category)) ||
      b.uses - a.uses ||
      a.uploadedAt.localeCompare(b.uploadedAt)
  )[0];
}

/**
 * Groups documents that share a file or a text fingerprint, transitively
 * (A has B's file, B has C's text: all three are one group). Only groups
 * of two or more come back, largest first.
 */
export function groupDuplicates(docs: DuplicateCandidate[]): DuplicateGroup[] {
  const parent = new Map<string, string>(docs.map((d) => [d.id, d.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const firstWith = new Map<string, string>();
  for (const d of docs) {
    for (const key of [d.sha256 && `f:${d.sha256}`, d.textFingerprint && `t:${d.textFingerprint}`]) {
      if (!key) continue;
      const seen = firstWith.get(key);
      if (seen) union(seen, d.id);
      else firstWith.set(key, d.id);
    }
  }
  const byRoot = new Map<string, DuplicateCandidate[]>();
  for (const d of docs) {
    const root = find(d.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), d]);
  }
  return [...byRoot.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const copies = [...g].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
      const sameFile = copies.every((c) => c.sha256 && c.sha256 === copies[0].sha256);
      return { keepId: suggestedKeep(copies).id, copies, match: sameFile ? ("file" as const) : ("text" as const) };
    })
    .sort((a, b) => b.copies.length - a.copies.length || a.copies[0].title.localeCompare(b.copies[0].title));
}

/**
 * The copies to remove when keeping `keepId`: every other copy that isn't
 * a record, and only copies that match the kept one directly (the same
 * file or the same text), because that's what the merge accepts.
 */
export function copiesToRemove(group: DuplicateGroup, keepId: string): DuplicateCandidate[] {
  const keep = group.copies.find((c) => c.id === keepId);
  if (!keep) return [];
  return group.copies.filter(
    (c) =>
      c.id !== keepId &&
      !isRecord(c) &&
      ((c.sha256 && c.sha256 === keep.sha256) || (c.textFingerprint && c.textFingerprint === keep.textFingerprint))
  );
}
