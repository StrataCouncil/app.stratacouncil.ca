/**
 * The Legislation Library as Council Training's source (0037). Pure, so it
 * can be tested without a database: merging search hits, turning chosen
 * passages into source documents for the AI, the text of a screen to fact
 * check, and the fact check's shape.
 *
 * Library passages are one per Act or Regulation section (or a plain chunk
 * of a guidance document), each opening with its citation, e.g.
 * "Strata Property Act, section 45: Notice of general meetings".
 */
import { docText, type ModuleContent, type Screen } from "./content.ts";
import { docToMarkdown } from "./ai.ts";

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

const KIND_ORDER = { act: 0, regulation: 1, guidance: 2 } as const;

/**
 * Chosen passages as source documents: one per library document, Acts
 * first, passages in the document's own order.
 */
export function passagesAsSources(passages: LibraryPassage[]): string {
  const byDoc = new Map<string, LibraryPassage[]>();
  for (const p of passages) byDoc.set(p.documentId, [...(byDoc.get(p.documentId) ?? []), p]);
  return [...byDoc.values()]
    .sort((a, b) => KIND_ORDER[a[0].kind] - KIND_ORDER[b[0].kind] || a[0].documentTitle.localeCompare(b[0].documentTitle))
    .map((list) => {
      const doc = list[0];
      const body = [...list]
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((p) => p.text)
        .join("\n\n");
      const what = doc.kind === "guidance" ? "selected passages" : "selected sections";
      return `<source_document title="${doc.documentTitle.replace(/"/g, "'")} (${what})" kind="${doc.kind}">\n${body}\n</source_document>`;
    })
    .join("\n\n");
}

/** Searches for a module: its title and scope, then each objective. */
export function moduleQueries(m: { title: string; summary: string; objectives: string[] }): string[] {
  return [[m.title, m.summary].filter(Boolean).join(". "), ...m.objectives].map((q) => q.trim()).filter(Boolean).slice(0, 10);
}

// ── Fact checking ──────────────────────────────────────────────────────

/** Everything a learner reads or hears on a screen, as plain text, with references. */
export function screenFactText(screen: Screen): string {
  const lines: string[] = [`Screen "${screen.title}"`];
  for (const b of screen.blocks) {
    switch (b.type) {
      case "text":
        lines.push(docToMarkdown(b.doc));
        break;
      case "callout":
        lines.push(`Callout: ${b.title} ${docToMarkdown(b.doc)}${b.reference ? ` [Reference: ${b.reference}]` : ""}`);
        break;
      case "reveal":
        b.items.forEach((i) => lines.push(`${i.title}: ${i.body}`));
        break;
      case "summary":
        lines.push([b.title, ...b.points.map((p) => `- ${p.text}`)].join("\n"));
        break;
      case "checklist":
        lines.push([b.title, ...b.items.map((i) => `- ${i.text}`)].join("\n"));
        break;
      case "features":
        b.items.forEach((i) => lines.push(`${i.title}: ${i.text}`));
        break;
      case "table":
        lines.push(b.rows.map((r) => r.join(" | ")).join("\n"));
        break;
      case "knowledge_check": {
        const correct = b.options.find((o) => o.id === b.correctId);
        lines.push(
          `Question: ${b.question}`,
          ...b.options.map((o) => `Option${o.id === b.correctId ? " (correct)" : ""}: ${o.text}${o.feedback ? ` - ${o.feedback}` : ""}`),
          b.explanation ? `Explanation: ${b.explanation}` : "",
          b.studyTip ? `Study note: ${b.studyTip}` : "",
          b.reference ? `[Reference: ${b.reference}]` : "",
          correct ? "" : "(no correct answer marked)"
        );
        break;
      }
      case "scenario":
        lines.push(
          `Scenario: ${docText(b.situation).trim()} ${b.prompt}`,
          ...b.choices.map((c) => `Choice (${c.rating}): ${c.text} - ${c.outcome}`)
        );
        break;
      case "audio":
      case "video":
        if (b.transcript) lines.push(`Transcript: ${b.transcript}`);
        break;
      case "slides":
        b.slides.forEach((s) => s.transcript && lines.push(`Slide narration: ${s.transcript}`));
        break;
    }
  }
  if (screen.narration.transcript.trim()) lines.push(`Narration: ${screen.narration.transcript.trim()}`);
  return lines.filter((l) => l.trim()).join("\n");
}

/** Screens worth checking (anything with words on it). */
export function checkableScreens(content: ModuleContent) {
  return content.sections.map((s) => ({ section: s, screens: s.screens.filter((sc) => screenFactText(sc).split("\n").length > 1) }));
}

export type FactIssueKind = "contradicted" | "unsupported" | "wrong_reference";

export interface FactIssue {
  screenId: string;
  quote: string;
  kind: FactIssueKind;
  note: string;
  /** What the library says, with its citation, when it says something. */
  library: string;
  /** The author looked into it and is satisfied (it stays listed, set aside). */
  checkedByHand?: boolean;
}

export interface FactCheck {
  status: "checking" | "done" | "failed";
  /** When the check started. */
  checkedAt: string;
  /** The draft's updated_at that was checked: a later edit makes the check out of date. */
  draftUpdatedAt: string | null;
  sectionsDone: number;
  sectionsTotal: number;
  issues: FactIssue[];
  error?: string;
}

export const FACT_CHECK_INSTRUCTIONS = `Fact-check one section of a Council Training module for volunteer strata council members in British Columbia, against the library passages given above (the Strata Property Act, the Strata Property Regulation and other law and guidance, each with its citation).

For every screen below, check each statement of fact: numbers, deadlines, vote thresholds, who can do what, what the law requires or allows, and every reference ("Strata Property Act, s. 45").

For knowledge checks, also check the answers: report as "contradicted" a correct answer the passages don't support, or a wrong option that the passages show is also right (the question must have exactly one right answer).

Report only real problems:
- "contradicted": the passages say something different. Quote what they say, with the citation, in "library".
- "wrong_reference": the statement is right but the reference points to the wrong section, or the cited section doesn't say it. Give the right citation in "library" if a passage has it.
- "unsupported": a specific fact, number or deadline that none of the passages covers, so it can't be confirmed here. Leave "library" empty.

Don't report:
- general advice, explanations, examples and scenarios that are reasonable and don't state a rule;
- simplifications that stay true (e.g. leaving out an exception that doesn't matter to a volunteer);
- wording or style.

"quote" is the exact words from the screen (a short phrase). "note" says in one plain sentence what's wrong and what it should say. Use the screen's id exactly as given. If everything checks out, return no issues.`;

export const factCheckSchema = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screenId", "quote", "kind", "note", "library"],
        properties: {
          screenId: { type: "string" },
          quote: { type: "string" },
          kind: { type: "string", enum: ["contradicted", "unsupported", "wrong_reference"] },
          note: { type: "string" },
          library: { type: "string" },
        },
      },
    },
  },
} as const;

/** Keep only well-formed issues on screens that exist. */
export function normalizeIssues(raw: unknown, screenIds: Set<string>): FactIssue[] {
  const list = (raw as { issues?: unknown })?.issues;
  return (Array.isArray(list) ? list : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .filter((x) => typeof x.screenId === "string" && screenIds.has(x.screenId))
    .map(
      (x): FactIssue => ({
        screenId: x.screenId as string,
        quote: String(x.quote ?? "").slice(0, 300),
        kind: x.kind === "contradicted" || x.kind === "wrong_reference" ? x.kind : "unsupported",
        note: String(x.note ?? "").slice(0, 600),
        library: String(x.library ?? "").slice(0, 1200),
        ...(x.checkedByHand === true ? { checkedByHand: true } : {}),
      })
    )
    .filter((x) => x.note.trim())
    .slice(0, 60);
}

export function normalizeFactCheck(raw: unknown): FactCheck | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.status !== "checking" && r.status !== "done" && r.status !== "failed") return null;
  const issues = Array.isArray(r.issues) ? normalizeIssues({ issues: r.issues }, new Set((r.issues as { screenId?: string }[]).map((i) => String(i?.screenId)))) : [];
  return {
    status: r.status,
    checkedAt: String(r.checkedAt ?? ""),
    draftUpdatedAt: typeof r.draftUpdatedAt === "string" ? r.draftUpdatedAt : null,
    sectionsDone: Number(r.sectionsDone) || 0,
    sectionsTotal: Number(r.sectionsTotal) || 0,
    issues,
    ...(typeof r.error === "string" ? { error: r.error } : {}),
  };
}
