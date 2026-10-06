/**
 * The AI module builder's pure parts: what the AI is asked for, the shapes
 * it must answer in, and the conversion of its answers into Module Builder
 * content. No network, no database (lib/inngest/training-import.ts runs it).
 *
 * The AI writes in a flat, forgiving format (one block shape with optional
 * fields, light markdown for text); everything it returns goes through
 * normalizeModuleContent before it's stored, like anything else typed into
 * the builder.
 */
import {
  newId,
  normalizeModuleContent,
  type Block,
  type ModuleContent,
  type RichDoc,
  type RichMark,
  type RichNode,
  type Screen,
} from "./content.ts";

export const TRACK_CODES = ["strata_basics", "council_ready", "treasurer", "secretary"] as const;
export type TrackCode = (typeof TRACK_CODES)[number];

/** The longest document text sent in one go (roughly 350,000 tokens, well inside the context window). */
export const MAX_SOURCE_CHARS = 1_400_000;

/** Private storage for uploaded source documents (0034). */
export const TRAINING_IMPORT_BUCKET = "training-imports";

// ── The documents an import reads ─────────────────────────────────────

export type ImportSourceRecord =
  | { kind: "upload"; path: string; fileName: string; mimeType: string | null }
  | { kind: "library"; legislationId: string; title: string };

export function parseSources(raw: unknown): ImportSourceRecord[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x): ImportSourceRecord[] => {
    const s = (x ?? {}) as Record<string, unknown>;
    if (s.kind === "upload" && typeof s.path === "string" && typeof s.fileName === "string")
      return [{ kind: "upload", path: s.path, fileName: s.fileName, mimeType: typeof s.mimeType === "string" ? s.mimeType : null }];
    if (s.kind === "library" && typeof s.legislationId === "string")
      return [{ kind: "library", legislationId: s.legislationId, title: typeof s.title === "string" ? s.title : "Library entry" }];
    return [];
  });
}

// ── The plan: the documents broken into proposed modules ──────────────

export interface PlannedSection {
  title: string;
  keyPoints: string[];
}
export interface PlannedModule {
  key: string;
  include: boolean;
  title: string;
  trackCode: TrackCode;
  summary: string;
  estimatedMinutes: number;
  objectives: string[];
  sections: PlannedSection[];
  status?: "pending" | "building" | "done" | "failed";
  moduleId?: string;
  error?: string;
}
export interface ImportPlan {
  summary: string;
  modules: PlannedModule[];
}

const str = { type: "string" } as const;
const strList = { type: "array", items: str } as const;
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "modules"],
  properties: {
    summary: str,
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "trackCode", "summary", "estimatedMinutes", "objectives", "sections"],
        properties: {
          title: str,
          trackCode: { type: "string", enum: [...TRACK_CODES] },
          summary: str,
          estimatedMinutes: { type: "integer" },
          objectives: strList,
          sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "keyPoints"],
              properties: { title: str, keyPoints: strList },
            },
          },
        },
      },
    },
  },
} as const;

/** Tidy what the AI proposed: sane lengths and counts, a key per module, everything included. */
export function normalizePlan(raw: unknown): ImportPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const texts = (v: unknown, max: number, count: number) =>
    (Array.isArray(v) ? v : []).map((x) => text(x, max)).filter(Boolean).slice(0, count);
  const modules = (Array.isArray(r.modules) ? r.modules : []).slice(0, 20).map((m): PlannedModule => {
    const x = (m ?? {}) as Record<string, unknown>;
    const minutes = Number(x.estimatedMinutes);
    return {
      key: typeof x.key === "string" && /^[\w-]{1,40}$/.test(x.key) ? x.key : newId("m"),
      include: x.include !== false,
      title: text(x.title, 200) || "Untitled module",
      trackCode: TRACK_CODES.includes(x.trackCode as TrackCode) ? (x.trackCode as TrackCode) : "council_ready",
      summary: text(x.summary, 500),
      estimatedMinutes: Number.isFinite(minutes) ? Math.min(90, Math.max(5, Math.round(minutes))) : 15,
      objectives: texts(x.objectives, 300, 8),
      sections: (Array.isArray(x.sections) ? x.sections : []).slice(0, 10).map((s) => {
        const y = (s ?? {}) as Record<string, unknown>;
        return { title: text(y.title, 200) || "Untitled section", keyPoints: texts(y.keyPoints, 500, 12) };
      }),
      ...(x.status === "done" || x.status === "building" || x.status === "failed" || x.status === "pending" ? { status: x.status } : {}),
      ...(typeof x.moduleId === "string" ? { moduleId: x.moduleId } : {}),
      ...(typeof x.error === "string" ? { error: x.error.slice(0, 300) } : {}),
    };
  });
  return { summary: text(r.summary, 2000), modules };
}

// ── One section, written as screens ────────────────────────────────────

const blockTypes = ["text", "callout", "reveal", "summary", "table", "features", "knowledge_check", "scenario", "checklist"] as const;

const blockSchema = {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "text",
                "title",
                "variant",
                "reference",
                "style",
                "items",
                "question",
                "options",
                "explanation",
                "studyNote",
                "prompt",
                "choices",
                "rows",
              ],
              properties: {
                type: { type: "string", enum: [...blockTypes] },
                text: nullable(str),
                title: nullable(str),
                variant: nullable({ type: "string", enum: ["key", "tip", "mistake", "legislation"] }),
                reference: nullable(str),
                style: nullable({ type: "string", enum: ["accordion", "cards"] }),
                items: nullable({
                  type: "array",
                  items: { type: "object", additionalProperties: false, required: ["title", "text"], properties: { title: str, text: str } },
                }),
                question: nullable(str),
                options: nullable({
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["text", "correct", "why"],
                    properties: { text: str, correct: { type: "boolean" }, why: str },
                  },
                }),
                explanation: nullable(str),
                studyNote: nullable(str),
                prompt: nullable(str),
                choices: nullable({
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["text", "outcome", "rating"],
                    properties: { text: str, outcome: str, rating: { type: "string", enum: ["best", "okay", "poor"] } },
                  },
                }),
                rows: nullable({ type: "array", items: strList }),
              },
            } as const;

export const sectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["screens"],
  properties: {
    screens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "narration", "photoSearch", "blocks"],
        properties: {
          title: str,
          narration: str,
          photoSearch: str,
          blocks: {
            type: "array",
            items: blockSchema,
          },
        },
      },
    },
  },
} as const;


/** A screen's on-screen blocks rewritten (Tighten with AI). */
export const tightenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: { blocks: { type: "array", items: blockSchema } },
} as const;

type AiBlock = {
  type: string;
  text?: string | null;
  title?: string | null;
  variant?: string | null;
  reference?: string | null;
  style?: string | null;
  items?: { title: string; text: string }[] | null;
  question?: string | null;
  options?: { text: string; correct: boolean; why: string }[] | null;
  explanation?: string | null;
  studyNote?: string | null;
  prompt?: string | null;
  choices?: { text: string; outcome: string; rating: string }[] | null;
  rows?: string[][] | null;
};
type AiScreen = { title?: string; narration?: string; photoSearch?: string; blocks?: AiBlock[] };

/** One AI block in the Module Builder's shape; null when there's nothing usable in it. */
export function toBlock(b: AiBlock): Block | null {
  const id = newId();
  const items = (b.items ?? []).filter((i) => i && (i.title?.trim() || i.text?.trim()));
  switch (b.type) {
    case "text":
      return b.text?.trim() ? { id, type: "text", doc: markdownToDoc(b.text) } : null;
    case "callout":
      if (!b.text?.trim()) return null;
      return {
        id,
        type: "callout",
        variant: (["key", "tip", "mistake", "legislation"] as const).find((v) => v === b.variant) ?? "key",
        title: b.title?.trim() ?? "",
        doc: markdownToDoc(b.text),
        reference: b.reference?.trim() ?? "",
      };
    case "reveal":
      if (!items.length) return null;
      return {
        id,
        type: "reveal",
        style: b.style === "cards" ? "cards" : "accordion",
        items: items.map((i) => ({ id: newId("r"), title: i.title.trim(), body: i.text.trim() })),
      };
    case "summary": {
      const points = items.length ? items.map((i) => i.text.trim() || i.title.trim()) : lines(b.text);
      if (!points.length) return null;
      return { id, type: "summary", title: b.title?.trim() || "Summary", points: points.map((text) => ({ id: newId("p"), text })) };
    }
    case "checklist": {
      const points = items.length ? items.map((i) => i.text.trim() || i.title.trim()) : lines(b.text);
      if (!points.length) return null;
      return { id, type: "checklist", title: b.title?.trim() ?? "", items: points.map((text) => ({ id: newId("i"), text })) };
    }
    case "features":
      if (!items.length) return null;
      return {
        id,
        type: "features",
        items: items.slice(0, 4).map((i) => ({ id: newId("f"), image: "", title: i.title.trim(), text: i.text.trim() })),
      };
    case "table": {
      const rows = (b.rows ?? []).filter((r) => Array.isArray(r) && r.some((c) => c?.trim()));
      if (!rows.length) return null;
      return { id, type: "table", caption: b.title?.trim() ?? "", header: true, rows };
    }
    case "knowledge_check": {
      const options = (b.options ?? []).filter((o) => o?.text?.trim());
      if (!b.question?.trim() || options.length < 2) return null;
      const withIds = options.map((o) => ({ ...o, id: newId("o") }));
      const correct = withIds.find((o) => o.correct) ?? withIds[0];
      return {
        id,
        type: "knowledge_check",
        question: b.question.trim(),
        options: withIds.map((o) => ({ id: o.id, text: o.text.trim(), feedback: o.why?.trim() ?? "" })),
        correctId: correct.id,
        explanation: b.explanation?.trim() ?? "",
        studyTip: b.studyNote?.trim() ?? "",
        reference: b.reference?.trim() ?? "",
      };
    }
    case "scenario": {
      const choices = (b.choices ?? []).filter((c) => c?.text?.trim());
      if (!b.text?.trim() || choices.length < 2) return null;
      return {
        id,
        type: "scenario",
        situation: markdownToDoc(b.text),
        prompt: b.prompt?.trim() || "What do you do?",
        choices: choices.map((c) => ({
          id: newId("c"),
          text: c.text.trim(),
          outcome: c.outcome?.trim() ?? "",
          rating: (["best", "okay", "poor"] as const).find((r) => r === c.rating) ?? "okay",
        })),
      };
    }
    default:
      return null;
  }
}

/** The AI's screens for one section in the Module Builder's shape (narration is a script to record). */
export function toScreens(raw: unknown): Screen[] {
  const screens = ((raw as { screens?: AiScreen[] })?.screens ?? []).slice(0, 12);
  return screens
    .map((s) => ({
      id: newId("s"),
      title: (s.title ?? "").trim().slice(0, 200) || "Untitled screen",
      layout: "full" as const,
      image: { src: "", alt: "", credit: null, hint: (s.photoSearch ?? "").trim().slice(0, 200) },
      narration: { src: "", transcript: (s.narration ?? "").trim(), voicedText: "" },
      blocks: (s.blocks ?? []).map(toBlock).filter((b): b is Block => b !== null),
    }))
    .filter((s) => s.blocks.length > 0);
}

/** A whole module from its plan and the screens written for each section. */
export function assembleModule(planned: PlannedModule, sectionScreens: Screen[][]): ModuleContent {
  return normalizeModuleContent({
    objectives: planned.objectives,
    sections: planned.sections.map((s, i) => ({ id: newId("sec"), title: s.title, screens: sectionScreens[i] ?? [] })),
  });
}

function lines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

// ── Light markdown to the builder's rich text ──────────────────────────

/**
 * Paragraphs, "## " / "### " headings, "- " and "1. " lists, **bold** and
 * *italic*. Anything else stays as plain text.
 */
export function markdownToDoc(md: string): RichDoc {
  const content: RichNode[] = [];
  const blocks = md.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const rows = block.split("\n").filter((l) => l.trim());
    if (!rows.length) continue;
    const bullet = rows.every((l) => /^\s*[-*•]\s+/.test(l));
    const ordered = rows.every((l) => /^\s*\d+[.)]\s+/.test(l));
    if (bullet || ordered) {
      content.push({
        type: ordered ? "orderedList" : "bulletList",
        content: rows.map((l) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")) }],
        })),
      });
      continue;
    }
    const heading = rows[0].match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      content.push({ type: "heading", attrs: { level: heading[1].length === 3 ? 3 : 2 }, content: inline(heading[2]) });
      if (rows.length > 1) content.push({ type: "paragraph", content: inline(rows.slice(1).join(" ")) });
      continue;
    }
    content.push({ type: "paragraph", content: inline(rows.join(" ").replace(/^#+\s+/, "")) });
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function inline(text: string): RichNode[] {
  const out: RichNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(?!\s)(.+?)\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ type: "text", text: text.slice(at, m.index) });
    const marks: RichMark[] = [{ type: m[1] !== undefined ? "bold" : "italic" }];
    out.push({ type: "text", text: m[1] ?? m[2], marks });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out.filter((n) => n.text);
}

// ── What the AI is told ────────────────────────────────────────────────

export const TRACK_DESCRIPTIONS: Record<TrackCode, string> = {
  strata_basics:
    "Strata Basics (for any owner): what a strata is (strata lots, common property, unit entitlement, the governing documents), who decides what (owners, council, the strata manager, vote types), and where the money goes (operating fund, contingency reserve fund, fees, special levies, the budget).",
  council_ready:
    "Council Ready (for every council member, after Strata Basics): duties and conflicts of interest, running council meetings, general meetings and voting, bylaws and fair enforcement, repairs, maintenance and insurance, records and privacy, working with a strata manager or self-managing.",
  treasurer:
    "Treasurer (after Council Ready): reading financial statements, the budget and fees, the reserve fund and depreciation report, collections and financial controls.",
  secretary:
    "Secretary (after Council Ready): notices and agendas, writing minutes, records and owner requests, correspondence and privacy.",
};

/** The fixed instructions (cached together with the document across every call for one import). */
export const BUILDER_SYSTEM = `You write Council Training for StrataCouncil.ca: short, practical e-learning modules for volunteer strata council members in British Columbia, Canada. Learners are owners who joined council, not professionals. The design question behind every module is "what do I need to know to make good decisions for the other owners?", not "what does the law say in general".

You work from the source documents given below (each in a <source_document> tag with its title). They are the only source of facts you may use. Some are sections of the Strata Property Act, the Strata Property Regulation or other law (kind "act" or "regulation"), each section opening with its citation; others are guidance. The law is the authority for every rule, number, deadline and vote threshold; guidance is for explanation, examples and practical advice. Where they overlap, combine them; where guidance disagrees with the law, follow the law and say council should check. Cite the law where a rule comes from it, using the section numbers in the passages ("Strata Property Act, s. 45", "Strata Property Regulation, s. 6.6", "Standard Bylaw 23").

Rules:
- Every fact, number, deadline and threshold must come from the source documents. If they don't support something, leave it out. Never invent section numbers, case names, dollar figures or dates.
- References name the document and its own section or heading, e.g. "Strata Property Act, s. 45" or "Strata corporations (Province of BC), 'Decision making'". Only cite what a document actually contains, and ignore website menus, navigation and page furniture.
- Plain, warm, direct Canadian English (Canadian spelling: "council", "centre", "favour"). Short sentences. Address the learner as "you". Explain any legal term the first time it appears.
- Practical over theoretical: what council does, when, who decides, what can go wrong.
- This is education, not legal advice. Where a situation turns on its facts, say council should get professional advice.
- No emoji. No exclamation-mark enthusiasm.`;

export const PLAN_INSTRUCTIONS = `Break the source documents into Council Training modules.

- Each module is 10 to 15 minutes for a volunteer (at most about 18 screens) and covers one coherent topic. Prefer several focused modules to one long one; a short document may be a single module.
- Put each module in the track it best fits:
${TRACK_CODES.map((c) => `  - ${c}: ${TRACK_DESCRIPTIONS[c]}`).join("\n")}
- For each module give: a title (plain, specific, no colon subtitles), a one- or two-sentence summary, an estimate in minutes, 3 to 5 learning objectives (each starting with a verb, e.g. "Explain when council needs a 3/4 vote"), and 3 or 4 sections. Each section has a short title and the key points it will teach, drawn from the documents.
- Order the modules the way a new council member should take them.
- "summary" describes the documents and how you've divided them, in two or three sentences.`;

/** One module from the curriculum map, to be written from the documents (0036). */
export interface CurriculumTarget {
  title: string;
  trackCode: TrackCode;
  summary: string;
  estimatedMinutes: number | null;
  objectives: string[];
}

/**
 * Curriculum first: the module's title, scope and objectives are fixed by
 * the curriculum map; the documents supply the facts. The rest of the map
 * is listed so the AI leaves other modules' material to them.
 */
export function curriculumPlanRequest(target: CurriculumTarget, others: { title: string; track: string; summary: string }[], notes: string) {
  return [
    `Plan one Council Training module from the source documents. The module is part of a fixed curriculum, so its title, scope and learning objectives are already decided:

Module: ${target.title}
Track: ${target.trackCode} (${TRACK_DESCRIPTIONS[target.trackCode]})
Scope: ${target.summary || "(see the objectives)"}
Length: ${target.estimatedMinutes ?? 12} minutes, at most about 18 screens
Learning objectives:
${target.objectives.map((o) => `- ${o}`).join("\n") || "- (none yet: propose 3 to 5)"}`,
    `- Return exactly one module with that title and track. Keep the objectives as given${target.objectives.length ? "" : " (propose 3 to 5, each starting with a verb)"}.
- Choose 3 or 4 sections that together meet every objective. Each section's key points come from the documents.
- Teach only what this module's scope and objectives need. Leave out anything the other modules below cover, and anything a volunteer council member won't use.
- If the documents don't support an objective, say so in "summary" so the author can add a source; don't fill the gap from general knowledge.
- "summary" (top level) tells the author how you've used the documents and anything missing. The module's own "summary" is one or two sentences for learners.`,
    others.length ? `The rest of the curriculum (don't teach these modules' material):\n${others.map((o) => `- ${o.track}: ${o.title}${o.summary ? ` (${o.summary})` : ""}`).join("\n")}` : "",
    notes ? `Notes from the author:\n${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Keep the curriculum's title, track and objectives whatever the AI returned. */
export function pinToCurriculum(plan: ImportPlan, target: CurriculumTarget): ImportPlan {
  const first = plan.modules[0];
  if (!first) return plan;
  return {
    ...plan,
    modules: [
      {
        ...first,
        include: true,
        title: target.title,
        trackCode: target.trackCode,
        estimatedMinutes: target.estimatedMinutes ?? first.estimatedMinutes,
        objectives: target.objectives.length ? target.objectives : first.objectives,
        sections: first.sections.slice(0, 4),
      },
    ],
  };
}

export const SECTION_INSTRUCTIONS = `Write one section of a module as screens. The learner sees one screen at a time, with a title bar and Next.

Screens:
- 3 to 5 screens per section, so the whole module stays at about 18 screens or fewer. Each screen teaches one idea; leave out detail a volunteer won't use.
- The screen is read while the narration plays, so keep it sparse: at most about 40 words of on-screen text in total (knowledge checks and scenarios aside), usually one or two blocks. Show the key words, not sentences: a short line, 2 to 4 bullets of a few words, a callout, cards or a table. Card and reveal text is at most about 15 words each. Never put the explanation on screen; that's the narration's job.
- "narration" is a script read aloud with the screen: 40 to 90 words, conversational. It explains what the screen shows, without reading the screen out word for word. Write it to be spoken: no lists, no abbreviations a narrator would stumble on, numbers as words where that reads better.
- "photoSearch" is two to five words to search a stock-photo library for a picture that suits the screen (real people, buildings, meetings, documents; e.g. "condo building balconies", "people at meeting table"). Never names, logos or text.
- The section's first screen sets up why the topic matters to council.

Blocks (choose the ones that fit; vary them):
- text: markdown-lite in "text" (paragraphs, "- " bullet lists, **bold**). Keep it short.
- callout: "variant" key (the main point), tip, mistake (a common mistake) or legislation (the rule itself, with "reference"); "title" optional; body in "text".
- reveal: click to reveal. "style" accordion (headings that open) or cards (flip cards: term on the front, meaning on the back). "items" with title and text. Good for definitions, lists of roles, the parts of something.
- features: two to four side-by-side items ("items" with a short title and caption), e.g. the three people involved.
- table: "rows", first row the header, e.g. deadlines, who does what, vote thresholds. "title" is the caption.
- knowledge_check: "question", 3 or 4 "options" with exactly one "correct": true and a one-sentence "why" for every option (why it's right, or why it's wrong), an "explanation" tying it together, a "studyNote" (one or two sentences to remember), and a "reference". Put each knowledge check on its own screen titled "Knowledge check".
- scenario: a realistic council situation in "text" (invent plausible people and buildings; never real ones), a "prompt", and 2 to 4 "choices", each with an "outcome" (what happens and why) and a "rating" (best, okay, poor).
- summary: the section's key points in "items" (use the "text" of each item).
- checklist: practical steps in "items".

Include at least one knowledge check in every section. Include a scenario in at least one section of the module. End the module's last section with a summary block.
Leave every field that doesn't apply to a block as null.`;

// ── Tighten with AI: make an existing screen sparser ───────────────────

/** Blocks Tighten with AI may rewrite; questions, scenarios and media are kept exactly as they are. */
const TIGHTENABLE = new Set(["text", "callout", "reveal", "summary", "checklist", "features", "table"]);
export const isTightenable = (b: Block) => TIGHTENABLE.has(b.type);

/** Words of on-screen text in a screen's rewritable blocks. */
export function onScreenWords(screen: Screen): number {
  return screen.blocks
    .filter(isTightenable)
    .map((b) => blockText(b))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function blockText(b: Block): string {
  switch (b.type) {
    case "text":
      return docToMarkdown(b.doc);
    case "callout":
      return [b.title, docToMarkdown(b.doc)].join(" ");
    case "reveal":
      return b.items.map((i) => `${i.title} ${i.body}`).join(" ");
    case "summary":
      return [b.title, ...b.points.map((p) => p.text)].join(" ");
    case "checklist":
      return [b.title, ...b.items.map((i) => i.text)].join(" ");
    case "features":
      return b.items.map((i) => `${i.title} ${i.text}`).join(" ");
    case "table":
      return b.rows.flat().join(" ");
    default:
      return "";
  }
}

/** The builder's rich text back to the light markdown the AI writes. */
export function docToMarkdown(doc: RichNode | undefined): string {
  if (!doc) return "";
  const inlineText = (n: RichNode): string => {
    if (n.type === "text") {
      const t = n.text ?? "";
      const marks = n.marks?.map((m) => m.type) ?? [];
      return marks.includes("bold") ? `**${t}**` : marks.includes("italic") ? `*${t}*` : t;
    }
    if (n.type === "hardBreak") return " ";
    return (n.content ?? []).map(inlineText).join("");
  };
  return (doc.content ?? [])
    .map((n) => {
      if (n.type === "heading") return `${n.attrs?.level === 3 ? "###" : "##"} ${inlineText(n)}`;
      if (n.type === "bulletList" || n.type === "orderedList")
        return (n.content ?? []).map((li, i) => `${n.type === "orderedList" ? `${i + 1}.` : "-"} ${inlineText(li)}`).join("\n");
      return inlineText(n);
    })
    .filter((s) => s.trim())
    .join("\n\n");
}

/** A screen's rewritable blocks in the AI's own format, for Tighten with AI. */
export function screenForTightening(screen: Screen) {
  return screen.blocks.filter(isTightenable).map((b) => {
    const base = { type: b.type } as Record<string, unknown>;
    if (b.type === "text") base.text = docToMarkdown(b.doc);
    if (b.type === "callout") Object.assign(base, { variant: b.variant, title: b.title, text: docToMarkdown(b.doc), reference: b.reference });
    if (b.type === "reveal") Object.assign(base, { style: b.style, items: b.items.map((i) => ({ title: i.title, text: i.body })) });
    if (b.type === "summary") Object.assign(base, { title: b.title, items: b.points.map((p) => ({ title: "", text: p.text })) });
    if (b.type === "checklist") Object.assign(base, { title: b.title, items: b.items.map((i) => ({ title: "", text: i.text })) });
    if (b.type === "features") Object.assign(base, { items: b.items.map((i) => ({ title: i.title, text: i.text })) });
    if (b.type === "table") Object.assign(base, { title: b.caption, rows: b.rows });
    return base;
  });
}

/**
 * Put the rewritten blocks in place of the screen's rewritable ones, where
 * the first of them was; every other block (questions, scenarios, media)
 * stays as and where it was. Icons and photos on cards are kept by position.
 */
export function applyTightened(screen: Screen, raw: unknown): Screen {
  const rewritten = (((raw as { blocks?: AiBlock[] })?.blocks ?? []) as AiBlock[])
    .filter((b) => TIGHTENABLE.has(b.type))
    .map(toBlock)
    .filter((b): b is Block => b !== null);
  if (!rewritten.length) return screen;
  const oldFeatures = screen.blocks.find((b) => b.type === "features");
  for (const b of rewritten) {
    if (b.type === "features" && oldFeatures?.type === "features") {
      b.items = b.items.map((it, i) => ({ ...it, image: oldFeatures.items[i]?.image ?? "" }));
    }
  }
  const first = screen.blocks.findIndex(isTightenable);
  const kept = screen.blocks.filter((b) => !isTightenable(b));
  const at = screen.blocks.slice(0, Math.max(0, first)).filter((b) => !isTightenable(b)).length;
  return { ...screen, blocks: [...kept.slice(0, at), ...rewritten, ...kept.slice(at)] };
}

export const TIGHTEN_INSTRUCTIONS = `Rewrite the on-screen blocks of one Council Training screen so they can be read at a glance while the narration plays.

- At most about 40 words of on-screen text in total, usually one or two blocks. Key words, not sentences: a short line, 2 to 4 bullets of a few words, a callout, cards or a table. Card and reveal text at most about 15 words each.
- The narration (given below) already explains the detail. Keep only what the learner should see; don't repeat the narration.
- Keep the meaning and every fact the screen needs. Never add facts, numbers, references or examples that aren't already there. Keep any "reference" as it is.
- Use only these block types: text, callout, reveal, summary, checklist, features, table. Leave every field that doesn't apply as null.
- Plain Canadian English. No emoji.`;
