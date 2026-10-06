/**
 * Council Training content: a module is sections (the player's menu), a
 * section is screens (shown one at a time, with a title bar, a counter
 * and optional narration), and a screen is a stack of typed blocks. This file is the one definition
 * of that shape. The builder edits it, the learner view renders it, and
 * `normalizeModuleContent` is applied to anything coming from the browser
 * or the database, so only known blocks with sane values are ever stored
 * or rendered. Pure: no React, no Supabase.
 */

// ── Rich text (TipTap/ProseMirror JSON, a safe subset) ─────────────────

export type RichMark = { type: "bold" | "italic" | "underline" | "link"; attrs?: { href: string } };
export type RichNode = {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "blockquote"
    | "hardBreak"
    | "text";
  attrs?: { level?: 2 | 3 };
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
};
export type RichDoc = RichNode & { type: "doc" };

export const emptyDoc = (): RichDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

const NODE_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "hardBreak", "text"]);

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

function cleanNode(raw: unknown, depth: number): RichNode | null {
  if (!raw || typeof raw !== "object" || depth > 12) return null;
  const n = raw as Record<string, unknown>;
  const type = String(n.type);
  if (!NODE_TYPES.has(type)) return null;
  if (type === "text") {
    const text = typeof n.text === "string" ? n.text.slice(0, 20000) : "";
    if (!text) return null;
    const marks: RichMark[] = [];
    for (const m of Array.isArray(n.marks) ? n.marks : []) {
      const mt = (m as { type?: string })?.type;
      if (mt === "bold" || mt === "italic" || mt === "underline") marks.push({ type: mt });
      if (mt === "link") {
        const href = safeHref((m as { attrs?: { href?: unknown } }).attrs?.href);
        if (href) marks.push({ type: "link", attrs: { href } });
      }
    }
    return marks.length ? { type: "text", text, marks } : { type: "text", text };
  }
  const node: RichNode = { type: type as RichNode["type"] };
  if (type === "heading") node.attrs = { level: (n.attrs as { level?: number })?.level === 3 ? 3 : 2 };
  if (Array.isArray(n.content)) {
    const children = n.content.map((c) => cleanNode(c, depth + 1)).filter((c): c is RichNode => c !== null);
    if (children.length) node.content = children.slice(0, 500);
  }
  return node;
}

export function normalizeDoc(raw: unknown): RichDoc {
  const content = Array.isArray((raw as { content?: unknown })?.content)
    ? ((raw as { content: unknown[] }).content.map((c) => cleanNode(c, 1)).filter(Boolean) as RichNode[])
    : [];
  return content.length ? { type: "doc", content } : emptyDoc();
}

/** Plain text of a rich doc (search, previews, Stratasphere later). */
export function docText(doc: RichNode | undefined): string {
  if (!doc) return "";
  if (doc.type === "text") return doc.text ?? "";
  const sep = doc.type === "paragraph" || doc.type === "heading" || doc.type === "listItem" ? "\n" : "";
  return (doc.content ?? []).map(docText).join("") + sep;
}

// ── Blocks ─────────────────────────────────────────────────────────────

export type CalloutVariant = "key" | "tip" | "mistake" | "legislation";
export type ScenarioRating = "best" | "okay" | "poor";

export type Block =
  | { id: string; type: "text"; doc: RichDoc }
  | { id: string; type: "callout"; variant: CalloutVariant; title: string; doc: RichDoc; reference: string }
  | { id: string; type: "image"; src: string; alt: string; caption: string; credit: PhotoCredit | null }
  | { id: string; type: "slides"; slides: Slide[] }
  | { id: string; type: "video"; url: string; caption: string; transcript: string }
  | { id: string; type: "audio"; src: string; title: string; transcript: string }
  | { id: string; type: "reveal"; style: RevealStyle; items: { id: string; title: string; body: string }[] }
  | {
      id: string;
      type: "knowledge_check";
      question: string;
      options: { id: string; text: string; feedback: string }[];
      correctId: string;
      explanation: string;
      studyTip: string;
      reference: string;
    }
  | {
      id: string;
      type: "scenario";
      situation: RichDoc;
      prompt: string;
      choices: { id: string; text: string; outcome: string; rating: ScenarioRating }[];
    }
  | { id: string; type: "checklist"; title: string; items: { id: string; text: string }[] }
  | { id: string; type: "summary"; title: string; points: { id: string; text: string }[] }
  | { id: string; type: "table"; caption: string; header: boolean; rows: string[][] }
  | { id: string; type: "features"; items: { id: string; image: string; title: string; text: string }[] }
  | { id: string; type: "gallery"; images: { id: string; src: string; alt: string; caption: string }[] }
  | { id: string; type: "divider" };

/** A slide is an image, optionally narrated (an audio file that plays with it). */
export type Slide = { id: string; src: string; alt: string; caption: string; audio: string; transcript: string };
/** Click-to-reveal: an accordion of sections, or a grid of cards that flip to their answer. */
export type RevealStyle = "accordion" | "cards";

export type BlockType = Block["type"];

/** "full": blocks across the screen. "split": blocks on the left, a picture on the right. */
export type ScreenLayout = "full" | "split";
export type Screen = {
  id: string;
  title: string;
  layout: ScreenLayout;
  /** Which side the picture goes on a split screen (right unless set). */
  imageSide?: "left" | "right";
  /** The picture beside the blocks on a split screen; `hint` is a suggested photo search. */
  image: { src: string; alt: string; credit: PhotoCredit | null; hint: string };
  /**
   * Narration that plays with the screen; Next waits for it to finish.
   * `transcript` is the script (and the captions); `voicedText` is the
   * script the current audio was generated from, so the builder can tell
   * when the audio is out of date.
   */
  narration: { src: string; transcript: string; voicedText: string };
  blocks: Block[];
};
export type Section = { id: string; title: string; screens: Screen[] };
/** Who took a stock photo, linked as the photo library requires (Unsplash: photographer and Unsplash, both linked). */
export type PhotoCredit = { source: "unsplash"; name: string; profileUrl: string; photoUrl: string };

export type ModuleContent = {
  /** The narration voice for generated audio (ElevenLabs voice id and name). */
  voice?: { id: string; name: string } | null;
  /** "After this module you can…": shown on the opening screen and again in the recap. */
  objectives: string[];
  sections: Section[];
  /** Optional links for keen learners, shown at the end of the module. */
  furtherReading?: FurtherReading[];
};

/** A public source to read more: title, an https link, and a line on why it's worth reading. */
export type FurtherReading = { id: string; title: string; url: string; note: string };

/** The block menu, in the order the builder offers them. */
export const blockCatalog: { type: BlockType; label: string; description: string }[] = [
  { type: "text", label: "Text", description: "Paragraphs, headings and lists." },
  { type: "callout", label: "Callout", description: "Key point, tip, common mistake or legislation note." },
  { type: "image", label: "Image", description: "A picture or diagram with a caption." },
  { type: "slides", label: "Slides", description: "Click-through slides (images from Keynote, PowerPoint or Canva), each with optional narration." },
  { type: "video", label: "Video", description: "YouTube, Vimeo or an uploaded file, with a transcript." },
  { type: "audio", label: "Audio", description: "Narration or an interview, with a transcript." },
  { type: "reveal", label: "Click to reveal", description: "Sections or flip cards the learner opens one at a time." },
  { type: "knowledge_check", label: "Knowledge check", description: "A practice question with feedback. Not graded." },
  { type: "scenario", label: "Scenario", description: "A real situation: pick a response, see what happens." },
  { type: "checklist", label: "Checklist", description: "Steps or takeaways the learner can tick off." },
  { type: "summary", label: "Summary", description: "The key points, to close out a section." },
  { type: "features", label: "Icon row", description: "Two to four icons or pictures, each with a short caption." },
  { type: "table", label: "Table", description: "Rows and columns, e.g. deadlines or who does what." },
  { type: "gallery", label: "Image grid", description: "Several pictures with captions." },
  { type: "divider", label: "Divider", description: "A visual break between sections." },
];

export const calloutLabels: Record<CalloutVariant, string> = {
  key: "Key point",
  tip: "Tip",
  mistake: "Common mistake",
  legislation: "Legislation",
};
export const revealStyleLabels: Record<RevealStyle, string> = { accordion: "Sections (accordion)", cards: "Flip cards" };
export const ratingLabels: Record<ScenarioRating, string> = { best: "Best response", okay: "Acceptable", poor: "Not recommended" };

export function newId(prefix = "b") {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${r}`;
}

export function newBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "text":
      return { id, type, doc: emptyDoc() };
    case "callout":
      return { id, type, variant: "key", title: "", doc: emptyDoc(), reference: "" };
    case "image":
      return { id, type, src: "", alt: "", caption: "", credit: null };
    case "slides":
      return { id, type, slides: [] };
    case "video":
      return { id, type, url: "", caption: "", transcript: "" };
    case "audio":
      return { id, type, src: "", title: "", transcript: "" };
    case "reveal":
      return {
        id,
        type,
        style: "accordion",
        items: [
          { id: newId("r"), title: "", body: "" },
          { id: newId("r"), title: "", body: "" },
        ],
      };
    case "summary":
      return { id, type, title: "Summary", points: [{ id: newId("p"), text: "" }] };
    case "table":
      return { id, type, caption: "", header: true, rows: [["", ""], ["", ""]] };
    case "features":
      return {
        id,
        type,
        items: [
          { id: newId("f"), image: "", title: "", text: "" },
          { id: newId("f"), image: "", title: "", text: "" },
          { id: newId("f"), image: "", title: "", text: "" },
        ],
      };
    case "gallery":
      return { id, type, images: [] };
    case "knowledge_check": {
      const a = newId("o"), b = newId("o");
      return { id, type, question: "", options: [{ id: a, text: "", feedback: "" }, { id: b, text: "", feedback: "" }], correctId: a, explanation: "", studyTip: "", reference: "" };
    }
    case "scenario":
      return {
        id,
        type,
        situation: emptyDoc(),
        prompt: "What do you do?",
        choices: [
          { id: newId("c"), text: "", outcome: "", rating: "best" },
          { id: newId("c"), text: "", outcome: "", rating: "poor" },
        ],
      };
    case "checklist":
      return { id, type, title: "", items: [{ id: newId("i"), text: "" }] };
    case "divider":
      return { id, type };
  }
}

/** A copy with fresh ids (duplicate). */
export function cloneBlock(block: Block): Block {
  const copy = JSON.parse(JSON.stringify(block)) as Block;
  copy.id = newId();
  if (copy.type === "slides") copy.slides = copy.slides.map((s) => ({ ...s, id: newId("s") }));
  if (copy.type === "checklist") copy.items = copy.items.map((i) => ({ ...i, id: newId("i") }));
  if (copy.type === "reveal") copy.items = copy.items.map((i) => ({ ...i, id: newId("r") }));
  if (copy.type === "summary") copy.points = copy.points.map((p) => ({ ...p, id: newId("p") }));
  if (copy.type === "features") copy.items = copy.items.map((i) => ({ ...i, id: newId("f") }));
  if (copy.type === "gallery") copy.images = copy.images.map((i) => ({ ...i, id: newId("g") }));
  if (copy.type === "scenario") copy.choices = copy.choices.map((c) => ({ ...c, id: newId("c") }));
  if (copy.type === "knowledge_check") {
    const map = new Map(copy.options.map((o) => [o.id, newId("o")]));
    copy.options = copy.options.map((o) => ({ ...o, id: map.get(o.id)! }));
    copy.correctId = map.get(copy.correctId) ?? copy.options[0]?.id ?? "";
  }
  return copy;
}

// ── Media and video ────────────────────────────────────────────────────

/** A photo credit, kept only if its links really are the photo library's. */
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

/** Narration audio made from an older version of the script. */
export const narrationOutOfDate = (s: Screen) => Boolean(s.narration.src && s.narration.voicedText && s.narration.voicedText !== s.narration.transcript);

/** Images and video files must come from https (in practice, our training-media bucket). */
export function safeMediaUrl(src: unknown): string {
  const href = safeHref(src);
  return href && href.startsWith("https://") ? href : "";
}

/** A privacy-friendly embed URL for YouTube/Vimeo, or a direct video file. */
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

// ── Normalization ──────────────────────────────────────────────────────

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const idOf = (v: unknown, prefix: string) =>
  typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : newId(prefix);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = idOf(b.id, "b");
  switch (b.type) {
    case "text":
      return { id, type: "text", doc: normalizeDoc(b.doc) };
    case "callout":
      return {
        id,
        type: "callout",
        variant: (["key", "tip", "mistake", "legislation"] as const).includes(b.variant as CalloutVariant)
          ? (b.variant as CalloutVariant)
          : "key",
        title: str(b.title, 200),
        doc: normalizeDoc(b.doc),
        reference: str(b.reference, 200),
      };
    case "image":
      return { id, type: "image", src: safeMediaUrl(b.src), alt: str(b.alt, 500), caption: str(b.caption, 500), credit: normalizeCredit(b.credit) };
    case "slides":
      return {
        id,
        type: "slides",
        slides: list(b.slides, 100).map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return {
            id: idOf(o.id, "s"),
            src: safeMediaUrl(o.src),
            alt: str(o.alt, 500),
            caption: str(o.caption, 1000),
            audio: safeMediaUrl(o.audio),
            transcript: str(o.transcript, 20000),
          };
        }),
      };
    case "video":
      return { id, type: "video", url: safeHref(b.url) ?? "", caption: str(b.caption, 500), transcript: str(b.transcript, 50000) };
    case "audio":
      return { id, type: "audio", src: safeMediaUrl(b.src), title: str(b.title, 200), transcript: str(b.transcript, 50000) };
    case "reveal":
      return {
        id,
        type: "reveal",
        style: b.style === "cards" ? "cards" : "accordion",
        items: list(b.items, 20).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "r"), title: str(x.title, 200), body: str(x.body, 4000) };
        }),
      };
    case "summary":
      return {
        id,
        type: "summary",
        title: str(b.title, 200),
        points: list(b.points, 30).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "p"), text: str(x.text, 1000) };
        }),
      };
    case "knowledge_check": {
      const options = list(b.options, 8).map((o) => {
        const x = (o ?? {}) as Record<string, unknown>;
        return { id: idOf(x.id, "o"), text: str(x.text, 500), feedback: str(x.feedback, 1000) };
      });
      const correctId = options.some((o) => o.id === b.correctId) ? String(b.correctId) : (options[0]?.id ?? "");
      return {
        id,
        type: "knowledge_check",
        question: str(b.question, 1000),
        options,
        correctId,
        explanation: str(b.explanation, 2000),
        studyTip: str(b.studyTip, 1000),
        reference: str(b.reference, 300),
      };
    }
    case "scenario":
      return {
        id,
        type: "scenario",
        situation: normalizeDoc(b.situation),
        prompt: str(b.prompt, 300),
        choices: list(b.choices, 6).map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return {
            id: idOf(x.id, "c"),
            text: str(x.text, 500),
            outcome: str(x.outcome, 2000),
            rating: (["best", "okay", "poor"] as const).includes(x.rating as ScenarioRating) ? (x.rating as ScenarioRating) : "okay",
          };
        }),
      };
    case "checklist":
      return {
        id,
        type: "checklist",
        title: str(b.title, 200),
        items: list(b.items, 50).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "i"), text: str(x.text, 500) };
        }),
      };
    case "table": {
      const rows = list(b.rows, 40).map((r) => list(r, 8).map((c) => str(c, 500)));
      const cols = Math.max(1, ...rows.map((r) => r.length));
      return {
        id,
        type: "table",
        caption: str(b.caption, 300),
        header: b.header !== false,
        rows: (rows.length ? rows : [[""]]).map((r) => [...r, ...Array(cols - r.length).fill("")]),
      };
    }
    case "features":
      return {
        id,
        type: "features",
        items: list(b.items, 4).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "f"), image: safeMediaUrl(x.image), title: str(x.title, 120), text: str(x.text, 500) };
        }),
      };
    case "gallery":
      return {
        id,
        type: "gallery",
        images: list(b.images, 24).map((i) => {
          const x = (i ?? {}) as Record<string, unknown>;
          return { id: idOf(x.id, "g"), src: safeMediaUrl(x.src), alt: str(x.alt, 500), caption: str(x.caption, 300) };
        }),
      };
    case "divider":
      return { id, type: "divider" };
    default:
      return null;
  }
}

export function newScreen(title = "New screen"): Screen {
  return {
    id: newId("s"),
    title,
    layout: "full",
    image: { src: "", alt: "", credit: null, hint: "" },
    narration: { src: "", transcript: "", voicedText: "" },
    blocks: [newBlock("text")],
  };
}

export function newSection(title = "New section"): Section {
  return { id: newId("sec"), title, screens: [newScreen("Introduction")] };
}

function normalizeScreen(raw: unknown, seen: Set<string>): Screen {
  const x = (raw ?? {}) as Record<string, unknown>;
  let id = idOf(x.id, "s");
  if (seen.has(id)) id = newId("s");
  seen.add(id);
  const image = (x.image ?? {}) as Record<string, unknown>;
  const narration = (x.narration ?? {}) as Record<string, unknown>;
  return {
    id,
    title: str(x.title, 200) || "Untitled screen",
    layout: x.layout === "split" ? "split" : "full",
    imageSide: x.imageSide === "left" ? "left" : "right",
    image: { src: safeMediaUrl(image.src), alt: str(image.alt, 500), credit: normalizeCredit(image.credit), hint: str(image.hint, 200) },
    narration: {
      src: safeMediaUrl(narration.src),
      transcript: str(narration.transcript, 50000),
      voicedText: str(narration.voicedText, 50000),
    },
    blocks: list(x.blocks, 60).map(normalizeBlock).filter((b): b is Block => b !== null),
  };
}

export function normalizeModuleContent(raw: unknown): ModuleContent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const screenIds = new Set<string>();
  // Early drafts stored { lessons: [{ id, title, blocks }] }: each lesson becomes a one-screen section.
  const rawSections = Array.isArray(r.sections)
    ? r.sections
    : list(r.lessons, 50).map((l) => {
        const x = (l ?? {}) as Record<string, unknown>;
        return { id: x.id, title: x.title, screens: [{ id: `${String(x.id ?? "l")}_1`, title: x.title, blocks: x.blocks }] };
      });
  const sections = list(rawSections, 30).map((sec) => {
    const x = (sec ?? {}) as Record<string, unknown>;
    let id = idOf(x.id, "sec");
    if (seen.has(id)) id = newId("sec");
    seen.add(id);
    return {
      id,
      title: str(x.title, 200) || "Untitled section",
      screens: list(x.screens, 60).map((s) => normalizeScreen(s, screenIds)),
    };
  });
  const voice = (r.voice ?? null) as Record<string, unknown> | null;
  return {
    voice:
      voice && typeof voice.id === "string" && /^[\w-]{1,64}$/.test(voice.id) ? { id: voice.id, name: str(voice.name, 100) || "Voice" } : null,
    objectives: list(r.objectives, 12).map((o) => str(o, 300)).filter((o) => o.trim()),
    sections,
    furtherReading: normalizeFurtherReading(r.furtherReading),
  };
}

export function normalizeFurtherReading(raw: unknown): FurtherReading[] {
  const seen = new Set<string>();
  return list(raw, 10)
    .map((item) => {
      const x = (item ?? {}) as Record<string, unknown>;
      let id = idOf(x.id, "fr");
      if (seen.has(id)) id = newId("fr");
      seen.add(id);
      return { id, title: str(x.title, 200).trim(), url: str(x.url, 1000).trim(), note: str(x.note, 300) };
    })
    .filter((r) => r.title || r.url);
}

/** Only https links go to learners. */
export function isReadingUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Every screen in order, with where it sits (the player's counter is position + 1). */
export function flattenScreens(content: ModuleContent) {
  return content.sections.flatMap((section, sectionIndex) =>
    section.screens.map((screen, indexInSection) => ({ section, sectionIndex, screen, indexInSection }))
  );
}

export type ModuleCover = { src: string; alt: string; credit: PhotoCredit | null };

/** The module's card photo on the training pages: its first screen photo. */
export function moduleCover(content: ModuleContent): ModuleCover | null {
  const first = flattenScreens(content).find(({ screen }) => screen.image.src);
  if (!first) return null;
  const { src, alt, credit } = first.screen.image;
  return { src, alt, credit: normalizeCredit(credit) };
}

// ── Learner rules ──────────────────────────────────────────────────────

/**
 * What the learner must do on a screen before Next: listen to the
 * narration to the end, answer every knowledge check and scenario, open
 * every click-to-reveal item, play audio and uploaded video blocks to the
 * end, and click through every slide. Nothing is graded. (YouTube and
 * Vimeo embeds can't report when they finish, so they don't hold up Next.)
 */
export function screenRequirements(screen: Screen): string[] {
  const ids = screen.narration.src ? ["narration"] : [];
  for (const b of screen.blocks) {
    if (b.type === "knowledge_check" || b.type === "scenario") ids.push(b.id);
    if (b.type === "reveal" && b.items.some((i) => i.title.trim() || i.body.trim())) ids.push(b.id);
    if (b.type === "audio" && b.src) ids.push(b.id);
    if (b.type === "video" && videoSource(b.url)?.kind === "file") ids.push(b.id);
    if (b.type === "slides" && b.slides.some((s) => s.src)) ids.push(b.id);
  }
  return ids;
}

/** Problems to fix before publishing, in plain words. Empty means ready. */
export function publishProblems(content: ModuleContent): string[] {
  const problems: string[] = [];
  if (content.sections.length === 0) problems.push("Add at least one section.");
  if (content.objectives.length === 0) problems.push("Add the module's learning objectives (Module settings).");
  (content.furtherReading ?? []).forEach((r, i) => {
    if (!r.title.trim() || !isReadingUrl(r.url)) problems.push(`Further reading ${i + 1} needs a title and an https:// link.`);
  });
  content.sections.forEach((sec, si) => {
    const inSection = `Section ${si + 1} ("${sec.title}")`;
    if (sec.screens.length === 0) problems.push(`${inSection} has no screens.`);
    sec.screens.forEach((sc, ci) => {
      const where = `${inSection}, screen ${ci + 1} ("${sc.title}")`;
      if (sc.blocks.length === 0) problems.push(`${where} has no content.`);
      if (narrationOutOfDate(sc)) problems.push(`${where}: the script changed after the narration was made. Regenerate the narration.`);
      if (sc.layout === "split" && (!sc.image.src || !sc.image.alt.trim()))
        problems.push(`${where}: the side picture needs a file and a description (alt text).`);
      sc.blocks.forEach((b, bi) => {
        const at = `${where}, block ${bi + 1}`;
        if (b.type === "image" && (!b.src || !b.alt.trim())) problems.push(`${at}: the image needs a file and a description (alt text).`);
        if (b.type === "slides" && (b.slides.length === 0 || b.slides.some((s) => !s.src || !s.alt.trim())))
          problems.push(`${at}: every slide needs an image and a description.`);
        if (b.type === "video" && !videoSource(b.url)) problems.push(`${at}: the video link isn't a YouTube, Vimeo or video file link.`);
        if (b.type === "audio" && !b.src) problems.push(`${at}: the audio block needs a file.`);
        if (b.type === "reveal" && b.items.filter((i) => i.title.trim() && i.body.trim()).length < 1)
          problems.push(`${at}: click to reveal needs at least one item with a heading and text.`);
        if (b.type === "summary" && !b.points.some((p) => p.text.trim())) problems.push(`${at}: the summary needs at least one point.`);
        if (b.type === "features" && !b.items.some((i) => i.title.trim() || i.text.trim())) problems.push(`${at}: the icon row needs at least one item.`);
        if (b.type === "features" && b.items.some((i) => i.image && !i.title.trim() && !i.text.trim()))
          problems.push(`${at}: every icon needs a caption.`);
        if (b.type === "gallery" && (b.images.length === 0 || b.images.some((i) => !i.src || !i.alt.trim())))
          problems.push(`${at}: every picture in the grid needs a file and a description.`);
        if (b.type === "table" && !b.rows.some((r) => r.some((c) => c.trim()))) problems.push(`${at}: the table is empty.`);
        if (b.type === "knowledge_check" && (!b.question.trim() || b.options.filter((o) => o.text.trim()).length < 2))
          problems.push(`${at}: the knowledge check needs a question and at least two answers.`);
        if (b.type === "scenario" && b.choices.filter((c) => c.text.trim() && c.outcome.trim()).length < 2)
          problems.push(`${at}: the scenario needs at least two choices, each with an outcome.`);
      });
    });
  });
  return problems;
}
