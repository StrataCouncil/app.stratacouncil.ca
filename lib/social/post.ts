/**
 * Social posts (0068): the carousel builder's model, shared by the editor,
 * the server actions, the export and the tests. Pure: no I/O.
 *
 * A post is a set of slides plus a caption per platform. The same slides
 * are drawn for every platform, with that platform's handle in the footer
 * and, for TikTok, at 9:16 instead of 4:5. Every link carries campaign
 * tags: utm_source is the platform, utm_medium "social", utm_campaign the
 * post's campaign, utm_content the slide or caption it belongs to.
 */

export const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_INFO: Record<
  Platform,
  { label: string; handle: string; profile: string; width: number; height: number; maxSlides: number; linksInPost: boolean }
> = {
  instagram: { label: "Instagram", handle: "@stratacouncil.ca", profile: "https://www.instagram.com/stratacouncil.ca/", width: 1080, height: 1350, maxSlides: 20, linksInPost: false },
  facebook: { label: "Facebook", handle: "@stratacouncil.ca", profile: "https://www.facebook.com/stratacouncil.ca", width: 1080, height: 1350, maxSlides: 20, linksInPost: true },
  linkedin: { label: "LinkedIn", handle: "@stratacouncil", profile: "https://www.linkedin.com/company/stratacouncil/", width: 1080, height: 1350, maxSlides: 20, linksInPost: true },
  tiktok: { label: "TikTok", handle: "@stratacouncil", profile: "https://www.tiktok.com/@stratacouncil", width: 1080, height: 1920, maxSlides: 35, linksInPost: false },
  x: { label: "X", handle: "@strata_council", profile: "https://x.com/strata_council", width: 1080, height: 1350, maxSlides: 4, linksInPost: true },
};

export const TEMPLATES = ["list", "story", "editorial"] as const;
export type Template = (typeof TEMPLATES)[number];
export const TEMPLATE_LABELS: Record<Template, string> = { list: "Numbered list", story: "Story", editorial: "Editorial" };

export const THEMES = ["paper", "accent", "ink"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = { paper: "Paper", accent: "Accent", ink: "Ink" };

export const AUDIENCES = ["council", "managers", "owners"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = {
  council: "Strata council members",
  managers: "Strata managers",
  owners: "Strata owners",
};

/** Where the call to action and the links point. */
export const DESTINATIONS = {
  home: { label: "Home page", url: "https://www.stratacouncil.ca/", shown: "stratacouncil.ca" },
  signup: { label: "Free training sign-up", url: "https://app.stratacouncil.ca/signup", shown: "stratacouncil.ca" },
  demo: { label: "Request a demo", url: "https://www.stratacouncil.ca/#demo", shown: "stratacouncil.ca" },
} as const;
export type Destination = keyof typeof DESTINATIONS;

export const SLIDE_KINDS = ["cover", "point", "quote", "photo", "cta"] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];
export const SLIDE_KIND_LABELS: Record<SlideKind, string> = {
  cover: "Cover",
  point: "Point",
  quote: "Quote or stat",
  photo: "Photo",
  cta: "Call to action",
};

export interface PhotoCredit {
  source: "unsplash";
  name: string;
  profileUrl: string;
  photoUrl: string;
}

export interface SocialPhoto {
  /** An uploaded file's path in the social-media bucket, or null for an Unsplash photo. */
  path: string | null;
  /** Unsplash's image URL; for uploads, filled with a short-lived signed link when loaded (never saved). */
  src: string;
  alt: string;
  credit: PhotoCredit | null;
  /** "cutout": a transparent PNG placed on the slide. "cover": the photo fills its frame. */
  fit: "cover" | "cutout";
}

export interface SocialSlide {
  id: string;
  kind: SlideKind;
  /** The big number on list slides ("1"), or a stat ("73%") on quote slides. */
  number: string;
  /** A short line above the title. */
  kicker: string;
  title: string;
  body: string;
  /** Words to search Unsplash with, suggested by the draft. */
  photoQuery: string;
  photo: SocialPhoto | null;
}

export interface Captions {
  text: Partial<Record<Platform, string>>;
  hashtags: Partial<Record<Platform, string[]>>;
}

export interface SocialPost {
  id: string;
  title: string;
  campaign: string;
  template: Template;
  theme: Theme;
  destination: Destination;
  topic: string;
  audience: Audience;
  slides: SocialSlide[];
  captions: Captions;
  createdAt: string;
  updatedAt: string;
}

export const LIMITS = { title: 120, kicker: 80, slideTitle: 140, body: 600, number: 8, photoQuery: 100, caption: 2200, hashtags: 30, slides: 15 } as const;

const clip = (v: unknown, max: number) => String(v ?? "").replace(/\r\n?/g, "\n").slice(0, max);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

/** "Your first council meeting!" -> "your-first-council-meeting". */
export function campaignSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "post";
}

export function isCampaign(v: string) {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(v);
}

function safeUrl(v: unknown, hosts: string[]): string {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && hosts.includes(u.hostname) ? u.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeCredit(v: unknown): PhotoCredit | null {
  const c = v as Record<string, unknown> | null;
  if (!c || c.source !== "unsplash") return null;
  const name = clip(c.name, 120).trim();
  const profileUrl = safeUrl(c.profileUrl, ["unsplash.com"]);
  const photoUrl = safeUrl(c.photoUrl, ["unsplash.com"]);
  return name && profileUrl && photoUrl ? { source: "unsplash", name, profileUrl, photoUrl } : null;
}

/** A photo as saved: an upload keeps only its path (its link is signed when loaded); an Unsplash photo keeps its link and credit. */
export function normalizePhoto(v: unknown, postId: string): SocialPhoto | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  const alt = clip(p.alt, 300);
  const fit = p.fit === "cutout" ? "cutout" : "cover";
  if (typeof p.path === "string" && p.path) {
    const path = p.path;
    if (!path.startsWith(`${postId}/`) || path.includes("..") || path.length > 200) return null;
    return { path, src: "", alt, credit: null, fit };
  }
  const src = safeUrl(p.src, ["images.unsplash.com"]);
  const credit = normalizeCredit(p.credit);
  return src && credit ? { path: null, src, alt, credit, fit } : null;
}

export function newSlideId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `s_${Date.now().toString(36)}_${random}`;
}

export function emptySlide(kind: SlideKind = "point"): SocialSlide {
  return { id: newSlideId(), kind, number: "", kicker: "", title: "", body: "", photoQuery: "", photo: null };
}

export function normalizeSlides(v: unknown, postId: string): SocialSlide[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.slice(0, LIMITS.slides).flatMap((raw) => {
    const s = raw as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return [];
    let id = typeof s.id === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(s.id) ? s.id : newSlideId();
    if (seen.has(id)) id = newSlideId();
    seen.add(id);
    return [
      {
        id,
        kind: oneOf(SLIDE_KINDS, s.kind, "point"),
        number: clip(s.number, LIMITS.number).trim(),
        kicker: clip(s.kicker, LIMITS.kicker),
        title: clip(s.title, LIMITS.slideTitle),
        body: clip(s.body, LIMITS.body),
        photoQuery: clip(s.photoQuery, LIMITS.photoQuery),
        photo: normalizePhoto(s.photo, postId),
      },
    ];
  });
}

/** "#Strata Council" -> "#stratacouncil": letters and digits only, one leading #. */
export function normalizeHashtag(v: unknown): string {
  const word = String(v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 60);
  return word && /[A-Za-z]/.test(word) ? `#${word}` : "";
}

export function normalizeCaptions(v: unknown): Captions {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const text = (c.text && typeof c.text === "object" ? c.text : {}) as Record<string, unknown>;
  const tags = (c.hashtags && typeof c.hashtags === "object" ? c.hashtags : {}) as Record<string, unknown>;
  const out: Captions = { text: {}, hashtags: {} };
  for (const p of PLATFORMS) {
    if (typeof text[p] === "string") out.text[p] = clip(text[p], LIMITS.caption);
    if (Array.isArray(tags[p])) {
      const list = [...new Set((tags[p] as unknown[]).map(normalizeHashtag).filter(Boolean))].slice(0, LIMITS.hashtags);
      out.hashtags[p] = list;
    }
  }
  return out;
}

/** Fields a save may change, checked and trimmed to size. */
export function normalizePostPatch(v: unknown, postId: string) {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Partial<Pick<SocialPost, "title" | "campaign" | "template" | "theme" | "destination" | "slides" | "captions">> = {};
  if ("title" in p) out.title = clip(p.title, LIMITS.title).trim();
  if ("campaign" in p) out.campaign = campaignSlug(String(p.campaign ?? ""));
  if ("template" in p) out.template = oneOf(TEMPLATES, p.template, "list");
  if ("theme" in p) out.theme = oneOf(THEMES, p.theme, "paper");
  if ("destination" in p) out.destination = oneOf(Object.keys(DESTINATIONS) as Destination[], p.destination, "home");
  if ("slides" in p) out.slides = normalizeSlides(p.slides, postId);
  if ("captions" in p) out.captions = normalizeCaptions(p.captions);
  return out;
}

export function toPost(r: Record<string, unknown>): SocialPost {
  const id = String(r.id);
  return {
    id,
    title: String(r.title ?? ""),
    campaign: String(r.campaign ?? "post"),
    template: oneOf(TEMPLATES, r.template, "list"),
    theme: oneOf(THEMES, r.theme, "paper"),
    destination: oneOf(Object.keys(DESTINATIONS) as Destination[], r.destination, "home"),
    topic: String(r.topic ?? ""),
    audience: oneOf(AUDIENCES, r.audience, "council"),
    slides: normalizeSlides(r.slides, id),
    captions: normalizeCaptions(r.captions),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

// ── Links ──────────────────────────────────────────────────────────────

/** A link with the post's campaign tags. `content` names the slide ("slide-3") or "caption". */
export function utmLink(base: string, tags: { platform: Platform; campaign: string; content: string }): string {
  const u = new URL(base);
  u.searchParams.set("utm_source", tags.platform);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", tags.campaign);
  u.searchParams.set("utm_content", tags.content);
  // A #fragment stays after the query, so /#demo still scrolls to the form.
  return u.toString();
}

export function slideLink(post: Pick<SocialPost, "destination" | "campaign">, platform: Platform, slideIndex: number) {
  return utmLink(DESTINATIONS[post.destination].url, { platform, campaign: post.campaign, content: `slide-${slideIndex + 1}` });
}

export function captionLink(post: Pick<SocialPost, "destination" | "campaign">, platform: Platform) {
  return utmLink(DESTINATIONS[post.destination].url, { platform, campaign: post.campaign, content: "caption" });
}

/** The Instagram and TikTok profile link (links in their posts aren't clickable). */
export function bioLink(platform: Platform) {
  return utmLink(DESTINATIONS.home.url, { platform, campaign: "bio", content: "profile" });
}

// ── Captions ───────────────────────────────────────────────────────────

/** Which slides go to a platform: X takes 4 (the cover, the first two after it, and the call to action). */
export function slidesFor(platform: Platform, slides: SocialSlide[]): { slide: SocialSlide; index: number }[] {
  const all = slides.map((slide, index) => ({ slide, index }));
  const max = PLATFORM_INFO[platform].maxSlides;
  if (all.length <= max) return all;
  const last = all[all.length - 1];
  return [...all.slice(0, max - 1), last];
}

/** The full post text for a platform: caption, link (where links work), hashtags. */
export function postText(post: Pick<SocialPost, "destination" | "campaign" | "captions">, platform: Platform): string {
  const caption = (post.captions.text[platform] ?? "").trim();
  const tags = (post.captions.hashtags[platform] ?? []).join(" ");
  const link = PLATFORM_INFO[platform].linksInPost ? captionLink(post, platform) : "";
  const linkLine = link ? link : PLATFORM_INFO[platform].linksInPost ? "" : "Link in bio.";
  return [caption, linkLine, tags].filter(Boolean).join("\n\n");
}

/**
 * X's count: every link counts as 23 characters (t.co), everything else as
 * written (emoji and wide characters count 2, which we don't use).
 */
export function xLength(text: string): number {
  let n = 0;
  const parts = text.split(/(https?:\/\/\S+)/g);
  for (const part of parts) {
    if (/^https?:\/\//.test(part)) n += 23;
    else for (const ch of part) n += ch.codePointAt(0)! > 0x10ff ? 2 : 1;
  }
  return n;
}

// ── House rules ────────────────────────────────────────────────────────

/** Anything in the post's text that breaks the brand rules, as messages to fix before posting. */
export function wordingProblems(texts: string[]): string[] {
  const all = texts.join("\n");
  const problems: string[] = [];
  if (/\p{Extended_Pictographic}/u.test(all)) problems.push("Remove the emoji: posts don't use emoji.");
  if (/pipeda/i.test(all)) problems.push("Remove PIPEDA: we refer to BC's PIPA only.");
  if (/precedent/i.test(all)) problems.push("Remove the precedent pool: it isn't advertised.");
  if (/\b(we are|we're|stratacouncil(\.ca)? is|stratasphere is)\s+(soc ?2|iso ?27001)/i.test(all)) {
    problems.push("Security: say our hosting provider is SOC 2 / ISO 27001 compliant, never that we are.");
  }
  if (/\b(hipaa|gdpr|military[- ]grade|unhackable|100% secure)\b/i.test(all)) {
    problems.push("Security: use only the agreed claims (hosting provider SOC 2 / ISO 27001, 2FA, row-level security, bank-grade encryption, data stored in Canada, PII stripped before Stratasphere).");
  }
  return problems;
}

/** Every piece of text in a post, for the wording check. */
export function postTexts(post: Pick<SocialPost, "title" | "slides" | "captions">): string[] {
  return [
    post.title,
    ...post.slides.flatMap((s) => [s.number, s.kicker, s.title, s.body]),
    ...Object.values(post.captions.text).map((t) => t ?? ""),
    ...Object.values(post.captions.hashtags).flatMap((t) => t ?? []),
  ];
}

// ── Export ─────────────────────────────────────────────────────────────

export function slideFileName(index: number) {
  return `slide-${String(index + 1).padStart(2, "0")}.png`;
}

/** The text file in each platform's folder: what to post, every tracked link, alt text and credits. */
export function platformTextFile(post: SocialPost, platform: Platform): string {
  const info = PLATFORM_INFO[platform];
  const chosen = slidesFor(platform, post.slides);
  const text = postText(post, platform);
  const lines: string[] = [];
  lines.push(`${post.title || "Untitled post"} — ${info.label} (${info.handle})`, "");
  lines.push("POST TEXT", "---------", text, "");
  if (platform === "x") lines.push(`Length on X: ${xLength(text)} of 280`, "");
  if (!info.linksInPost) {
    lines.push("Links in posts aren't clickable here. Profile link (set once, in the bio):", bioLink(platform), "");
  }
  lines.push("SLIDES (upload in this order)", "-----------------------------");
  for (const [n, { slide, index }] of chosen.entries()) {
    lines.push(`${slideFileName(n)}  ${[slide.number, slide.title].filter(Boolean).join(" ") || SLIDE_KIND_LABELS[slide.kind]}`);
    lines.push(`  Link: ${slideLink(post, platform, index)}`);
    if (slide.photo?.alt) lines.push(`  Alt text: ${slide.photo.alt}`);
  }
  if (platform === "linkedin") lines.push("", "carousel.pdf: upload as a document post. Each page links to its slide's tracked link.");
  const credits = creditLines(post);
  if (credits.length) lines.push("", "PHOTO CREDITS", "-------------", ...credits);
  return lines.join("\n") + "\n";
}

export function creditLines(post: Pick<SocialPost, "slides">): string[] {
  const seen = new Set<string>();
  return post.slides.flatMap((s) => {
    const c = s.photo?.credit;
    if (!c || seen.has(c.photoUrl)) return [];
    seen.add(c.photoUrl);
    return [`Photo by ${c.name} on Unsplash: ${c.photoUrl}`];
  });
}

/** The ZIP's top-level README: the campaign and every link. */
export function readmeFile(post: SocialPost): string {
  const lines = [
    post.title || "Untitled post",
    "=".repeat(Math.max(10, (post.title || "Untitled post").length)),
    "",
    `Campaign: ${post.campaign}`,
    `Links go to: ${DESTINATIONS[post.destination].label} (${DESTINATIONS[post.destination].url})`,
    "",
    "One folder per platform, each with its slides and a text file to post from.",
    "",
    "CAPTION LINKS",
    ...PLATFORMS.map((p) => `${PLATFORM_INFO[p].label}: ${PLATFORM_INFO[p].linksInPost ? captionLink(post, p) : bioLink(p) + " (bio)"}`),
  ];
  const credits = creditLines(post);
  if (credits.length) lines.push("", "PHOTO CREDITS", ...credits);
  return lines.join("\n") + "\n";
}
