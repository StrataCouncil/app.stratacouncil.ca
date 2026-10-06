/**
 * Council Training content (0041): Track -> Module -> Slide -> Media.
 *
 * A module has one to three objectives (each with a Bloom level), an
 * ordered list of slides, and optional further reading. A slide has a
 * topic (slides on the same topic sit together in the player's menu), a
 * title, 40 to 50 words of text, one picture or video, narration, at most
 * one interactive element, and the Legislation Library sections it relies
 * on.
 *
 * This file is the one definition of that shape: the builder edits it, the
 * player renders it, and the normalizers below are applied to anything
 * coming from the browser or the database. Pure: no React, no Supabase.
 */

// ── Limits ─────────────────────────────────────────────────────────────

/** A slide's own text: short enough to read while the narration plays. */
export const SLIDE_WORDS_MAX = 50;
export const SLIDE_WORDS_TARGET = 40;
/** Each accordion section, flip card or answer explanation. */
export const ITEM_WORDS_MAX = 40;
export const OBJECTIVES_MAX = 3;

// ── Bloom's taxonomy ───────────────────────────────────────────────────

export const BLOOM_LEVELS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
export type Bloom = (typeof BLOOM_LEVELS)[number];
export const bloomLabels: Record<Bloom, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};
/** Verbs that start an objective at each level, as a prompt for authors. */
export const bloomVerbs: Record<Bloom, string> = {
  remember: "name, identify, recognize, list, define",
  understand: "describe, explain, distinguish, summarize",
  apply: "apply, follow, use, choose, decide, calculate",
  analyze: "compare, analyze, check, organize",
  evaluate: "assess, evaluate, recommend, judge",
  create: "prepare, draft, design, plan",
};

const VERB_LEVEL: Record<string, Bloom> = Object.fromEntries(
  (Object.entries(bloomVerbs) as [Bloom, string][]).flatMap(([level, verbs]) => verbs.split(", ").map((v) => [v, level]))
);

/** The level an objective's opening verb suggests ("understand" when it's not a known verb). */
export function bloomFor(text: string): Bloom {
  const verb = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return VERB_LEVEL[verb] ?? VERB_LEVEL[verb.replace(/ise$/, "ize")] ?? "understand";
}

export type Objective = { text: string; bloom: Bloom };

// ── Slides ─────────────────────────────────────────────────────────────

/** "photo": the picture fills the slide, text on a panel. "left"/"right": picture beside the text. "text": no picture. */
export type SlideLayout = "photo" | "left" | "right" | "text";
export const layoutLabels: Record<SlideLayout, string> = {
  photo: "Picture behind the text",
  left: "Picture on the left",
  right: "Picture on the right",
  text: "Text only",
};

export type KnowledgeCheck = {
  type: "knowledge_check";
  question: string;
  options: { id: string; text: string }[];
  correctId: string;
  /** Shown once the learner answers: why the right answer is right. */
  explanation: string;
};
export type Accordion = { type: "accordion"; items: { id: string; title: string; body: string }[] };
export type FlipCards = { type: "flip_cards"; items: { id: string; front: string; back: string }[] };
export type SlideElement = KnowledgeCheck | Accordion | FlipCards;
export type ElementType = SlideElement["type"];
export const elementLabels: Record<ElementType, string> = {
  knowledge_check: "Knowledge check",
  accordion: "Accordion",
  flip_cards: "Flip cards",
};

/** A Legislation Library section, as the library labels it ("Strata Property Act, s. 45 Notice of general meetings"). */
export type Citation = { chunkId: string; label: string };

/** Who took a stock photo, linked as Unsplash requires. */
export type PhotoCredit = { source: "unsplash"; name: string; profileUrl: string; photoUrl: string };

export type MediaRole = "visual" | "narration";
export type Media = {
  id: string;
  role: MediaRole;
  kind: "image" | "video" | "audio";
  source: "upload" | "unsplash" | "link";
  url: string;
  alt: string;
  credit: PhotoCredit | null;
};

export interface Slide {
  id: string;
  position: number;
  topic: string;
  title: string;
  body: string;
  layout: SlideLayout;
  narrationScript: string;
  /** The script the current narration audio was made from. */
  narrationVoiced: string;
  element: SlideElement | null;
  citations: Citation[];
  visual: Media | null;
  narration: Media | null;
}

export type FurtherReading = { title: string; url: string; note: string };

/**
 * A module's blueprint: the steps it teaches, in order, and what each one
 * covers (the progression of knowledge, adapted from established director
 * training to BC). AI drafting turns the blueprint into slides and teaches
 * nothing outside it.
 */
export const ACTIVITIES = ["none", "knowledge_check", "accordion", "flip_cards"] as const;
export type Activity = (typeof ACTIVITIES)[number];
export type BlueprintStep = { topic: string; teach: string; activity: Activity };

export function normalizeBlueprint(raw: unknown): BlueprintStep[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 30)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        topic: typeof o.topic === "string" ? o.topic.slice(0, 200) : "",
        teach: typeof o.teach === "string" ? o.teach.slice(0, 1500) : "",
        activity: ACTIVITIES.includes(o.activity as Activity) ? (o.activity as Activity) : "none",
      };
    })
    .filter((b) => b.topic.trim() || b.teach.trim());
}

// ── Text ───────────────────────────────────────────────────────────────

export function countWords(text: string): number {
  const words = text
    .replace(/^\s*[-•]\s+/gm, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

export type BodyPart = { kind: "paragraph"; text: string } | { kind: "bullets"; items: string[] };

/** A slide's text as paragraphs and bullet lists: a line starting "- " is a bullet. */
export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      parts.push({ kind: "paragraph", text: "" });
      continue;
    }
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const last = parts[parts.length - 1];
    if (bullet) {
      if (last?.kind === "bullets") last.items.push(bullet[1]);
      else parts.push({ kind: "bullets", items: [bullet[1]] });
    } else if (last?.kind === "paragraph" && last.text) {
      last.text += ` ${line}`;
    } else {
      parts.push({ kind: "paragraph", text: line });
    }
  }
  return parts.filter((p) => p.kind === "bullets" || p.text);
}

/** Every word the learner reads in an element (for counting). */
function elementItemsText(el: SlideElement): string[] {
  switch (el.type) {
    case "knowledge_check":
      return [el.explanation];
    case "accordion":
      return el.items.map((i) => i.body);
    case "flip_cards":
      return el.items.map((i) => i.back);
  }
}

// ── Normalizers ────────────────────────────────────────────────────────

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

export function newId(prefix = "i") {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${r}`;
}
const idOf = (v: unknown, prefix: string) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : newId(prefix));

export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (/^mailto:[^\s]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Pictures, video files and audio must come from https (in practice, our training-media bucket or Unsplash). */
export function safeMediaUrl(src: unknown): string {
  const href = safeHref(src);
  return href && href.startsWith("https://") ? href : "";
}

/** A photo credit, kept only if its links really are Unsplash's. */
export function normalizeCredit(raw: unknown): PhotoCredit | null {
  const c = (raw ?? null) as Record<string, unknown> | null;
  if (!c || c.source !== "unsplash") return null;
  const onUnsplash = (u: unknown) => {
    const href = safeHref(u);
    if (!href) return "";
    const host = new URL(href).hostname;
    return host === "unsplash.com" || host.endsWith(".unsplash.com") ? href : "";
  };
  const name = str(c.name, 120).trim();
  const profileUrl = onUnsplash(c.profileUrl);
  const photoUrl = onUnsplash(c.photoUrl);
  return name && profileUrl && photoUrl ? { source: "unsplash", name, profileUrl, photoUrl } : null;
}

/** A privacy-friendly embed URL for YouTube or Vimeo, or a direct video file. */
export function videoSource(url: string): { kind: "embed"; src: string } | { kind: "file"; src: string } | null {
  const href = safeHref(url);
  if (!href) return null;
  const u = new URL(href);
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (/^[\w-]{6,20}$/.test(id)) return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:\/video)?\/(\d+)(?:\/([0-9a-f]+))?/);
    if (m) return { kind: "embed", src: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ""}` };
  }
  if (u.protocol === "https:" && /\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return null;
}

export function normalizeObjectives(raw: unknown): Objective[] {
  return list(raw, OBJECTIVES_MAX + 2)
    .map((o) => {
      if (typeof o === "string") return { text: o.slice(0, 300), bloom: bloomFor(o) };
      const x = (o ?? {}) as Record<string, unknown>;
      const text = str(x.text, 300);
      const bloom = BLOOM_LEVELS.includes(x.bloom as Bloom) ? (x.bloom as Bloom) : bloomFor(text);
      return { text, bloom };
    })
    .slice(0, OBJECTIVES_MAX);
}

export function normalizeFurtherReading(raw: unknown): FurtherReading[] {
  return list(raw, 10)
    .map((item) => {
      const x = (item ?? {}) as Record<string, unknown>;
      return { title: str(x.title, 200), url: str(x.url, 1000).trim(), note: str(x.note, 300) };
    })
    .filter((r) => r.title.trim() || r.url);
}

/** Only https links go to learners. */
export function isReadingUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeVoice(raw: unknown): { id: string; name: string } | null {
  const v = (raw ?? null) as Record<string, unknown> | null;
  return v && typeof v.id === "string" && /^[\w-]{1,64}$/.test(v.id) ? { id: v.id, name: str(v.name, 100) || "Voice" } : null;
}

export function newElement(type: ElementType): SlideElement {
  switch (type) {
    case "knowledge_check": {
      const a = newId("o");
      return { type, question: "", options: [{ id: a, text: "" }, { id: newId("o"), text: "" }, { id: newId("o"), text: "" }], correctId: a, explanation: "" };
    }
    case "accordion":
      return { type, items: [{ id: newId("a"), title: "", body: "" }, { id: newId("a"), title: "", body: "" }] };
    case "flip_cards":
      return { type, items: [{ id: newId("c"), front: "", back: "" }, { id: newId("c"), front: "", back: "" }] };
  }
}

export function normalizeElement(raw: unknown): SlideElement | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.type) {
    case "knowledge_check": {
      const options = list(e.options, 5).map((o) => {
        const x = (o ?? {}) as Record<string, unknown>;
        return { id: idOf(x.id, "o"), text: str(x.text, 300) };
      });
      const correctId = options.some((o) => o.id === e.correctId) ? String(e.correctId) : (options[0]?.id ?? "");
      return { type: "knowledge_check", question: str(e.question, 400), options, correctId, explanation: str(e.explanation, 600) };
    }
    case "accordion":
      return {
        type: "accordion",
        items: list(e.items, 6).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "a"), title: str(x.title, 120), body: str(x.body, 600) };
        }),
      };
    case "flip_cards":
      return {
        type: "flip_cards",
        items: list(e.items, 6).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "c"), front: str(x.front, 120), back: str(x.back, 600) };
        }),
      };
    default:
      return null;
  }
}

/** Shape only: the server checks every chunk id against the library before saving. */
export function normalizeCitations(raw: unknown): Citation[] {
  const seen = new Set<string>();
  return list(raw, 8)
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return { chunkId: str(x.chunkId, 64), label: str(x.label, 300) };
    })
    .filter((c) => /^[0-9a-f-]{36}$/i.test(c.chunkId) && !seen.has(c.chunkId) && seen.add(c.chunkId));
}

export const LAYOUTS: SlideLayout[] = ["photo", "left", "right", "text"];

/** The editable fields of a slide, cleaned up (what the builder sends to save). */
export type SlidePatch = Partial<Pick<Slide, "topic" | "title" | "body" | "layout" | "narrationScript" | "element" | "citations">>;

export function normalizeSlidePatch(raw: unknown): SlidePatch {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: SlidePatch = {};
  if ("topic" in p) out.topic = str(p.topic, 200);
  if ("title" in p) out.title = str(p.title, 200);
  if ("body" in p) out.body = str(p.body, 4000);
  if ("layout" in p) out.layout = LAYOUTS.includes(p.layout as SlideLayout) ? (p.layout as SlideLayout) : "photo";
  if ("narrationScript" in p) out.narrationScript = str(p.narrationScript, 5000);
  if ("element" in p) out.element = normalizeElement(p.element);
  if ("citations" in p) out.citations = normalizeCitations(p.citations);
  return out;
}

// ── Database rows ──────────────────────────────────────────────────────

export type SlideRow = {
  id: string;
  position: number;
  topic: string;
  title: string;
  body: string;
  layout: string;
  narration_script: string;
  narration_voiced: string;
  element: unknown;
  citations: unknown;
};
export type MediaRow = {
  id: string;
  slide_id: string;
  role: string;
  kind: string;
  source: string;
  url: string;
  alt: string;
  credit: unknown;
};

export function toMedia(r: MediaRow): Media {
  return {
    id: r.id,
    role: r.role === "narration" ? "narration" : "visual",
    kind: r.kind === "video" ? "video" : r.kind === "audio" ? "audio" : "image",
    source: r.source === "unsplash" ? "unsplash" : r.source === "link" ? "link" : "upload",
    url: safeMediaUrl(r.url),
    alt: str(r.alt, 500),
    credit: normalizeCredit(r.credit),
  };
}

export function toSlides(rows: SlideRow[], media: MediaRow[]): Slide[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const mine = media.filter((m) => m.slide_id === r.id).map(toMedia);
      return {
        id: r.id,
        position: r.position,
        topic: r.topic ?? "",
        title: r.title ?? "",
        body: r.body ?? "",
        layout: LAYOUTS.includes(r.layout as SlideLayout) ? (r.layout as SlideLayout) : "photo",
        narrationScript: r.narration_script ?? "",
        narrationVoiced: r.narration_voiced ?? "",
        element: normalizeElement(r.element),
        citations: normalizeCitations(r.citations),
        visual: mine.find((m) => m.role === "visual") ?? null,
        narration: mine.find((m) => m.role === "narration") ?? null,
      };
    });
}

// ── Storage ────────────────────────────────────────────────────────────

export const MEDIA_BUCKET = "training-media";
/** Track -> Module -> Slide -> files. */
export const moduleFolder = (trackId: string, moduleId: string) => `${trackId}/${moduleId}`;
export const slideFolder = (trackId: string, moduleId: string, slideId: string) => `${trackId}/${moduleId}/${slideId}`;

// ── Checks ─────────────────────────────────────────────────────────────

/** Narration made from an older script. */
export const narrationOutOfDate = (s: Pick<Slide, "narration" | "narrationScript" | "narrationVoiced">) =>
  Boolean(s.narration && s.narrationVoiced.trim() !== s.narrationScript.trim());

/** What needs fixing on one slide, in plain words. Empty means ready. */
export function slideProblems(s: Slide): string[] {
  const out: string[] = [];
  if (!s.title.trim()) out.push("Give the slide a title.");
  const words = countWords(s.body);
  if (words > SLIDE_WORDS_MAX) out.push(`The text is ${words} words. Cut it to ${SLIDE_WORDS_MAX} or fewer.`);
  if (!s.body.trim() && !s.element && !s.visual) out.push("The slide is empty.");
  if (s.layout !== "text" && !s.visual) out.push("Add a picture or video, or set the layout to text only.");
  if (s.visual && s.visual.kind === "image" && !s.visual.alt.trim()) out.push("Describe the picture (alt text) for people using screen readers.");
  if (s.visual?.kind === "video" && s.visual.source === "link" && !videoSource(s.visual.url)) out.push("The video link isn't a YouTube, Vimeo or video file link.");
  if (narrationOutOfDate(s)) out.push("The script changed after the narration was made. Make the narration again.");
  if (s.narrationScript.trim() && !s.narration) out.push("The narration script has no audio yet.");
  const el = s.element;
  if (el) {
    if (el.type === "knowledge_check") {
      if (!el.question.trim()) out.push("The knowledge check needs a question.");
      if (el.options.filter((o) => o.text.trim()).length < 2) out.push("The knowledge check needs a right answer and at least one wrong one.");
      if (!el.options.find((o) => o.id === el.correctId)?.text.trim()) out.push("Mark the right answer.");
    }
    if (el.type === "accordion" && el.items.filter((i) => i.title.trim() && i.body.trim()).length < 2)
      out.push("The accordion needs at least two sections, each with a heading and text.");
    if (el.type === "flip_cards" && el.items.filter((i) => i.front.trim() && i.back.trim()).length < 2)
      out.push("Flip cards need at least two cards, each with a front and a back.");
    for (const t of elementItemsText(el)) {
      if (countWords(t) > ITEM_WORDS_MAX) {
        out.push(`Keep each part of the ${elementLabels[el.type].toLowerCase()} to ${ITEM_WORDS_MAX} words or fewer.`);
        break;
      }
    }
  }
  return out;
}

export interface ModuleForPublishing {
  title: string;
  objectives: Objective[];
  furtherReading: FurtherReading[];
}

/** Problems to fix before publishing. Empty means ready. */
export function publishProblems(m: ModuleForPublishing, slides: Slide[]): string[] {
  const out: string[] = [];
  const objectives = m.objectives.filter((o) => o.text.trim());
  if (objectives.length === 0) out.push("Add the module's learning objectives (one to three).");
  if (slides.length === 0) out.push("Add at least one slide.");
  m.furtherReading.forEach((r, i) => {
    if (!r.title.trim() || !isReadingUrl(r.url)) out.push(`Further reading ${i + 1} needs a title and an https:// link.`);
  });
  slides.forEach((s, i) => {
    for (const p of slideProblems(s)) out.push(`Slide ${i + 1}${s.title.trim() ? ` ("${s.title.trim()}")` : ""}: ${p}`);
  });
  return out;
}

// ── What learners get ──────────────────────────────────────────────────

/** A slide as published: only what the player needs. */
export type PlayerSlide = {
  id: string;
  title: string;
  body: string;
  layout: SlideLayout;
  visual: { kind: "image" | "video"; url: string; alt: string; credit: PhotoCredit | null } | null;
  narration: { url: string; script: string } | null;
  element: SlideElement | null;
  citations: string[];
};
export type Topic = { id: string; title: string; slides: PlayerSlide[] };
export type PlayerContent = {
  format: "slides";
  objectives: Objective[];
  furtherReading: FurtherReading[];
  topics: Topic[];
};

/**
 * Slides grouped into topics, in order: consecutive slides with the same
 * topic go together; a slide with no topic joins the one before it (or
 * starts "Introduction"). Topic ids are stable for the same order of
 * topics, so a republish with the same topics keeps learners' progress.
 */
export function buildPlayerContent(m: ModuleForPublishing, slides: Slide[]): PlayerContent {
  const topics: Topic[] = [];
  for (const s of [...slides].sort((a, b) => a.position - b.position)) {
    const name = s.topic.trim();
    const last = topics[topics.length - 1];
    if (!last || (name && name !== last.title)) topics.push({ id: `t${topics.length + 1}`, title: name || "Introduction", slides: [] });
    const visual = s.layout !== "text" && s.visual && s.visual.kind !== "audio" ? s.visual : null;
    topics[topics.length - 1].slides.push({
      id: s.id,
      title: s.title.trim(),
      body: s.body.trim(),
      layout: visual ? s.layout : "text",
      visual: visual ? { kind: visual.kind as "image" | "video", url: visual.url, alt: visual.alt, credit: visual.credit } : null,
      narration: s.narration ? { url: s.narration.url, script: s.narrationScript.trim() } : null,
      element: s.element,
      citations: s.citations.map((c) => c.label),
    });
  }
  return {
    format: "slides",
    objectives: m.objectives.filter((o) => o.text.trim()),
    furtherReading: m.furtherReading.filter((r) => r.title.trim() && isReadingUrl(r.url)),
    topics,
  };
}

/** A published copy read back from the database (null if it's in the old format). */
export function normalizePlayerContent(raw: unknown): PlayerContent | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || !Array.isArray(r.topics)) return null;
  const topics = list(r.topics, 60).map((t, ti) => {
    const x = (t ?? {}) as Record<string, unknown>;
    return {
      id: idOf(x.id, `t${ti + 1}`),
      title: str(x.title, 200) || "Untitled",
      slides: list(x.slides, 100).map((s) => {
        const y = (s ?? {}) as Record<string, unknown>;
        const v = (y.visual ?? null) as Record<string, unknown> | null;
        const n = (y.narration ?? null) as Record<string, unknown> | null;
        const vUrl = v ? safeMediaUrl(v.url) : "";
        const nUrl = n ? safeMediaUrl(n.url) : "";
        const layout = LAYOUTS.includes(y.layout as SlideLayout) ? (y.layout as SlideLayout) : "text";
        return {
          id: idOf(y.id, "s"),
          title: str(y.title, 200),
          body: str(y.body, 4000),
          layout: vUrl ? layout : "text",
          visual: vUrl ? { kind: v!.kind === "video" ? ("video" as const) : ("image" as const), url: vUrl, alt: str(v!.alt, 500), credit: normalizeCredit(v!.credit) } : null,
          narration: nUrl ? { url: nUrl, script: str(n!.script, 5000) } : null,
          element: normalizeElement(y.element),
          citations: list(y.citations, 8).map((c) => str(c, 300)).filter(Boolean),
        };
      }),
    };
  });
  return {
    format: "slides",
    objectives: normalizeObjectives(r.objectives),
    furtherReading: normalizeFurtherReading(r.furtherReading).filter((f) => f.title.trim() && isReadingUrl(f.url)),
    topics: topics.filter((t) => t.slides.length),
  };
}

export type ModuleCover = { src: string; alt: string; credit: PhotoCredit | null };

/** The module's card photo: the first slide picture. */
export function coverOf(content: PlayerContent): ModuleCover | null {
  for (const t of content.topics)
    for (const s of t.slides) if (s.visual?.kind === "image") return { src: s.visual.url, alt: s.visual.alt, credit: s.visual.credit };
  return null;
}

/** What the learner must finish on a slide before Next: the narration heard to the end, the element done. */
export function slideRequirements(s: PlayerSlide): string[] {
  const ids: string[] = [];
  if (s.narration) ids.push("narration");
  if (s.element) ids.push("element");
  return ids;
}
