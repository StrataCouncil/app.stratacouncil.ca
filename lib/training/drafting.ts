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
  countWords,
  ITEM_WORDS_MAX,
  newId,
  SLIDE_WORDS_MAX,
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

/** How to organize a module so it's easy to learn. */
export const ORGANIZING = `Organize the module so it's easy to learn:
- Start with why it matters to the learner: a short situation from strata life, or a question they'd ask (it can be rhetorical).
- Build from what they already know as an owner to what's new, simple to complex, the big picture before detail.
- One idea per slide. Never use an idea before the slide that teaches it. Group slides into two to four topics, each answering one question a newcomer would ask, named in plain words.
- Stay at the objectives' Bloom levels: don't go deeper than they call for. Anything complex or belonging to another module: name it in a sentence and move on.
- Give the learner something to do on some slides, choosing what fits the material:
  - accordion: the parts of a whole, or steps, opened one at a time;
  - flip_cards: a term and what it means, or a common belief and what the law actually says;
  - knowledge_check: a question on an objective, near the end of the topic that teaches it. Every objective gets at least one.
- Don't add slides for the objectives or a summary: the player shows the objectives first and a recap at the end.`;

export function outlineRequest(m: {
  title: string;
  summary: string;
  track: string;
  minutes: number | null;
  objectives: Objective[];
  curriculum: { track: string; title: string; summary: string; current: boolean }[];
  existingTitles: string[];
}) {
  return `Plan the slides for one Council Training module.

Module: ${m.title}
Track: ${m.track}
Scope: ${m.summary || "(as the title says)"}
Length: about ${m.minutes ?? 12} minutes, so 8 to 14 slides.
Learning objectives (with their Bloom levels):
${m.objectives.map((o) => `- ${o.text} (${bloomLabels[o.bloom]})`).join("\n")}

The whole curriculum, in order (this module is marked). Leave other modules' material to them:
${m.curriculum.map((c) => `- ${c.current ? ">> " : ""}${c.track}: ${c.title}. ${c.summary}`).join("\n")}
${m.existingTitles.length ? `\nThe module already has these slides (the new ones go after them; don't repeat them):\n${m.existingTitles.map((t) => `- ${t}`).join("\n")}\n` : ""}
${ORGANIZING}

For each slide give: its topic (slides in the same topic share the exact same topic name), a short plain title, the one point it teaches (a sentence, from the sources), the interactive element it uses ("none" for most), and the ids of the sources it relies on.`;
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
This slide: "${s.title}". It teaches: ${s.point}
Use the sources it relies on (${s.sourceIds.join(", ") || "any that apply"}); other sources only if needed.

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
