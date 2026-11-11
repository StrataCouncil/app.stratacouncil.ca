/**
 * The Socials editor's slide design (docs/marketing.md, "Socials editor"):
 * a slide is a background and a list of layers, placed in percent of the
 * slide, so one design fits 4:5 (Instagram, Facebook, LinkedIn, X) and
 * 9:16 (TikTok). TikTok gets its own positions where they've been moved
 * (`tall`); otherwise they're worked out from the 4:5 ones.
 *
 * Brand kit only: the six brand colours, Fraunces (serif) and Work Sans
 * (sans), and the StrataCouncil.ca logo. Pure: shared by the editor, the
 * export, the server's checks, and the tests.
 */
import type { SocialPhoto, SocialSlide, SlideKind, Template, Theme } from "./post.ts";

export const BRAND = {
  ink: "#1b2a41",
  cream: "#f4ece0",
  paper: "#f8f6f1",
  accent: "#b4602f",
  accentLight: "#e3946a",
  white: "#ffffff",
} as const;
export type BrandColor = keyof typeof BRAND;
export const BRAND_COLORS = Object.keys(BRAND) as BrandColor[];
export const BRAND_LABELS: Record<BrandColor, string> = { ink: "Ink", cream: "Cream", paper: "Paper", accent: "Accent", accentLight: "Accent light", white: "White" };

export type TextRole = "number" | "kicker" | "title" | "body" | "";

interface Base {
  id: string;
  name: string;
  /** Percent of the slide's width (x, w) and height (y, h). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 to 100. */
  opacity: number;
  hidden: boolean;
  locked: boolean;
}
export interface TextLayer extends Base {
  type: "text";
  text: string;
  /** Which of the slide's words it holds, so AI rewrites and layouts can find it. */
  role: TextRole;
  font: "serif" | "sans";
  weight: number;
  /** Percent of the slide's width. */
  size: number;
  lineHeight: number;
  color: BrandColor;
  align: "left" | "center" | "right";
  caps: boolean;
}
export interface ImageLayer extends Base {
  type: "image";
  photo: SocialPhoto | null;
  fit: "cover" | "contain";
  /** Corner radius, percent of the slide's width. */
  radius: number;
  brightness: number;
}
export interface ShapeLayer extends Base {
  type: "shape";
  color: BrandColor;
  radius: number;
}
export interface LogoLayer extends Base {
  type: "logo";
  variant: "mark" | "lockup";
  color: BrandColor;
}
export interface DotsLayer extends Base {
  type: "dots";
  color: BrandColor;
}
/** Text the slide fills in itself: the platform's handle, the slide number, or a swipe cue. */
export interface AutoLayer extends Base {
  type: "auto";
  what: "handle" | "counter" | "swipe";
  size: number;
  color: BrandColor;
  align: "left" | "center" | "right";
}
export type Layer = TextLayer | ImageLayer | ShapeLayer | LogoLayer | DotsLayer | AutoLayer;
export type LayerType = Layer["type"];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SlideDesign {
  bg: BrandColor;
  layers: Layer[];
  /** TikTok (9:16) positions for layers moved there; the rest are worked out. */
  tall: Record<string, Box>;
}

export const DESIGN_LIMITS = { layers: 30, text: 600, name: 60 } as const;
export const WEIGHTS = [300, 400, 500, 600, 700, 800, 900] as const;

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
};
const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback);
const color = (v: unknown, fallback: BrandColor) => pick(BRAND_COLORS, v, fallback);
const str = (v: unknown, max: number) => String(v ?? "").replace(/\r\n?/g, "\n").slice(0, max);

export function newLayerId() {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `l_${r}`;
}

function normalizeBox(v: unknown): Box | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  return { x: num(b.x, -50, 150, 0), y: num(b.y, -50, 150, 0), w: num(b.w, 1, 200, 50), h: num(b.h, 1, 200, 20) };
}

/**
 * A design as saved, checked and trimmed: brand colours and fonts only,
 * sizes in range, photos through normalizePhoto (uploads only from this
 * post's folder, Unsplash only with its credit).
 */
export function normalizeDesign(v: unknown, normalizePhoto: (p: unknown) => SocialPhoto | null): SlideDesign | null {
  const d = v as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.layers)) return null;
  const seen = new Set<string>();
  const layers: Layer[] = [];
  for (const raw of d.layers.slice(0, DESIGN_LIMITS.layers)) {
    const l = raw as Record<string, unknown> | null;
    if (!l || typeof l !== "object") continue;
    let id = typeof l.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(l.id) ? l.id : newLayerId();
    if (seen.has(id)) id = newLayerId();
    seen.add(id);
    const box = normalizeBox(l) ?? { x: 0, y: 0, w: 50, h: 20 };
    const base = { id, name: str(l.name, DESIGN_LIMITS.name) || "Layer", ...box, opacity: num(l.opacity, 0, 100, 100), hidden: l.hidden === true, locked: l.locked === true };
    switch (l.type) {
      case "text":
        layers.push({
          ...base,
          type: "text",
          text: str(l.text, DESIGN_LIMITS.text),
          role: pick(["number", "kicker", "title", "body", ""] as const, l.role, ""),
          font: l.font === "sans" ? "sans" : "serif",
          weight: (WEIGHTS as readonly number[]).includes(Number(l.weight)) ? Number(l.weight) : 700,
          size: num(l.size, 1, 40, 6),
          lineHeight: num(l.lineHeight, 0.8, 2, 1.1),
          color: color(l.color, "ink"),
          align: pick(["left", "center", "right"] as const, l.align, "left"),
          caps: l.caps === true,
        });
        break;
      case "image":
        layers.push({ ...base, type: "image", photo: normalizePhoto(l.photo), fit: l.fit === "contain" ? "contain" : "cover", radius: num(l.radius, 0, 20, 0), brightness: num(l.brightness, 30, 160, 100) });
        break;
      case "shape":
        layers.push({ ...base, type: "shape", color: color(l.color, "accent"), radius: num(l.radius, 0, 50, 0) });
        break;
      case "logo":
        layers.push({ ...base, type: "logo", variant: l.variant === "mark" ? "mark" : "lockup", color: color(l.color, "ink") });
        break;
      case "dots":
        layers.push({ ...base, type: "dots", color: color(l.color, "accent") });
        break;
      case "auto":
        layers.push({
          ...base,
          type: "auto",
          what: pick(["handle", "counter", "swipe"] as const, l.what, "handle"),
          size: num(l.size, 1, 10, 2.6),
          color: color(l.color, "ink"),
          align: pick(["left", "center", "right"] as const, l.align, "left"),
        });
        break;
    }
  }
  const tall: Record<string, Box> = {};
  const rawTall = (d.tall && typeof d.tall === "object" ? d.tall : {}) as Record<string, unknown>;
  for (const l of layers) {
    const b = normalizeBox(rawTall[l.id]);
    if (b) tall[l.id] = b;
  }
  return { bg: color(d.bg, "cream"), layers, tall };
}

// ── Positions on TikTok (9:16) ─────────────────────────────────────────

/** 4:5 is 1080 by 1350 and 9:16 is 1080 by 1920: the same height in pixels is this share of the percent. */
const TALL_RATIO = 1350 / 1920;

/** Where a layer sits on a 9:16 slide: where it was put there, or worked out from its 4:5 place. */
export function tallBox(design: Pick<SlideDesign, "tall">, l: Layer): Box {
  const own = design.tall[l.id];
  if (own) return own;
  // Full-bleed pictures and colour fills stay full-bleed.
  if (l.x <= 0.5 && l.y <= 0.5 && l.w >= 99.5 && l.h >= 99.5) return { x: l.x, y: l.y, w: l.w, h: l.h };
  // The same size in pixels; positions spread over the area TikTok leaves
  // clear (below its top bar, above its caption, left of its buttons).
  const h = l.h * TALL_RATIO;
  const footer = l.y >= 86;
  const y = footer ? 72 + (l.y - 86) * TALL_RATIO : 8 + l.y * 0.62;
  const w = l.type === "text" && l.x + l.w > 84 ? Math.max(10, 84 - l.x) : l.w;
  return { x: l.x, y: Math.round(y * 100) / 100, w, h: Math.round(h * 100) / 100 };
}

export function boxFor(design: Pick<SlideDesign, "tall">, l: Layer, tall: boolean): Box {
  return tall ? tallBox(design, l) : { x: l.x, y: l.y, w: l.w, h: l.h };
}

// ── What's in a design ─────────────────────────────────────────────────

/** Every piece of text, for the wording check. */
export function designTexts(d: SlideDesign | null | undefined): string[] {
  return (d?.layers ?? []).flatMap((l) => (l.type === "text" ? [l.text] : []));
}

/** The photos on the slide, in order. */
export function designPhotos(d: SlideDesign | null | undefined): SocialPhoto[] {
  return (d?.layers ?? []).flatMap((l) => (l.type === "image" && l.photo ? [l.photo] : []));
}

/** The slide's words by role, for its thumbnail label, the export's file list, and AI rewrites. */
export function roleTexts(d: SlideDesign | null | undefined): Pick<SocialSlide, "number" | "kicker" | "title" | "body"> {
  const out = { number: "", kicker: "", title: "", body: "" };
  for (const l of d?.layers ?? []) if (l.type === "text" && l.role && !out[l.role]) out[l.role] = l.text;
  return out;
}

/** Put new words into the layers that hold them (an AI rewrite of the slide); the design stays as it is. */
export function withRoleTexts(d: SlideDesign, texts: Partial<Record<Exclude<TextRole, "">, string>>): SlideDesign {
  return { ...d, layers: d.layers.map((l) => (l.type === "text" && l.role && texts[l.role] !== undefined ? { ...l, text: texts[l.role]! } : l)) };
}

/** A copy with fresh layer ids (a saved layout used again), keeping TikTok positions. */
export function cloneDesign(d: SlideDesign): SlideDesign {
  const ids = new Map(d.layers.map((l) => [l.id, newLayerId()]));
  const tall: Record<string, Box> = {};
  for (const [k, v] of Object.entries(d.tall)) if (ids.has(k)) tall[ids.get(k)!] = { ...v };
  return { bg: d.bg, layers: d.layers.map((l) => ({ ...l, id: ids.get(l.id)! })), tall };
}

// ── New layers ─────────────────────────────────────────────────────────

const base = (name: string, box: Box): Base => ({ id: newLayerId(), name, ...box, opacity: 100, hidden: false, locked: false });

export function newLayer(type: LayerType, onBg: BrandColor): Layer {
  const ink = onBg === "ink" || onBg === "accent" ? "white" : "ink";
  switch (type) {
    case "text":
      return { ...base("Text", { x: 9, y: 40, w: 82, h: 12 }), type: "text", text: "Your text", role: "", font: "serif", weight: 800, size: 7, lineHeight: 1.05, color: ink, align: "left", caps: false };
    case "image":
      return { ...base("Photo", { x: 20, y: 25, w: 60, h: 48 }), type: "image", photo: null, fit: "cover", radius: 2.6, brightness: 100 };
    case "shape":
      return { ...base("Shape", { x: 9, y: 46, w: 16, h: 0.7 }), type: "shape", color: onBg === "accent" ? "cream" : "accent", radius: 0.2 };
    case "logo":
      return { ...base("Logo", { x: 9, y: 88, w: 40, h: 5 }), type: "logo", variant: "lockup", color: ink };
    case "dots":
      return { ...base("Pattern", { x: 60, y: -6, w: 46, h: 36 }), type: "dots", color: onBg === "accent" ? "ink" : "accent" };
    case "auto":
      return { ...base("Handle", { x: 9, y: 92, w: 50, h: 3.4 }), type: "auto", what: "handle", size: 2.6, color: ink, align: "left" };
  }
}

// ── From the old slide kinds (and the AI's drafts) ─────────────────────

/** The background a slide had under the old templates, in brand colours. */
export function startingBackground(template: Template, theme: Theme, kind: SlideKind, index: number): BrandColor {
  if (template === "editorial") {
    if (kind === "cta") return theme === "ink" ? "accent" : "ink";
    return theme === "ink" ? "ink" : "paper";
  }
  const [a, b]: [BrandColor, BrandColor] = theme === "accent" ? ["accent", "cream"] : theme === "ink" ? ["ink", "cream"] : ["cream", "accent"];
  if (kind === "cta") return theme === "paper" ? "accent" : a;
  return index % 2 === 0 ? a : b;
}

function onColours(bg: BrandColor) {
  const dark = bg === "ink" || bg === "accent";
  return { text: (dark ? "white" : "ink") as BrandColor, hi: (bg === "accent" ? "cream" : bg === "ink" ? "accentLight" : "accent") as BrandColor, muted: (dark ? "cream" : "ink") as BrandColor };
}

/** A font size (percent of width) that shrinks as the text grows, like the old templates. */
function fitSize(base: number, text: string, comfortable: number, min: number) {
  const len = Math.max(1, text.trim().length);
  return len <= comfortable ? base : Math.max(min, Math.round(base * Math.sqrt(comfortable / len) * 10) / 10);
}

/** A text box's height for its words, at that size and width (percent of the 4:5 slide). */
function textHeight(text: string, size: number, w: number, lineHeight: number, charWidth = 0.52) {
  const perLine = Math.max(1, Math.floor(w / (size * charWidth)));
  const lines = text.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  // Percent of width to percent of height: 1080 / 1350.
  return Math.round(lines * size * lineHeight * 0.8 * 10) / 10 + 1;
}

/**
 * A slide's starting design from its kind and words: what the AI drafts,
 * a new slide, and every slide made before the editor had layers. Close to
 * the old templates, in layers that can be moved and changed.
 */
export function designFromSlide(slide: Pick<SocialSlide, "kind" | "number" | "kicker" | "title" | "body" | "photo">, opts: { template: Template; theme: Theme; index: number }): SlideDesign {
  const bg = startingBackground(opts.template, opts.theme, slide.kind, opts.index);
  const c = onColours(bg);
  const layers: Layer[] = [];
  const add = <L extends Layer>(l: L) => (layers.push(l), l);
  const text = (name: string, role: TextRole, t: string, o: Partial<TextLayer> & Box) =>
    add({ ...base(name, o), type: "text", text: t, role, font: "serif", weight: 900, size: 9, lineHeight: 1, color: c.text, align: "left", caps: false, ...o } as TextLayer);
  const footer = () => {
    add({ ...base("Handle", { x: 8.9, y: 92.6, w: 50, h: 3.4 }), type: "auto", what: "handle", size: 2.6, color: c.muted, align: "left", opacity: 80 });
    add({ ...base("Slide number", { x: 61, y: 92.6, w: 30, h: 3.4 }), type: "auto", what: "counter", size: 2.6, color: c.muted, align: "right", opacity: 80 });
  };
  const photo = slide.photo;
  const pattern = opts.template !== "editorial";

  if (slide.kind === "photo") {
    add({ ...base("Photo", { x: 0, y: 0, w: 100, h: 100 }), type: "image", photo, fit: "cover", radius: 0, brightness: 100, locked: Boolean(photo) });
    add({ ...base("Shade", { x: 0, y: 0, w: 100, h: 100 }), type: "shape", color: "ink", radius: 0, opacity: photo ? 55 : 100 });
    if (slide.kicker) text("Kicker", "kicker", slide.kicker, { x: 8.9, y: 9, w: 82, h: 4, font: "sans", weight: 700, size: 2.6, caps: true, color: "white", lineHeight: 1.1 });
    const size = fitSize(11, slide.title, 22, 6);
    text("Title", "title", slide.title, { x: 8.9, y: 50, w: 82, h: textHeight(slide.title, size, 82, 1), size, color: "white" });
    if (slide.body) text("Text", "body", slide.body, { x: 8.9, y: 72, w: 74, h: textHeight(slide.body, 3.8, 74, 1.4), font: "sans", weight: 500, size: 3.8, lineHeight: 1.4, color: "cream" });
    add({ ...base("Handle", { x: 8.9, y: 92.6, w: 50, h: 3.4 }), type: "auto", what: "handle", size: 2.6, color: "white", align: "left", opacity: 85 });
    add({ ...base("Slide number", { x: 61, y: 92.6, w: 30, h: 3.4 }), type: "auto", what: "counter", size: 2.6, color: "white", align: "right", opacity: 85 });
    return { bg, layers, tall: {} };
  }

  if (slide.kind === "cta") {
    const size = fitSize(9.6, slide.title, 26, 6);
    const h = textHeight(slide.title, size, 82, 1.02);
    text("Title", "title", slide.title, { x: 8.9, y: 26, w: 82, h, size, lineHeight: 1.02, align: "center" });
    if (slide.body) text("Text", "body", slide.body, { x: 14, y: 28 + h, w: 72, h: textHeight(slide.body, 3.6, 72, 1.4), font: "sans", weight: 500, size: 3.6, lineHeight: 1.4, color: c.muted, align: "center" });
    add({ ...base("Button", { x: 24, y: 66, w: 52, h: 8.6 }), type: "shape", color: bg === "ink" ? "accent" : "ink", radius: 6 });
    text("Button label", "", "stratacouncil.ca", { x: 24, y: 68.4, w: 52, h: 4.4, font: "sans", weight: 700, size: 3.4, align: "center", color: "white", lineHeight: 1.1 });
    add({ ...base("Logo", { x: 30, y: 86, w: 40, h: 5 }), type: "logo", variant: "lockup", color: c.text });
    return { bg, layers, tall: {} };
  }

  if (pattern) add({ ...base("Pattern", slide.kind === "cover" ? { x: -5.5, y: -4.4, w: 39, h: 31 } : [{ x: 62, y: -6, w: 43, h: 34 }, { x: -7, y: 64, w: 41, h: 33 }, { x: 60, y: 60, w: 44, h: 36 }][opts.index % 3]), type: "dots", color: c.hi, opacity: 30 });

  let y = slide.kind === "cover" ? 13 : 9.5;
  const textW = photo && slide.kind !== "cover" ? 59 : 82;
  if (slide.number) {
    const size = slide.kind === "quote" ? fitSize(21, slide.number, 4, 13) : slide.kind === "cover" ? 26 : 22;
    text(slide.kind === "quote" ? "Stat" : "Number", "number", slide.number, { x: 8.9, y, w: 82, h: size * 0.8 * 0.9 + 1, size, lineHeight: 0.85, color: c.hi });
    y += size * 0.8 * 0.9 + 3;
  }
  const titleSize = slide.kind === "cover" ? fitSize(12.2, slide.title, 22, 6) : fitSize(9.6, slide.title, 24, 5.6);
  const titleH = textHeight(slide.title, titleSize, textW, 1);
  text("Title", "title", slide.title, { x: 8.9, y, w: textW, h: titleH, size: titleSize });
  y += titleH + 2.5;
  if (slide.kicker) {
    const ks = slide.kind === "cover" ? fitSize(5, slide.kicker, 34, 3.5) : 2.6;
    const kh = textHeight(slide.kicker, ks, 76, 1.12, 0.6);
    text("Kicker", "kicker", slide.kicker, { x: 8.9, y, w: 76, h: kh, font: "sans", weight: 800, size: ks, caps: true, lineHeight: 1.12, color: c.hi });
    y += kh + 2.5;
  }
  add({ ...base("Rule", { x: 8.9, y, w: 15.7, h: 0.67 }), type: "shape", color: c.hi, radius: 0.2 });
  y += 3;
  if (slide.body) {
    const bs = fitSize(3.7, slide.body, slide.kind === "cover" ? 60 : 150, 2.8);
    const bw = photo ? 46 : textW;
    text("Text", "body", slide.body, { x: 8.9, y, w: bw, h: textHeight(slide.body, bs, bw, 1.42), font: "sans", weight: slide.kind === "cover" ? 600 : 400, size: bs, lineHeight: 1.42, color: c.muted });
  }
  if (photo) {
    const cutout = photo.fit === "cutout";
    add({
      ...base("Photo", cutout ? { x: 54, y: 52, w: 46, h: 48 } : { x: 52.3, y: 52, w: 38.9, h: 34.8 }),
      type: "image",
      photo,
      fit: cutout ? "contain" : "cover",
      radius: cutout ? 0 : 2.6,
      brightness: 100,
    });
  }
  if (slide.kind === "cover") add({ ...base("Swipe", { x: 8.9, y: 84, w: 40, h: 3.4 }), type: "auto", what: "swipe", size: 2.6, color: c.text, align: "left" });
  footer();
  return { bg, layers, tall: {} };
}
