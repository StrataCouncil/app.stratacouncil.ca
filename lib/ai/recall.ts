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
 *     replaced, so phrases shouldn't contain names;
 *   - a Knowledge Base entry: a passage from it was sent; a section: that
 *     section's passage was.
 *
 * The answer is checked for the case's key figures (lib/ai/figures.ts) and
 * phrases. Which documents it cited is shown, for diagnosis, but doesn't
 * decide anything: a person marks each answer Right, Partly, or Wrong.
 */
import { figureFound } from "./figures.ts";

export interface RecallCase {
  expectDocuments: string[];
  expectDecisions: string[];
  expectPhrases: string[];
  answerPhrases: string[];
  /** Figures the answer must state (matched by value). */
  keyFigures?: string[];
  /** Knowledge Base entries (legislation_documents) a passage should come from. */
  expectLegislationDocuments?: string[];
  /** Knowledge Base sections (knowledge_chunks) that should be sent. */
  expectLegislationSections?: string[];
}

export interface RecallDiagnostics {
  bylawDocumentIds: string[];
  attachmentDocumentIds: string[];
  ledgerDecisionIds: string[];
  hits: Array<{ id?: string; scope: "corporation" | "global_precedent" | "legislation"; documentId: string | null; title: string | null; similarity: number }>;
  searchFailed: boolean;
  /** Characters sent, by part (ContextSizes in lib/ai/stratasphere.ts). */
  sizes?: object;
}

export type DocumentFinding = { id: string; found: boolean; where: string };
export type DecisionFinding = { id: string; found: boolean };
export type PhraseFinding = { phrase: string; found: boolean };
export type KnowledgeFinding = { id: string; kind: "entry" | "section"; found: boolean; where: string };
export type FigureFinding = { figure: string; found: boolean };

export interface FindResult {
  passed: boolean;
  documents: DocumentFinding[];
  decisions: DecisionFinding[];
  phrases: PhraseFinding[];
  knowledge: KnowledgeFinding[];
  /** False when the case names nothing to look for (it checks only the answer). */
  checked: boolean;
  searchFailed: boolean;
  /** Size of what was sent, in characters. */
  contextChars: number;
  /** Characters by part (rules, bylaws, ledger, passages, ...). */
  sizes?: object;
  /** The Knowledge Base sections sent, in order. */
  legislationResults?: Array<{ rank: number; id: string | null; title: string | null; similarity: number }>;
  /** The strata's own search results, in order: what search returned, for reading a miss. */
  searchResults: Array<{ rank: number; documentId: string | null; title: string | null; similarity: number }>;
}

export interface AnswerResult {
  /** Every key figure and phrase stated (true when there are none: then only a person's marking says). */
  passed: boolean;
  /** How many figures and phrases were checked. */
  checked: number;
  figures: FigureFinding[];
  phrases: PhraseFinding[];
  /** Expected documents the answer listed as a source: for diagnosis only. */
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

/**
 * `entryOf` maps each Knowledge Base passage sent (knowledge_chunks.id) to
 * its entry (legislation_documents.id); the caller looks them up.
 */
export function findCheck(c: RecallCase, d: RecallDiagnostics, sentText: string, entryOf: Map<string, string> = new Map()): FindResult {
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
  const law = d.hits.filter((h) => h.scope === "legislation").map((h, i) => ({ ...h, rank: i + 1 }));
  const knowledge: KnowledgeFinding[] = [
    ...(c.expectLegislationDocuments ?? []).map((id): KnowledgeFinding => {
      const ranks = law.filter((h) => h.id && entryOf.get(h.id) === id).map((h) => h.rank);
      return { id, kind: "entry", found: ranks.length > 0, where: ranks.length ? `Sections sent: ${ranks.join(", ")}` : "Not sent" };
    }),
    ...(c.expectLegislationSections ?? []).map((id): KnowledgeFinding => {
      const hit = law.find((h) => h.id === id);
      return { id, kind: "section", found: Boolean(hit), where: hit ? `Sent, result ${hit.rank}` : "Not sent" };
    }),
  ];
  const all = [...documents, ...decisions, ...phrases, ...knowledge];

  return {
    passed: !d.searchFailed && all.every((x) => x.found),
    documents,
    decisions,
    phrases,
    knowledge,
    checked: all.length > 0,
    searchFailed: d.searchFailed,
    contextChars: sentText.length,
    sizes: d.sizes,
    searchResults: own.map((h) => ({ rank: h.rank, documentId: h.documentId, title: h.title, similarity: Number(h.similarity.toFixed(3)) })),
    legislationResults: law.map((h) => ({ rank: h.rank, id: h.id ?? null, title: h.title, similarity: Number(h.similarity.toFixed(3)) })),
  };
}

export function answerCheck(
  c: RecallCase,
  answer: string,
  sources: Array<{ kind: string; documentId?: string }>
): AnswerResult {
  const text = normalizeText(answer);
  const figures = (c.keyFigures ?? []).map((figure): FigureFinding => ({ figure, found: figureFound(answer, figure) }));
  const phrases = c.answerPhrases.map((phrase): PhraseFinding => ({ phrase, found: contains(text, phrase) }));
  const citedIds = new Set(sources.flatMap((s) => (s.kind === "document" && s.documentId ? [s.documentId] : [])));
  const cited = c.expectDocuments.map((id): DocumentFinding => ({ id, found: citedIds.has(id), where: citedIds.has(id) ? "Cited" : "Not cited" }));
  const checks = [...figures, ...phrases];
  return { passed: checks.every((x) => x.found), checked: checks.length, figures, phrases, cited };
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
