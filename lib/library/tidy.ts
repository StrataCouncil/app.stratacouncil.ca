import { knowledgeResourceKindLabels } from "../placeholder-data.ts";
import { LIBRARY_KINDS, PASTE_MAX_CHARS, CLAIMS_MAX, normalizeItem, normalizeKind, type PublishedLibraryItem } from "./library.ts";

/**
 * Turning a pasted draft (often from another AI tool) into a Library item
 * (0049): the prompt, the reply's shape, and its normalizing. The AI only
 * reorganizes and cleans up the author's draft; the legal statements it
 * finds come back as claims for staff to check against the Legislation
 * Library.
 */

export const TIDY_SYSTEM = `You prepare playbooks, guides and templates for StrataCouncil.ca's Library, read by volunteer strata council members in British Columbia.

You are given an author's draft, often produced by another AI tool. Turn it into the Library's markup. Rules:

Content
- Keep the author's content, order and meaning. You may tighten wording, fix grammar and use plain Canadian English. Never add facts, steps, numbers, deadlines, legal rules or advice that aren't in the draft.
- Keep it general: it is shared by every strata. Remove any particular strata's names, people, addresses, phone numbers or account details.
- Use "strata manager" (the BC term) rather than "property manager", and "strata lot" where the draft means a unit.
- Remove clutter left by other tools: citation fragments such as "+1" or "Province of British Columbia" on their own line, bare website names, "Copy checklist", counters such as "0 of 16 checked", step numbers on their own line, and empty lines of spacing. Drop "Official references" or source lists made of website names: sources are added separately.
- If the draft has a quick-reference checklist or a short "first steps" list near the end or the start, put one quick-reference box right after the introduction, and merge overlapping short lists (for example "the first five priorities" and "the first 30 minutes") into that one box.

Markup (the only formatting allowed)
- "## Heading" for main sections, "### Subheading" inside them. A timing goes at the end in braces: "## Step 1. Assess the situation {0–5 min}".
- Paragraphs are plain lines, separated by a blank line.
- "- item" for bullets, "1. item" for numbered steps, "[ ] item" for checklist items (a printed checklist, nothing to tick on screen).
- Tables: "| Column | Column |" rows, the first row being the header.
- Boxes, opened by a line ":::tone Optional title" and closed by a line ":::". Tones: summary (the quick-reference box), important, warning (things not to do, hazards), note, sample (a sample notice or message to copy). Boxes don't nest.
- "**bold**" for a short lead-in, sparingly. No links, no images, no emoji, no other Markdown.

Also return
- kind: one of ${LIBRARY_KINDS.map((k) => `${k} (${knowledgeResourceKindLabels[k]})`).join(", ")}. Emergencies (flood, fire, power loss, elevator entrapment) are emergency_playbook; routine "how council handles X" is playbook; explanations are operational_guide; fill-in documents are policy_template.
- title: short, without "BC" or "Playbook" unless needed.
- summary: one sentence, at most 30 words, saying what it helps with.
- tags: 3 to 6 lowercase keywords.
- claims: up to ${CLAIMS_MAX} statements in the content about what a law, regulation, standard bylaw, tribunal or insurance rule requires or allows (for example "an owner must allow emergency entry without notice"). For each, the statement as it appears (shortened if long) and a search query to find the section in BC legislation (for example "emergency entry to strata lot without notice standard bylaw"). Don't list practical advice.`;

export function tidyRequest(text: string) {
  return `The author's draft:\n\n<draft>\n${text.slice(0, PASTE_MAX_CHARS)}\n</draft>`;
}

export const tidySchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "summary", "tags", "markup", "claims"],
  properties: {
    kind: { type: "string", enum: LIBRARY_KINDS },
    title: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    markup: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "query"],
        properties: { statement: { type: "string" }, query: { type: "string" } },
      },
    },
  },
} as const;

export interface TidiedDraft {
  item: PublishedLibraryItem;
  claims: Array<{ statement: string; query: string }>;
}

/** The AI's reply, held to the Library's limits. Sources are never taken from it. */
export function normalizeTidied(raw: unknown): TidiedDraft {
  const o = (raw ?? {}) as Record<string, unknown>;
  const item = normalizeItem({ ...o, kind: normalizeKind(o.kind), sources: [] });
  const claims = (Array.isArray(o.claims) ? o.claims : [])
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const statement = typeof x.statement === "string" ? x.statement.trim().slice(0, 500) : "";
      const query = typeof x.query === "string" ? x.query.trim().slice(0, 300) : "";
      return { statement, query: query || statement.slice(0, 300) };
    })
    .filter((c) => c.statement)
    .slice(0, CLAIMS_MAX);
  return { item, claims };
}
