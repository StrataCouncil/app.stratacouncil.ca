/**
 * The Stratasphere recall check (docs/learn-decide-remember.md §7): did the
 * records that answer a question reach the model, and did the answer use
 * them? Pure, so the tests can run it; the Super Admin actions build the
 * real request (assembleStratasphere) and hand it here.
 *
 * A record counts as reaching the model when:
 *   - a document: its full text was sent (the bylaws, an agenda item's
 *     attachment), or a search passage from it was;
 *   - a decision: its ledger line was sent;
 *   - a phrase: it appears in what was sent, ignoring case, spacing, and
 *     curly quotes. What was sent has had names and personal details
 *     replaced, so phrases shouldn't contain names.
 */

export interface RecallCase {
  expectDocuments: string[];
  expectDecisions: string[];
  expectPhrases: string[];
  answerPhrases: string[];
}

export interface RecallDiagnostics {
  bylawDocumentIds: string[];
  attachmentDocumentIds: string[];
  ledgerDecisionIds: string[];
  hits: Array<{ scope: "corporation" | "global_precedent" | "legislation"; documentId: string | null; title: string | null; similarity: number }>;
  searchFailed: boolean;
}

export type DocumentFinding = { id: string; found: boolean; where: string };
export type DecisionFinding = { id: string; found: boolean };
export type PhraseFinding = { phrase: string; found: boolean };

export interface FindResult {
  passed: boolean;
  documents: DocumentFinding[];
  decisions: DecisionFinding[];
  phrases: PhraseFinding[];
  searchFailed: boolean;
  /** Size of what was sent, in characters. */
  contextChars: number;
  /** The strata's own search results, in order: what search returned, for reading a miss. */
  searchResults: Array<{ rank: number; documentId: string | null; title: string | null; similarity: number }>;
}

export interface AnswerResult {
  passed: boolean;
  phrases: PhraseFinding[];
  /** Expected documents the answer listed as a source. */
  cited: DocumentFinding[];
}

/** Case, spacing, curly quotes, and dashes don't matter when looking for a phrase. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function contains(haystack: string, phrase: string) {
  const p = normalizeText(phrase);
  return p.length > 0 && haystack.includes(p);
}

export function findCheck(c: RecallCase, d: RecallDiagnostics, sentText: string): FindResult {
  const sent = normalizeText(sentText);
  const own = d.hits
    .map((h, i) => ({ ...h, rank: i + 1 }))
    .filter((h) => h.scope === "corporation");
  const bylaws = new Set(d.bylawDocumentIds);
  const attachments = new Set(d.attachmentDocumentIds);
  const ledger = new Set(d.ledgerDecisionIds);

  const documents = c.expectDocuments.map((id): DocumentFinding => {
    if (bylaws.has(id)) return { id, found: true, where: "Full text (bylaws)" };
    if (attachments.has(id)) return { id, found: true, where: "Full text (agenda item attachment)" };
    const ranks = own.filter((h) => h.documentId === id).map((h) => h.rank);
    if (ranks.length) return { id, found: true, where: `Search, ${ranks.length === 1 ? "result" : "results"} ${ranks.join(", ")}` };
    return { id, found: false, where: "Not sent" };
  });
  const decisions = c.expectDecisions.map((id): DecisionFinding => ({ id, found: ledger.has(id) }));
  const phrases = c.expectPhrases.map((phrase): PhraseFinding => ({ phrase, found: contains(sent, phrase) }));

  return {
    passed: !d.searchFailed && [...documents, ...decisions, ...phrases].every((x) => x.found),
    documents,
    decisions,
    phrases,
    searchFailed: d.searchFailed,
    contextChars: sentText.length,
    searchResults: own.map((h) => ({ rank: h.rank, documentId: h.documentId, title: h.title, similarity: Number(h.similarity.toFixed(3)) })),
  };
}

export function answerCheck(
  c: RecallCase,
  answer: string,
  sources: Array<{ kind: string; documentId?: string }>
): AnswerResult {
  const text = normalizeText(answer);
  const phrases = c.answerPhrases.map((phrase): PhraseFinding => ({ phrase, found: contains(text, phrase) }));
  const citedIds = new Set(sources.flatMap((s) => (s.kind === "document" && s.documentId ? [s.documentId] : [])));
  const cited = c.expectDocuments.map((id): DocumentFinding => ({ id, found: citedIds.has(id), where: citedIds.has(id) ? "Cited" : "Not cited" }));
  return { passed: [...phrases, ...cited].every((x) => x.found), phrases, cited };
}

/** Everything the model was sent, as one string: the system blocks, then each message. */
export function sentText(system: Array<{ text: string }>, messages: Array<{ content: unknown }>): string {
  const parts = system.map((b) => b.text);
  for (const m of messages) {
    if (typeof m.content === "string") parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const b of m.content) if (b && typeof b === "object" && "text" in b && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n\n");
}

/** One phrase per line, trimmed, empty lines dropped, at most 20. */
export function phraseLines(v: string): string[] {
  return v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((l) => l.slice(0, 300));
}
