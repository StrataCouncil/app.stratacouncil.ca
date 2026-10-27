/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import { DESTINATIONS, PLATFORM_INFO, type Platform, type SocialPost, type SocialSlide, type Template, type Theme } from "@/lib/social/post";

/**
 * One carousel slide, drawn at its real size (1080 wide; 1350 tall, or 1920
 * for TikTok). Inline styles only, so the editor's preview and the exported
 * PNG (html-to-image) are the same picture. The fonts come from
 * components/social/fonts.ts on the page.
 */

const SERIF = "var(--font-social-serif), Georgia, serif";
const SANS = "var(--font-social-sans), Arial, sans-serif";

const COLORS = {
  ink: "#1b2a41",
  cream: "#f4ece0",
  paper: "#f8f6f1",
  stone: "#ecebe7",
  accent: "#b4602f",
  accentLight: "#e3946a",
  white: "#ffffff",
};

interface Surface {
  bg: string;
  text: string;
  /** Numbers, rules and highlights. */
  hi: string;
  /** Halftone dots. */
  dots: string;
  muted: string;
}

const SURFACES: Record<"cream" | "accent" | "ink" | "light" | "dark", Surface> = {
  cream: { bg: COLORS.cream, text: COLORS.ink, hi: COLORS.accent, dots: "rgba(180,96,47,0.28)", muted: "rgba(27,42,65,0.72)" },
  accent: { bg: COLORS.accent, text: COLORS.white, hi: COLORS.cream, dots: "rgba(27,42,65,0.30)", muted: "rgba(255,255,255,0.86)" },
  ink: { bg: COLORS.ink, text: COLORS.white, hi: COLORS.accentLight, dots: "rgba(227,148,106,0.30)", muted: "rgba(255,255,255,0.8)" },
  light: { bg: COLORS.stone, text: COLORS.ink, hi: COLORS.accent, dots: "rgba(27,42,65,0.12)", muted: "rgba(27,42,65,0.75)" },
  dark: { bg: COLORS.ink, text: COLORS.white, hi: COLORS.accentLight, dots: "rgba(255,255,255,0.10)", muted: "rgba(255,255,255,0.8)" },
};

/** Which surface a slide sits on: slides alternate, and the call to action always takes the strong one. */
export function surfaceFor(template: Template, theme: Theme, slide: SocialSlide, index: number): Surface {
  if (template === "editorial") {
    if (slide.kind === "cta") return theme === "ink" ? SURFACES.accent : SURFACES.dark;
    return theme === "ink" ? SURFACES.dark : SURFACES.light;
  }
  const [a, b] = theme === "accent" ? (["accent", "cream"] as const) : theme === "ink" ? (["ink", "cream"] as const) : (["cream", "accent"] as const);
  if (slide.kind === "cta") return SURFACES[theme === "paper" ? "accent" : a];
  return SURFACES[index % 2 === 0 ? a : b];
}

/** A size that shrinks as the text grows, so long text still fits its box. */
function fit(base: number, text: string, comfortable: number, min: number) {
  const len = Math.max(1, text.trim().length);
  if (len <= comfortable) return base;
  return Math.max(min, Math.round(base * Math.sqrt(comfortable / len)));
}

function Dots({ color, style }: { color: string; style: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        backgroundImage: `radial-gradient(circle, ${color} 3.2px, transparent 3.8px)`,
        backgroundSize: "20px 20px",
        WebkitMaskImage: "radial-gradient(circle at center, #000 30%, transparent 72%)",
        maskImage: "radial-gradient(circle at center, #000 30%, transparent 72%)",
        ...style,
      }}
    />
  );
}

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="24.32 21.8 144.36 144.38" fill={color} aria-hidden>
      <path d="M46.12,144.38h42.28s-21.8,21.8-21.8,21.8H24.32v-42.28s21.8-21.8,21.8-21.8v42.28ZM104.59,59.82v33.7s42.28,42.28,42.28,42.28v8.58h-42.28s21.8,21.8,21.8,21.8h42.28s0-42.27,0-42.27h0S104.59,59.82,104.59,59.82ZM146.88,85.91l21.8-21.8V21.82s-42.28,0-42.28,0l-21.8,21.8h42.28v42.28ZM88.41,128.18v-33.7s-42.28-42.28-42.28-42.28v-8.58h42.28s-21.8-21.8-21.8-21.8H24.32s0,42.27,0,42.27h0s64.09,64.09,64.09,64.09Z" />
    </svg>
  );
}

function Lockup({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.33, color, fontFamily: SERIF, fontWeight: 600, fontSize: size, letterSpacing: "-0.01em" }}>
      <Mark size={size * 1.51} color={color} />
      StrataCouncil.ca
    </span>
  );
}

function SwipeCue({ color }: { color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 14, fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: "0.12em", textTransform: "uppercase", color }}>
      Swipe
      <svg width="64" height="24" viewBox="0 0 64 24" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 12h58M48 2l12 10-12 10" />
      </svg>
    </span>
  );
}

function Photo({ slide, style, frame = true }: { slide: SocialSlide; style: CSSProperties; frame?: boolean }) {
  const p = slide.photo;
  if (!p?.src) return null;
  const cutout = p.fit === "cutout";
  return (
    <img
      src={p.src}
      alt={p.alt}
      crossOrigin="anonymous"
      style={{
        position: "absolute",
        objectFit: cutout ? "contain" : "cover",
        objectPosition: cutout ? "bottom center" : "center",
        borderRadius: cutout || !frame ? 0 : 28,
        filter: cutout ? "drop-shadow(0 18px 30px rgba(0,0,0,0.18))" : undefined,
        ...style,
      }}
    />
  );
}

export interface SlideCanvasProps {
  post: Pick<SocialPost, "template" | "theme" | "destination">;
  slide: SocialSlide;
  index: number;
  total: number;
  platform: Platform;
}

export function SlideCanvas({ post, slide, index, total, platform }: SlideCanvasProps) {
  const { width, height, handle } = PLATFORM_INFO[platform];
  const tall = height > 1500;
  const s = surfaceFor(post.template, post.theme, slide, index);
  // TikTok covers the bottom and right edge with its own buttons and caption.
  const pad = { top: tall ? 170 : 96, side: 96, right: tall ? 170 : 96, bottom: tall ? 380 : 96 };
  const counter = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const ctx: Ctx = { post, slide, index, total, s, pad, tall, width, height, handle, counter };

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: s.bg,
        color: s.text,
        fontFamily: SANS,
        boxSizing: "border-box",
      }}
    >
      {post.template === "list" ? <ListSlide {...ctx} /> : post.template === "story" ? <StorySlide {...ctx} /> : <EditorialSlide {...ctx} />}
    </div>
  );
}

interface Ctx {
  post: SlideCanvasProps["post"];
  slide: SocialSlide;
  index: number;
  total: number;
  s: Surface;
  pad: { top: number; side: number; right: number; bottom: number };
  tall: boolean;
  width: number;
  height: number;
  handle: string;
  counter: string;
}

function Footer({ s, pad, handle, counter, center = false }: Pick<Ctx, "s" | "pad" | "handle" | "counter"> & { center?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: pad.side,
        right: pad.right,
        bottom: pad.bottom - 40,
        display: "flex",
        justifyContent: center ? "center" : "space-between",
        alignItems: "center",
        gap: 40,
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 28,
        letterSpacing: "0.06em",
        color: s.muted,
        zIndex: 3,
      }}
    >
      <span>{handle}</span>
      {!center && <span>{counter}</span>}
    </div>
  );
}

function Body({ text, s, size, width, align = "left", weight = 400 }: { text: string; s: Surface; size: number; width: number | string; align?: "left" | "center"; weight?: number }) {
  if (!text.trim()) return null;
  return (
    <div style={{ width, fontFamily: SANS, fontWeight: weight, fontSize: size, lineHeight: 1.42, color: s.muted, textAlign: align, whiteSpace: "pre-line" }}>
      {text}
    </div>
  );
}

function Rule({ color, width = 170 }: { color: string; width?: number }) {
  return <div style={{ width, height: 9, background: color, borderRadius: 2 }} />;
}

// ── Numbered list ──────────────────────────────────────────────────────

function ListSlide(c: Ctx) {
  const { slide, s, pad, post } = c;
  const hasPhoto = Boolean(slide.photo?.src);
  const cutout = slide.photo?.fit === "cutout";
  const textWidth = hasPhoto && slide.kind !== "photo" ? 640 : c.width - pad.side - pad.right;
  if (slide.kind === "cta") return <CtaSlide {...c} />;
  if (slide.kind === "photo") return <PhotoFullSlide {...c} />;

  const photoBox: CSSProperties = cutout
    ? { right: 0, bottom: 0, width: c.width * 0.46, height: c.height * 0.48 }
    : { right: pad.right, bottom: pad.bottom + 30, width: 420, height: c.tall ? 620 : 470 };

  if (slide.kind === "cover") {
    const title = slide.title;
    return (
      <>
        <Dots color={s.dots} style={{ left: -60, top: -60, width: 420, height: 420 }} />
        <Dots color={s.dots} style={{ right: -80, bottom: 120, width: 520, height: 520 }} />
        <div style={{ position: "absolute", left: pad.side, right: pad.right, top: pad.top + 40, display: "flex", flexDirection: "column", gap: 34 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            {slide.number && (
              <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 340, lineHeight: 0.8, color: s.hi, letterSpacing: "-0.04em", fontVariationSettings: '"SOFT" 50' }}>{slide.number}</span>
            )}
            <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: fit(slide.number ? 116 : 132, title, 22, 64), lineHeight: 0.98, letterSpacing: "-0.005em", fontVariationSettings: '"SOFT" 50' }}>{title}</span>
          </div>
          {slide.kicker && (
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: fit(54, slide.kicker, 34, 38), lineHeight: 1.12, color: s.hi, textTransform: "uppercase", maxWidth: 820 }}>{slide.kicker}</div>
          )}
        </div>
        <Photo slide={slide} style={photoBox} />
        <div style={{ position: "absolute", left: pad.side, bottom: pad.bottom + 90, display: "flex", flexDirection: "column", gap: 30, maxWidth: hasPhoto ? 480 : 760 }}>
          <Rule color={s.hi} />
          <Body text={slide.body} s={s} size={fit(40, slide.body, 60, 30)} width="100%" weight={600} />
          <SwipeCue color={s.text} />
        </div>
        <Footer {...c} />
      </>
    );
  }

  const title = slide.title;
  const big = slide.kind === "quote" ? slide.number || "" : slide.number;
  return (
    <>
      <Dots color={s.dots} style={index2corner(c.index)} />
      <div style={{ position: "absolute", left: pad.side, top: pad.top + 30, width: textWidth, display: "flex", flexDirection: "column", gap: 30 }}>
        {big && (
          <span
            style={{
              fontFamily: SERIF,
              fontWeight: 900,
              fontSize: slide.kind === "quote" ? fit(230, big, 4, 140) : 240,
              lineHeight: 0.85,
              color: s.hi,
              letterSpacing: "-0.03em",
              fontVariationSettings: '"SOFT" 50',
            }}
          >
            {big}
          </span>
        )}
        <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: fit(104, title, 24, 60), lineHeight: 1.0, letterSpacing: "-0.005em", fontVariationSettings: '"SOFT" 50' }}>{title}</span>
        <Rule color={s.hi} />
        <Body text={slide.body} s={s} size={fit(40, slide.body, 150, 30)} width={hasPhoto ? (cutout ? 470 : 520) : textWidth} />
      </div>
      <Photo slide={slide} style={photoBox} />
      <Footer {...c} />
    </>
  );
}

function index2corner(i: number): CSSProperties {
  const corners: CSSProperties[] = [
    { right: -80, top: -80, width: 460, height: 460 },
    { left: -80, bottom: 80, width: 440, height: 440 },
    { right: -60, bottom: 160, width: 480, height: 480 },
  ];
  return corners[i % corners.length];
}

// ── Story ──────────────────────────────────────────────────────────────

function StoryHeader({ c, color }: { c: Ctx; color: string }) {
  const { pad, slide } = c;
  return (
    <div
      style={{
        position: "absolute",
        left: pad.side,
        right: pad.right,
        top: pad.top - 30,
        display: "flex",
        justifyContent: "space-between",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        zIndex: 3,
      }}
    >
      <span>{slide.kicker || "StrataCouncil.ca"}</span>
      <span>{c.counter}</span>
    </div>
  );
}

function StoryFooter({ c, color }: { c: Ctx; color: string }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: c.pad.bottom - 50, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, zIndex: 3 }}>
      <Mark size={86} color={color} />
      <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: "0.08em", color }}>{c.handle}</span>
    </div>
  );
}

function StorySlide(c: Ctx) {
  const { slide, s, pad } = c;
  if (slide.kind === "cta") return <CtaSlide {...c} />;
  const photo = slide.photo?.src ? slide.photo : null;
  const fullBleed = photo && photo.fit === "cover" && slide.kind !== "cover";
  const title = slide.title.toUpperCase();

  if (fullBleed) {
    return (
      <>
        <Photo slide={slide} frame={false} style={{ inset: 0, width: "100%", height: "100%" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,28,40,0.72) 0%, rgba(20,28,40,0.35) 45%, rgba(20,28,40,0.65) 100%)" }} />
        <StoryHeader c={c} color={COLORS.white} />
        <div style={{ position: "absolute", left: pad.side, right: pad.right, top: pad.top + 70, display: "flex", flexDirection: "column", gap: 30, color: COLORS.white }}>
          <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: fit(96, title, 34, 58), lineHeight: 0.98, letterSpacing: "-0.005em", fontVariationSettings: '"SOFT" 50' }}>{title}</span>
          <Body text={slide.body} s={{ ...s, muted: "rgba(255,255,255,0.92)" }} size={fit(40, slide.body, 120, 30)} width={800} weight={600} />
        </div>
        <StoryFooter c={c} color={COLORS.white} />
      </>
    );
  }

  if (slide.kind === "cover") {
    return (
      <>
        <StoryHeader c={c} color={s.hi} />
        <div
          style={{
            position: "absolute",
            left: pad.side - 10,
            right: pad.right - 10,
            top: pad.top + 90,
            fontFamily: SERIF,
            fontWeight: 900,
            fontSize: fit(190, title, 14, 96),
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            color: s.hi,
            fontVariationSettings: '"SOFT" 50',
            zIndex: 1,
          }}
        >
          {title}
        </div>
        <Photo
          slide={slide}
          style={
            photo?.fit === "cutout"
              ? { left: c.width * 0.15, bottom: 0, width: c.width * 0.7, height: c.height * 0.62, zIndex: 2 }
              : { left: pad.side, right: pad.right, bottom: pad.bottom + 150, width: c.width - pad.side - pad.right, height: c.height * 0.36, zIndex: 2 }
          }
        />
        {!photo && slide.body && (
          <div style={{ position: "absolute", left: pad.side, bottom: pad.bottom + 200, maxWidth: 760 }}>
            <Body text={slide.body} s={s} size={fit(42, slide.body, 90, 32)} width="100%" weight={600} />
          </div>
        )}
        <div style={{ position: "absolute", right: pad.right, bottom: pad.bottom - 46, zIndex: 3 }}>
          <SwipeCue color={s.text} />
        </div>
        <div style={{ position: "absolute", left: pad.side, bottom: pad.bottom - 50, zIndex: 3, fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: "0.08em", color: s.hi }}>
          {c.handle}
        </div>
      </>
    );
  }

  return (
    <>
      <StoryHeader c={c} color={s.hi} />
      <div
        style={{
          position: "absolute",
          left: pad.side,
          right: pad.right,
          top: pad.top + 70,
          bottom: photo ? undefined : pad.bottom + 150,
          display: "flex",
          flexDirection: "column",
          justifyContent: photo ? "flex-start" : "center",
          gap: 30,
        }}
      >
        {slide.number && (
          <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 200, lineHeight: 0.85, color: s.hi, fontVariationSettings: '"SOFT" 50' }}>{slide.number}</span>
        )}
        <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: fit(98, title, 34, 58), lineHeight: 0.98, letterSpacing: "-0.02em", color: s.hi, fontVariationSettings: '"SOFT" 50' }}>{title}</span>
        <Body text={slide.body} s={s} size={fit(40, slide.body, 130, 30)} width={photo ? 560 : 820} />
      </div>
      <Photo
        slide={slide}
        style={photo?.fit === "cutout" ? { right: 0, bottom: 0, width: c.width * 0.6, height: c.height * 0.52 } : { right: pad.right, bottom: pad.bottom + 150, width: 460, height: c.tall ? 640 : 480 }}
      />
      <StoryFooter c={c} color={s.hi} />
    </>
  );
}

// ── Editorial ──────────────────────────────────────────────────────────

function EditorialHeadline({ slide, s, size, align }: { slide: SocialSlide; s: Surface; size: number; align: "left" | "center" }) {
  return (
    <div style={{ textAlign: align, lineHeight: 1.0 }}>
      {slide.kicker && (
        <div style={{ fontFamily: SERIF, fontWeight: 300, fontSize: fit(size, slide.kicker, 16, size * 0.6), letterSpacing: "-0.02em", fontVariationSettings: '"opsz" 144' }}>{slide.kicker}</div>
      )}
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: fit(size * 0.92, slide.title, 18, size * 0.5), letterSpacing: "-0.02em", color: s.text }}>{slide.title}</div>
    </div>
  );
}

function EditorialSlide(c: Ctx) {
  const { slide, s, pad } = c;
  if (slide.kind === "cta") return <CtaSlide {...c} />;
  const photo = slide.photo?.src ? slide.photo : null;

  if (slide.kind === "cover") {
    return (
      <>
        <Photo slide={slide} frame={false} style={{ inset: 0, width: "100%", height: "100%" }} />
        {photo && <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${s.bg} 0%, ${s.bg}e6 46%, ${s.bg}00 78%)` }} />}
        <div style={{ position: "absolute", left: pad.side, top: c.height * 0.3, width: 720, display: "flex", flexDirection: "column", gap: 44 }}>
          <Lockup color={s.text} />
          <EditorialHeadline slide={slide} s={s} size={118} align="left" />
          <Body text={slide.body} s={s} size={fit(36, slide.body, 90, 28)} width={620} />
          <span style={{ alignSelf: "flex-start", background: s.text, color: s.bg, fontFamily: SANS, fontWeight: 600, fontSize: 32, padding: "18px 40px", borderRadius: 999 }}>
            {DESTINATIONS[c.post.destination].shown}
          </span>
        </div>
        <div style={{ position: "absolute", right: pad.right, bottom: pad.bottom - 46 }}>
          <SwipeCue color={s.text} />
        </div>
        <div style={{ position: "absolute", left: pad.side, bottom: pad.bottom - 50, fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: "0.06em", color: s.muted }}>{c.handle}</div>
      </>
    );
  }

  const photoHeight = c.tall ? 760 : 520;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: pad.side,
          right: pad.right,
          top: pad.top - 10,
          bottom: photo ? undefined : pad.bottom + 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: photo ? "flex-start" : "center",
          gap: 46,
        }}
      >
        {photo ? <Lockup color={s.text} size={30} /> : <div style={{ position: "absolute", top: 0 }}><Lockup color={s.text} size={30} /></div>}
        {slide.number && <span style={{ fontFamily: SERIF, fontWeight: 300, fontSize: 120, lineHeight: 0.9, color: s.hi }}>{slide.number}</span>}
        <EditorialHeadline slide={slide} s={s} size={112} align="center" />
        <Body text={slide.body} s={s} size={fit(36, slide.body, 170, 28)} width={820} align="center" />
      </div>
      <Photo slide={slide} frame={false} style={photo?.fit === "cutout" ? { left: pad.side, right: pad.right, bottom: pad.bottom + 10, width: c.width - pad.side - pad.right, height: photoHeight } : { left: 0, right: 0, bottom: pad.bottom + 10, width: "100%", height: photoHeight }} />
      <Footer {...c} />
    </>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────

function PhotoFullSlide(c: Ctx) {
  const { slide, pad } = c;
  return (
    <>
      <Photo slide={slide} frame={false} style={{ inset: 0, width: "100%", height: "100%" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,28,40,0) 35%, rgba(20,28,40,0.82) 100%)" }} />
      <div style={{ position: "absolute", left: pad.side, right: pad.right, bottom: pad.bottom + 40, display: "flex", flexDirection: "column", gap: 24, color: COLORS.white }}>
        {slide.kicker && <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 30, letterSpacing: "0.1em", textTransform: "uppercase" }}>{slide.kicker}</span>}
        <span style={{ fontFamily: SERIF, fontWeight: 900, fontSize: fit(92, slide.title, 30, 56), lineHeight: 1.0, letterSpacing: "-0.005em", fontVariationSettings: '"SOFT" 50' }}>{slide.title}</span>
        <Body text={slide.body} s={{ ...c.s, muted: "rgba(255,255,255,0.9)" }} size={fit(36, slide.body, 120, 28)} width={860} />
      </div>
      <Footer {...c} s={{ ...c.s, muted: "rgba(255,255,255,0.9)" }} />
    </>
  );
}

function CtaSlide(c: Ctx) {
  const { slide, s, pad, post } = c;
  return (
    <>
      <Dots color={s.dots} style={{ right: -90, top: -90, width: 520, height: 520 }} />
      <Dots color={s.dots} style={{ left: -90, bottom: 60, width: 420, height: 420 }} />
      <div style={{ position: "absolute", left: pad.side, right: pad.right, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 44, paddingBottom: c.tall ? 160 : 0 }}>
        <Mark size={130} color={s.text} />
        {slide.kicker && <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 32, letterSpacing: "0.1em", textTransform: "uppercase", color: s.hi }}>{slide.kicker}</span>}
        <span
          style={{
            fontFamily: SERIF,
            fontWeight: 900,
            fontSize: fit(118, slide.title, 22, 64),
            lineHeight: 0.98,
            letterSpacing: "-0.005em",
            fontVariationSettings: '"SOFT" 50',
          }}
        >
          {slide.title}
        </span>
        <Body text={slide.body} s={s} size={fit(40, slide.body, 120, 30)} width={820} />
        <span style={{ alignSelf: "flex-start", background: s.text, color: s.bg, fontFamily: SANS, fontWeight: 700, fontSize: 40, padding: "24px 52px", borderRadius: 999 }}>
          {DESTINATIONS[post.destination].shown}
        </span>
      </div>
      <Footer {...c} />
    </>
  );
}

/** The slide drawn small: a CSS scale of the real-size canvas, so the preview is exactly the export. */
export function ScaledSlide({ scale, children, width, height }: { scale: number; children: ReactNode; width: number; height: number }) {
  return (
    <div style={{ width: width * scale, height: height * scale, overflow: "hidden", borderRadius: 10 * (1 / Math.max(scale, 0.2)) * scale, flexShrink: 0 }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}
