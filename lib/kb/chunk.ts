/**
 * Split text into overlapping chunks for embedding (doc04 §5): about
 * 1500–2000 characters each, 200 characters of overlap, broken at
 * paragraph, then sentence, then word boundaries where possible.
 */
const TARGET = 1800;
const MAX = 2000;
const MIN = 1500;
const OVERLAP = 200;

export function chunkText(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= MAX) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + TARGET, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start + MIN, Math.min(start + MAX, clean.length));
      const breakAt =
        lastMatch(window, /\n\n/g) ?? lastMatch(window, /[.!?]["')\]]?\s/g) ?? lastMatch(window, /\s/g);
      end = breakAt !== null ? start + MIN + breakAt : Math.min(start + MAX, clean.length);
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // Step back for overlap, to a word boundary.
    let next = end - OVERLAP;
    const space = clean.indexOf(" ", next);
    if (space !== -1 && space < end) next = space + 1;
    start = Math.max(next, start + 1);
  }
  return chunks;
}

function lastMatch(s: string, re: RegExp): number | null {
  let last: number | null = null;
  for (const m of s.matchAll(re)) last = m.index! + m[0].length;
  return last;
}
