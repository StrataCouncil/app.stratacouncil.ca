/**
 * Drafting slides with AI (step 2 of the rebuild). Pure, so it can be
 * tested without a database or the API: the instructions, the reply
 * shapes, the names used in examples, and the checks applied to every
 * reply before anything is saved.
 *
 * Two steps, both started by the author with the module checked out:
 * 1. An outline: topics and slide titles, from the module's objectives
 *    and the Legislation Library sections the author approved.
 * 2. Slides, written one at a time from the outline and added after the
 *    module's existing slides. Nothing existing is ever changed.
 *
 * Only course text goes to the AI: the module's title, objectives and
 * library passages. No one's personal information.
 */
import type { LibraryPassage } from "./library.ts";
import {
  bloomLabels,
  ACTIVITIES,
  BLOOM_LEVELS,
  OBJECTIVES_MAX,
  normalizeBlueprint,
  normalizeFurtherReading,
  normalizeObjectives,
  type BlueprintStep,
  type Bloom,
  countWords,
  ITEM_WORDS_MAX,
  newId,
  SLIDE_WORDS_MAX,
  type FurtherReading,
  type Objective,
  type SlideElement,
} from "./slides.ts";

// ── Sources ────────────────────────────────────────────────────────────

/** Passages as numbered sources ("P1", "P2", …): short ids the AI can't garble. */
export function numberSources(passages: LibraryPassage[]) {
  const ids = new Map<string, string>();
  passages.forEach((p, i) => ids.set(`P${i + 1}`, p.id));
  const text = passages
    .map((p, i) => `<source id="P${i + 1}" document="${p.documentTitle.replace(/"/g, "'")}" section="${p.label.replace(/"/g, "'")}">\n${p.text}\n</source>`)
    .join("\n\n");
  return { ids, text };
}

// ── Names in examples ──────────────────────────────────────────────────

/** First names for people in examples: varied, so no one name turns up everywhere. */
export const EXAMPLE_NAMES = [
  "Maria", "Daniel", "Wei", "Aisha", "Gurpreet", "Tom", "Hannah", "Mateo", "Sophie", "Jamal",
  "Mei", "Raj", "Olivia", "Sam", "Fatima", "Liam", "Noor", "Grace", "Ahmed", "Emma",
  "Kenji", "Isabel", "Harpreet", "David", "Leila", "Joseph", "Ana", "Arjun", "Claire", "Min-jun",
  "Erin", "Tariq", "Yuki", "Rosa", "Ben", "Amara", "Luca", "Sunita", "Nathan", "Mariam",
  "Diego", "Zoe", "Hiroshi", "Elena", "Kwame", "Paul", "Linh", "Marcus", "Ingrid", "Priya",
  "Omar", "Chloe", "Sandeep", "Lucy", "Andre", "Hana", "Victor", "Nadia", "Ray", "Esther",
];

/**
 * Names for each slide: two per slide, none repeated within the module
 * (until the list runs out), in a different order for each module.
 */
export function namesForSlides(count: number, seed: string): string[][] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const pool = [...EXAMPLE_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Array.from({ length: count }, (_, i) => [pool[(2 * i) % pool.length], pool[(2 * i + 1) % pool.length]]);
}

/** Names from the list a slide uses that it wasn't given. */
export function strayNames(text: string, allowed: string[]): string[] {
  return EXAMPLE_NAMES.filter((n) => !allowed.includes(n) && new RegExp(`\\b${n.replace("-", "\\-")}\\b`).test(text));
}

// ── Instructions ───────────────────────────────────────────────────────

export const WRITER_SYSTEM = `You write Council Training for StrataCouncil.ca: short, practical e-learning for volunteer strata council members in British Columbia, Canada. Learners are owners who joined council, not professionals. Every module answers "what do I need to know to make good decisions for the other owners?"

The sources below (each in a <source> tag with an id such as "P3", its document and its section) are the only facts you may use. Most are sections of the Strata Property Act, the Strata Property Regulation and other BC law; some are guidance.

Rules:
- Every fact, number, deadline, vote threshold and rule must come from the sources. If they don't support something, leave it out. Never invent section numbers, dollar figures, dates, case names or background (history, other agencies, how things "usually" work). Shorter and right beats longer and unsupported.
- The law is the authority for rules; guidance is for explanation and practical advice. Where they disagree, follow the law.
- This is BC: never use terms or bodies from other provinces (no "condominium", "board of directors", "declaration", "common elements", "status certificate").
- Plain, warm, direct Canadian English (Canadian spelling). Short sentences. Address the learner as "you". Explain a legal term the first time it appears.
- Practical over theoretical: what council does, when, who decides, what can go wrong.
- Education, not legal advice: where a situation turns on its facts, say council should get professional advice.
- No emoji, no exclamation marks.`;

/** How deep each Bloom level goes, so a basics module doesn't reach for lawsuits. */
export const BLOOM_DEPTH: Record<Bloom, string> = {
  remember: "name and recognize the basic terms and facts",
  understand: "say what something is and why it matters, in their own words",
  apply: "use a rule or step in an everyday council situation",
  analyze: "compare options or break a situation into its parts",
  evaluate: "judge which choice is best and why",
  create: "put together a plan or document",
};

/**
 * The outline: the module's blueprint, turned into slides. The blueprint
 * is fixed; the AI decides only how to split each step and what each
 * slide says, never what the module covers.
 */
export function outlineRequest(m: {
  title: string;
  summary: string;
  track: string;
  minutes: number | null;
  objectives: Objective[];
  blueprint: BlueprintStep[];
  existingTitles: string[];
}) {
  return `Turn this Council Training module's blueprint into slides.

Module: ${m.title}
Track: ${m.track}
Learning objectives, and how deep each goes:
${m.objectives.map((o) => `- ${o.text} (${bloomLabels[o.bloom]}: the learner can ${BLOOM_DEPTH[o.bloom]}; go no deeper)`).join("\n")}

The blueprint (the fixed progression of this module):
${m.blueprint.map((b, i) => `${i + 1}. [${b.topic}]${b.activity !== "none" ? ` (${b.activity})` : ""} ${b.teach.replace(/\s+/g, " ").trim()}`).join("\n")}
${m.existingTitles.length ? `\nThe module already has these slides (the new ones go after them; don't repeat them):\n${m.existingTitles.map((t) => `- ${t}`).join("\n")}\n` : ""}
Rules:
- Follow the blueprint exactly: its steps in order, its topic names unchanged. Add no steps, topics, introductions, objective slides or summary slides (the player shows the objectives first and a recap at the end).
- Each step becomes one slide, or two if it holds more than one idea. One idea per slide; a learner reads each slide in under 20 seconds.
- A step marked knowledge_check becomes one slide with a knowledge check on what the steps just before it taught. Other activities (accordion, flip_cards) go on the step's slide.
- Teach only what each step says. The sources contain far more than this module covers (powers, lawsuits, procedures, exceptions, deadlines): leave all of that out, however relevant it seems. Never reach into other modules.
- About ${m.minutes ?? 12} minutes in all.

For each slide give: its topic (the step's topic, exactly), a short plain title, the one point it teaches (a sentence, within the step), its activity ("none" unless the step has one), and the ids of the sources that support it.`;
}

export function slideRequest(a: {
  module: { title: string; objectives: Objective[] };
  outline: OutlineSlide[];
  index: number;
  written: { title: string; body: string }[];
  names: string[];
  feedback?: string;
}) {
  const s = a.outline[a.index];
  return `Write slide ${a.index + 1} of ${a.outline.length} for the module "${a.module.title}".

Objectives: ${a.module.objectives.map((o) => `${o.text} (${bloomLabels[o.bloom]})`).join("; ")}

The plan:
${a.outline.map((o, i) => `${i === a.index ? ">> " : "   "}${i + 1}. [${o.topic}] ${o.title}: ${o.point}${o.element !== "none" ? ` (${o.element})` : ""}`).join("\n")}
${a.written.length ? `\nSlides already written (build on them; don't repeat them):\n${a.written.map((w) => `- ${w.title}: ${w.body.replace(/\n/g, " ")}`).join("\n")}\n` : ""}
This slide: "${s.title}". It teaches only this: ${s.point}
Use the sources it relies on (${s.sourceIds.join(", ") || "any that apply"}) to get the facts right. Say nothing else from the sources: everything not in this point belongs to another slide or another module.

Write:
- "title": the slide title (you may keep "${s.title}").
- "body": what the learner reads, ${SLIDE_WORDS_MAX} words at most (aim for 30 to 45). One or two short sentences, or a short lead-in and two to four bullets (each line starting "- "). Never more than ${SLIDE_WORDS_MAX} words.
- "narrationScript": what the narrator says while the slide is shown, 40 to 110 words: conversational, explaining the slide in more depth, with no facts the sources don't support.
- "element": ${s.element === "none" ? '{"type": "none"} with the other fields empty' : `a ${s.element}`}.${
    s.element === "knowledge_check"
      ? ` One question, exactly three answers: one right, two wrong ones that sound plausible to a newcomer but are clearly wrong according to the sources (no "all of the above", no trick wording). "explanation": why the right answer is right, ${ITEM_WORDS_MAX} words at most.`
      : s.element === "accordion"
        ? ` Two to five sections, each a short heading and text of ${ITEM_WORDS_MAX} words at most.`
        : s.element === "flip_cards"
          ? ` Two to five cards, each a short front ("heading") and a back ("text") of ${ITEM_WORDS_MAX} words at most.`
          : ""
  }
- "sourceIds": the ids of the sources that actually say what this slide states (empty if it states no rule or fact).

If an example needs people, use only these first names: ${a.names.join(" and ")}. Don't use any other names.${a.feedback ? `\n\nYour last attempt needs fixing: ${a.feedback}` : ""}`;
}

// ── Reply shapes ───────────────────────────────────────────────────────

export const ELEMENT_TYPES = ["none", "knowledge_check", "accordion", "flip_cards"] as const;
export type OutlineElement = (typeof ELEMENT_TYPES)[number];

export interface OutlineSlide {
  id: string;
  topic: string;
  title: string;
  point: string;
  element: OutlineElement;
  sourceIds: string[];
}

export const outlineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "title", "point", "element", "sourceIds"],
        properties: {
          topic: { type: "string" },
          title: { type: "string" },
          point: { type: "string" },
          element: { type: "string", enum: [...ELEMENT_TYPES] },
          sourceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const slideSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body", "narrationScript", "element", "sourceIds"],
  properties: {
    title: { type: "string" },
    body: { type: "string" },
    narrationScript: { type: "string" },
    element: {
      type: "object",
      additionalProperties: false,
      required: ["type", "question", "answers", "explanation", "items"],
      properties: {
        type: { type: "string", enum: [...ELEMENT_TYPES] },
        question: { type: "string" },
        answers: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["text", "correct"], properties: { text: { type: "string" }, correct: { type: "boolean" } } },
        },
        explanation: { type: "string" },
        items: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["heading", "text"], properties: { heading: { type: "string" }, text: { type: "string" } } },
        },
      },
    },
    sourceIds: { type: "array", items: { type: "string" } },
  },
} as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The outline from the AI (or as the author edited it), cleaned up. Source ids must be ones it was given. */
export function normalizeOutline(raw: unknown, knownIds: Set<string>): OutlineSlide[] {
  const list = (raw as { slides?: unknown })?.slides ?? raw;
  return (Array.isArray(list) ? list : [])
    .slice(0, 20)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        id: typeof o.id === "string" && /^[\w-]{1,40}$/.test(o.id) ? o.id : newId("o"),
        topic: str(o.topic, 200),
        title: str(o.title, 200),
        point: str(o.point, 500),
        element: ELEMENT_TYPES.includes(o.element as OutlineElement) ? (o.element as OutlineElement) : "none",
        sourceIds: (Array.isArray(o.sourceIds) ? o.sourceIds : []).map(String).filter((id) => knownIds.has(id)).slice(0, 8),
      };
    })
    .filter((o) => o.title);
}

export interface DraftedSlide {
  title: string;
  body: string;
  narrationScript: string;
  element: SlideElement | null;
  sourceIds: string[];
}

/** A written slide from the AI, in the slide model's shape. */
export function toDraftedSlide(raw: unknown, planned: OutlineSlide, knownIds: Set<string>): DraftedSlide {
  const r = (raw ?? {}) as Record<string, unknown>;
  const e = (r.element ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(e.items) ? e.items : []).slice(0, 5).map((i) => {
    const x = (i ?? {}) as Record<string, unknown>;
    return { heading: str(x.heading, 120), text: str(x.text, 600) };
  }).filter((i) => i.heading || i.text);
  let element: SlideElement | null = null;
  // The plan decides whether a slide has an element.
  const type = planned.element;
  if (type === "knowledge_check") {
    const answers = (Array.isArray(e.answers) ? e.answers : []).slice(0, 5).map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      return { id: newId("o"), text: str(x.text, 300), correct: x.correct === true };
    }).filter((a) => a.text);
    const right = answers.find((a) => a.correct) ?? answers[0];
    if (str(e.question, 400) && right)
      element = { type: "knowledge_check", question: str(e.question, 400), options: answers.map(({ id, text }) => ({ id, text })), correctId: right.id, explanation: str(e.explanation, 600) };
  } else if (type === "accordion" && items.length) {
    element = { type: "accordion", items: items.map((i) => ({ id: newId("a"), title: i.heading, body: i.text })) };
  } else if (type === "flip_cards" && items.length) {
    element = { type: "flip_cards", items: items.map((i) => ({ id: newId("c"), front: i.heading, back: i.text })) };
  }
  return {
    title: str(r.title, 200) || planned.title,
    body: str(r.body, 4000),
    narrationScript: str(r.narrationScript, 5000),
    element,
    sourceIds: (Array.isArray(r.sourceIds) ? r.sourceIds : []).map(String).filter((id) => knownIds.has(id)).slice(0, 8),
  };
}

/** What's wrong with a written slide, for one more try. Empty means it's fine. */
export function draftProblems(d: DraftedSlide, planned: OutlineSlide, names: string[]): string[] {
  const out: string[] = [];
  const words = countWords(d.body);
  if (!d.body) out.push("The body is empty.");
  if (words > SLIDE_WORDS_MAX) out.push(`The body is ${words} words; it must be ${SLIDE_WORDS_MAX} or fewer.`);
  if (planned.element !== "none" && !d.element) out.push(`The slide needs its ${planned.element.replace("_", " ")}.`);
  const el = d.element;
  if (el?.type === "knowledge_check") {
    if (el.options.length !== 3) out.push("The knowledge check needs exactly three answers.");
    if (countWords(el.explanation) > ITEM_WORDS_MAX) out.push(`The explanation must be ${ITEM_WORDS_MAX} words or fewer.`);
  }
  if (el?.type === "accordion" && el.items.some((i) => countWords(i.body) > ITEM_WORDS_MAX)) out.push(`Each accordion section must be ${ITEM_WORDS_MAX} words or fewer.`);
  if (el?.type === "flip_cards" && el.items.some((i) => countWords(i.back) > ITEM_WORDS_MAX)) out.push(`Each card's back must be ${ITEM_WORDS_MAX} words or fewer.`);
  const all = [d.title, d.body, d.narrationScript, JSON.stringify(el ?? {})].join(" ");
  const stray = strayNames(all, names);
  if (stray.length) out.push(`Use only the names ${names.join(" and ")}, not ${stray.join(", ")}.`);
  return out;
}

// ── Paste a blueprint ──────────────────────────────────────────────────
//
// An author's own module outline (objectives, sections, takeaways, a
// knowledge check), pasted into the builder and turned into the module's
// settings: title, summary, length, objectives, blueprint steps and
// further reading. Nothing is invented: it only reorganizes the outline.

export const PASTE_MAX_CHARS = 30000;

export const PASTE_SYSTEM = `You turn a training author's outline for one Council Training module (BC strata councils) into the fields of the module builder. Reorganize; never invent. Keep the author's own wording wherever a field allows it.

Fields:
- title: the module's title, without any "Module 1 —" numbering.
- summary: one or two sentences on what the module is for, from the author's stated goal (at most 600 characters).
- estimatedMinutes: the author's estimate as a whole number (the middle of a range), or 0 if none is given.
- objectives: exactly ${OBJECTIVES_MAX} or fewer learning objectives. If the outline has more, merge related ones into broader objectives, each a single sentence starting with a measurable verb, covering everything the originals covered. Give each a Bloom level (${BLOOM_LEVELS.join(", ")}) matching its verb.
- originalObjectives: the outline's objectives exactly as written, in order (empty if there were ${OBJECTIVES_MAX} or fewer).
- blueprint: one step per lesson section, in the outline's order. topic: the section's heading, without numbering or timings. teach: everything the section says to cover, its examples, tables (as short lines), and its key takeaway, in plain sentences or "- " bullets, at most 1400 characters; carry over the author's guidance that shapes how it's taught (for example "introductory references, not a legal deep dive"). activity: one of ${ACTIVITIES.join(", ")}: "flip_cards" for a set of terms or pairs to compare, "accordion" for a list of roles, bodies or items to explore one by one, "knowledge_check" only for a step that is the outline's quiz or check questions (put the questions in teach), otherwise "none". A wrap-up or "things to remember" section is its own step with activity "none".
- furtherReading: the official sources the outline names or links (for example the Strata Property Act on BC Laws), each with a title, an https URL only if the outline gives one or it is the well-known official page, and a short note. At most 6. Empty if none.`;

export function pasteBlueprintRequest(text: string) {
  return `The author's outline:\n\n<outline>\n${text.slice(0, PASTE_MAX_CHARS)}\n</outline>`;
}

export const pasteBlueprintSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "estimatedMinutes", "objectives", "originalObjectives", "blueprint", "furtherReading"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    estimatedMinutes: { type: "integer" },
    objectives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "bloom"],
        properties: { text: { type: "string" }, bloom: { type: "string", enum: [...BLOOM_LEVELS] } },
      },
    },
    originalObjectives: { type: "array", items: { type: "string" } },
    blueprint: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "teach", "activity"],
        properties: { topic: { type: "string" }, teach: { type: "string" }, activity: { type: "string", enum: [...ACTIVITIES] } },
      },
    },
    furtherReading: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "note"],
        properties: { title: { type: "string" }, url: { type: "string" }, note: { type: "string" } },
      },
    },
  },
} as const;

export interface PastedBlueprint {
  title: string;
  summary: string;
  estimatedMinutes: number | null;
  objectives: Objective[];
  /** The outline's own objectives, when they were merged into fewer. */
  originalObjectives: string[];
  blueprint: BlueprintStep[];
  furtherReading: FurtherReading[];
}

/** The AI's reply, held to the builder's own limits. */
export function normalizePastedBlueprint(raw: unknown): PastedBlueprint {
  const x = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+$/g, "").trim().slice(0, n) : "");
  const minutes = Number(x.estimatedMinutes);
  return {
    title: text(x.title, 200).replace(/^module\s*\d+\s*[-—–:]\s*/i, ""),
    summary: text(x.summary, 1000),
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(600, Math.round(minutes)) : null,
    objectives: normalizeObjectives(x.objectives).filter((o) => o.text.trim()),
    originalObjectives: (Array.isArray(x.originalObjectives) ? x.originalObjectives : [])
      .map((o) => text(o, 300))
      .filter(Boolean)
      .slice(0, 12),
    blueprint: normalizeBlueprint(x.blueprint),
    // Only https links reach learners.
    furtherReading: normalizeFurtherReading(x.furtherReading).map((r) => (/^https:\/\//i.test(r.url) ? r : { ...r, url: "" })),
  };
}
