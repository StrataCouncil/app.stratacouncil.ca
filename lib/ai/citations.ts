import type { StratasphereSource } from "./stratasphere.ts";

/**
 * What each citation tag in a Stratasphere request stands for
 * (lib/ai/stratasphere.ts tags the records; lib/ai/answer-text.ts finds the
 * tags an answer used). The sources under an answer are the records it
 * cited, not everything the search turned up; the recall check shows each
 * one with the passage itself, so a reviewer can check it.
 *
 * Tags: D a document's passages, B bylaws, A an agenda item's attachment,
 * F the record the person is looking at, E a ledger decision, W a decision
 * made between meetings, awaiting ratification, M decisions made so far in
 * this meeting, L a Knowledge Base section, P precedent from other stratas,
 * R the platform records.
 */
export type CitedKind = "document" | "bylaws" | "attachment" | "focus" | "decision" | "between_meetings" | "meeting" | "legislation" | "precedent" | "platform";

export interface CitedRecord {
  tag: string;
  kind: CitedKind;
  /** As members see it (documents by their real title). */
  title: string;
  documentId?: string;
  decisionId?: string;
  /** knowledge_chunks.id, for a Knowledge Base section. */
  chunkId?: string;
  /** The Act or guidance a section belongs to. */
  sourceAct?: string;
  /** The text that was sent (already PII-stripped), for checking. Not for whole bylaws. */
  excerpt?: string;
}

export const KIND_LABELS: Record<CitedKind, string> = {
  document: "Document",
  bylaws: "Bylaws",
  attachment: "Agenda attachment",
  focus: "The record being looked at",
  decision: "Decision ledger",
  between_meetings: "Decision between meetings",
  meeting: "Decisions in this meeting",
  legislation: "Knowledge Base",
  precedent: "Precedent from other stratas",
  platform: "Platform records",
};

/** "s. 6.21", "Form B", "Standard Bylaw 3" from a section title, for grouping by Act. */
function sectionRef(title: string): string | null {
  const m = /^(?:s\. (\S+)|(Form \S+)|(Standard Bylaw \S+))/.exec(title);
  return m ? (m[1] ? `s. ${m[1]}` : (m[2] ?? m[3])) : null;
}

/** The sources under an answer: what it cited, a document once, one entry per Act listing its sections. */
export function sourcesFromCitations(tags: string[], records: Map<string, CitedRecord>): StratasphereSource[] {
  const out: StratasphereSource[] = [];
  const docs = new Set<string>();
  const acts = new Map<string, string[]>();
  let decisions = false;
  let precedent = false;
  for (const tag of tags) {
    const r = records.get(tag);
    if (!r) continue;
    if (r.documentId && (r.kind === "document" || r.kind === "bylaws" || r.kind === "attachment" || r.kind === "focus")) {
      if (!docs.has(r.documentId)) {
        docs.add(r.documentId);
        out.push({ kind: "document", title: r.title, documentId: r.documentId });
      }
    } else if (r.kind === "legislation") {
      const act = r.sourceAct || r.title;
      if (!acts.has(act)) acts.set(act, []);
      const ref = sectionRef(r.title);
      if (ref && !acts.get(act)!.includes(ref)) acts.get(act)!.push(ref);
    } else if (r.kind === "decision" || r.kind === "between_meetings" || r.kind === "meeting") {
      decisions = true;
    } else if (r.kind === "precedent") {
      precedent = true;
    }
  }
  for (const [act, refs] of acts) out.push({ kind: "legislation", title: refs.length ? `${act}, ${refs.join(", ")}` : act });
  if (precedent) out.push({ kind: "precedent" });
  if (decisions) out.push({ kind: "decisions" });
  return out;
}

/**
 * Earlier questions' records, replayed with them, lose their tags: tags are
 * numbered afresh for each question, so an old D1 mustn't be mistaken for
 * this question's D1. Those records are named in words instead.
 */
export function untagContext(context: string): string {
  return context
    .replace(/^\[[DLP]\d+ \| /gm, "[")
    .replace(/^\[A\d+ ATTACHMENT: /gm, "[ATTACHMENT: ")
    .replace(/^[EW]\d+ (?=\[)/gm, "")
    .replace(/ \(cite as [A-Z]\)/g, "");
}
