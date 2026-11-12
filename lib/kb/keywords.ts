/**
 * What to look for word for word in a strata's records (PR 5,
 * docs/learn-decide-remember.md §7, gap 3). Meaning search can miss exact
 * strings, so a question's lot numbers, bylaw numbers, quoted phrases and
 * reference numbers ("INV-20931") are searched as written, and its words by
 * full-text search (keyword_knowledge_chunks, 0095).
 *
 * Pure, so it can be tested. The question is already PII-stripped.
 */

const MAX_EXACT = 12;
const MAX_WORDS = 16;

/** Lot numbers in stored text look like "SL061" (the roster's form), "SL61", or "strata lot 61". */
function lotForms(n: string): string[] {
  const num = String(Number(n));
  const padded = num.padStart(3, "0");
  return [...new Set([`SL${num}`, `SL${padded}`, `SL ${num}`, `strata lot ${num}`])];
}

export function exactStrings(question: string): string[] {
  const out: string[] = [];
  const add = (...s: string[]) => {
    for (const x of s) {
      const t = x.trim().replace(/\s+/g, " ");
      if (t.length >= 2 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  };
  // Quoted phrases, as written.
  for (const m of question.matchAll(/["“]([^"”]{3,100})["”]/g)) add(m[1]);
  // Lot numbers: "SL12", "SL 012", "strata lot 12", "lot 12".
  for (const m of question.matchAll(/\b(?:SL|strata\s+lot|lot)\s*#?\s*-?\s*(\d{1,4})\b/gi)) add(...lotForms(m[1]));
  // Bylaw and section numbers: "bylaw 7.3", "by-law 12(4)", "section 45".
  for (const m of question.matchAll(/\b(by-?laws?|sections?|s\.)\s*(\d{1,3}(?:\.\d{1,3})*(?:\([0-9a-z]{1,3}\))*)/gi)) {
    const n = m[2];
    if (/^s/i.test(m[1])) add(`section ${n}`, `s. ${n}`);
    else add(`bylaw ${n}`, `by-law ${n}`);
  }
  // Reference numbers: letters and digits together ("INV-20931", "PO4471"), not lot numbers.
  for (const m of question.matchAll(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{3,29}\b/g)) {
    if (!/^SL-?\d+$/i.test(m[0])) add(m[0]);
  }
  return out.slice(0, MAX_EXACT);
}

/** The question's words for full-text search (the database drops common words and stems the rest). */
export function searchWords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/["“”]/g, " ")
    .split(/[^a-z0-9'-]+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does the text hold this string as a whole (so "SL12" isn't found inside "SL120")? Ignores case and spacing. */
export function containsWhole(text: string, s: string): boolean {
  const pattern = escapeRegExp(s.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "i").test(text);
}

/**
 * How well a line (one decision in the ledger) matches the question: each
 * exact string found counts 3, each word 1. Used for decisions older than
 * those sent in full.
 */
export function lineScore(line: string, exact: string[], words: string[]): number {
  const lower = line.toLowerCase();
  let score = 0;
  for (const e of exact) if (containsWhole(line, e)) score += 3;
  for (const w of words) if (w.length >= 4 && lower.includes(w)) score += 1;
  return score;
}

/**
 * The strata's passages for one question: those found by meaning, then those
 * found by keyword that meaning missed (every exact match first, then the
 * best by words), then precedent and legislation as they were.
 */
export function mergeHits<T extends { id: string; scope: string; match?: string }>(meaning: T[], keyword: T[]): T[] {
  const seen = new Set(meaning.map((h) => h.id));
  const extra: T[] = [];
  for (const h of keyword) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    extra.push(h);
  }
  extra.sort((a, b) => (a.match === "exact" ? 0 : 1) - (b.match === "exact" ? 0 : 1));
  return [...meaning.filter((h) => h.scope === "corporation"), ...extra, ...meaning.filter((h) => h.scope !== "corporation")];
}
