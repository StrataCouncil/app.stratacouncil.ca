/**
 * Post templates (docs/marketing.md, "Socials editor"): whole carousels to
 * start a post from. The built-in ones are here; the ones saved from the
 * editor are in social_templates (0088). Starting from a template copies
 * it into a new post with fresh ids, so editing the post never changes the
 * template. Pure: shared by the server actions, the list page, and the tests.
 */
import { cloneDesign, designFromSlide, layoutDesign, LAYOUT_KINDS, type LayoutKey, type SlideDesign } from "./design.ts";
import { emptySlide, newSlideId, type SlideKind, type SocialSlide } from "./post.ts";

export const BUILT_IN_TEMPLATES = ["tips", "mythFact", "singleStat", "announcement"] as const;
export type BuiltInTemplate = (typeof BUILT_IN_TEMPLATES)[number];

export interface PostTemplate {
  /** "builtin:<key>" for the ones here, the row's id for saved ones. */
  ref: string;
  name: string;
  description: string;
  slides: SocialSlide[];
  showSlideNumbers: boolean | null;
  builtIn: boolean;
}

type Words = { number?: string; kicker?: string; title: string; body?: string };

function fromKind(kind: SlideKind, w: Words, index: number): SocialSlide {
  const s = { ...emptySlide(kind), number: w.number ?? "", kicker: w.kicker ?? "", title: w.title, body: w.body ?? "" };
  return { ...s, design: designFromSlide(s, { template: "list", theme: "paper", index }) };
}

function fromLayout(key: LayoutKey, w: Words, bg: SlideDesign["bg"]): SocialSlide {
  const s = { ...emptySlide(LAYOUT_KINDS[key]), number: w.number ?? "", kicker: w.kicker ?? "", title: w.title, body: w.body ?? "" };
  return { ...s, design: layoutDesign(key, { ...s, photo: null }, bg) };
}

/** A built-in template, made fresh each time (new ids). The words are placeholders to replace. */
export function builtInTemplate(key: BuiltInTemplate): PostTemplate {
  const ref = `builtin:${key}`;
  switch (key) {
    case "tips":
      return {
        ref,
        builtIn: true,
        name: "Tips carousel",
        description: "A cover, three numbered tips, and a call to action.",
        showSlideNumbers: null,
        slides: [
          fromKind("cover", { number: "3", title: "Things every new council member should know", kicker: "New on council?" }, 0),
          fromKind("point", { number: "1", title: "Read your bylaws", body: "They set out how your strata runs, from meetings to pets." }, 1),
          fromKind("point", { number: "2", title: "Know the budget", body: "The operating fund and the contingency reserve fund work differently." }, 2),
          fromKind("point", { number: "3", title: "Keep good minutes", body: "Owners can ask to see them, and they're the record of what council decided." }, 3),
          fromKind("cta", { title: "Start free council training", body: "Short modules, at your own pace." }, 4),
        ],
      };
    case "mythFact":
      return {
        ref,
        builtIn: true,
        name: "Myth vs fact",
        description: "A cover, a common myth, the fact, and a call to action.",
        showSlideNumbers: null,
        slides: [
          fromKind("cover", { title: "Strata myths, busted", kicker: "Myth vs fact" }, 0),
          fromLayout("quote", { title: "Council can make any decision it likes.", kicker: "Myth" }, "cream"),
          fromLayout("sideBySide", { kicker: "Fact", title: "Council acts for the owners", body: "Some decisions need the owners' vote at a general meeting, as set out in the Strata Property Act and your bylaws." }, "paper"),
          fromLayout("bigCta", { title: "Learn the basics, free", body: "Council Training at stratacouncil.ca." }, "cream"),
        ],
      };
    case "singleStat":
      return {
        ref,
        builtIn: true,
        name: "Single stat",
        description: "One slide with one big number. Slide numbers are off.",
        showSlideNumbers: false,
        slides: [fromLayout("stat", { number: "73%", title: "Your headline about the number", body: "Source: where the number comes from" }, "cream")],
      };
    case "announcement":
      return {
        ref,
        builtIn: true,
        name: "Announcement",
        description: "A full-bleed photo cover, the details, and a call to action.",
        showSlideNumbers: null,
        slides: [
          fromLayout("fullPhoto", { kicker: "New", title: "Your announcement in a few words" }, "ink"),
          fromLayout("checklist", { title: "What's new", body: "The first thing that's new\nThe second thing that's new\nThe third thing that's new" }, "cream"),
          fromLayout("bigCta", { title: "See it for yourself", body: "At stratacouncil.ca." }, "cream"),
        ],
      };
  }
}

export function builtInTemplates(): PostTemplate[] {
  return BUILT_IN_TEMPLATES.map(builtInTemplate);
}

/** A template's slides for a new post: fresh slide and layer ids, so the post and the template never share anything. */
export function slidesFromTemplate(slides: SocialSlide[]): SocialSlide[] {
  return slides.map((s) => ({ ...s, id: newSlideId(), design: s.design ? cloneDesign(s.design) : null }));
}

export function isBuiltInRef(ref: string): BuiltInTemplate | null {
  const key = ref.startsWith("builtin:") ? ref.slice(8) : "";
  return (BUILT_IN_TEMPLATES as readonly string[]).includes(key) ? (key as BuiltInTemplate) : null;
}
