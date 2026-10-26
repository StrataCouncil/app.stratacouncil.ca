import { AUDIENCE_LABELS, DESTINATIONS, PLATFORMS, TEMPLATE_LABELS, type Audience, type Destination, type SocialSlide, type Template } from "./post.ts";

/**
 * The AI's first draft of a social post (0068): slides and a caption per
 * platform, written for staff to edit. Only the topic and the post's own
 * text go to the AI; nothing from any strata.
 */

export const DRAFT_SYSTEM = `You write carousel posts for StrataCouncil.ca, a platform for strata councils and strata managers in British Columbia, Canada. It offers free council training, meeting software for councils (Meeting Mode), a document library, and Stratasphere(TM), an AI assistant that answers from a strata's own records and BC strata law.

Write from the jobs-to-be-done view: name the job the reader is trying to get done (run a good first meeting, find a past decision, get ready for winter, answer an owner), what gets in the way, and what helps. Give people what they need; don't list features and benefits. Plain, warm, confident Canadian English. Short sentences.

Carousels: one idea per slide. The cover is the hook: a promise or a question the reader wants answered, often with a number ("5 things..."). Body slides deliver it, each able to stand on its own. The last slide is the call to action: what to do next and why, pointing to StrataCouncil.ca.

Rules, never broken:
- No emoji anywhere.
- BC law only: the Strata Property Act, the Standard Bylaws, PIPA. Never PIPEDA. Don't invent section numbers; cite a section only if you are sure of it.
- Security claims only in these words: our hosting provider is SOC 2 / ISO 27001 compliant; two-step verification is available; row-level security; bank-grade encryption; data stored in Canada; personal information is stripped before anything reaches Stratasphere. Never say StrataCouncil.ca itself is SOC 2 or ISO 27001 certified.
- Don't mention any precedent pool or data shared between stratas.
- No made-up statistics, testimonials or customer names.
- Write "Stratasphere" (without the TM mark) in slides and captions.

Hashtags: include #stratasphere wherever the post touches the assistant, records, meetings or governance (most posts). Add a few relevant ones such as #bcstrata #stratacouncil #strataliving #condolife #propertymanagement; fewer on LinkedIn (3 to 5) and X (1 or 2), more on Instagram and TikTok (5 to 10). No # inside caption sentences.

Captions, one per platform: Instagram and TikTok can't link, so end with a nudge to the link in the profile; Facebook and LinkedIn get a short paragraph (the link is added automatically after it); X must stay under 230 characters (a link is added after it). Don't put links or hashtags in caption text; they're added separately.`;

const slideSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["cover", "point", "quote", "photo", "cta"] },
    number: { type: "string", description: "List number ('1') on point slides, a stat on quote slides, or empty." },
    kicker: { type: "string", description: "A short line above the title, up to 8 words, or empty." },
    title: { type: "string", description: "Up to 9 words." },
    body: { type: "string", description: "Up to 40 words; empty on the cover if the title is enough." },
    photoQuery: { type: "string", description: "2 to 4 words to search a stock photo library with, or empty if the slide needs no photo." },
  },
  required: ["kind", "number", "kicker", "title", "body", "photoQuery"],
} as const;

const platformStrings = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(PLATFORMS.map((p) => [p, { type: "string" }])),
  required: [...PLATFORMS],
};

const platformTags = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(PLATFORMS.map((p) => [p, { type: "array", items: { type: "string" } }])),
  required: [...PLATFORMS],
};

export const draftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "The post's working title, for the staff list." },
    campaign: { type: "string", description: "A short lower-case campaign name with hyphens, e.g. first-council-meeting." },
    slides: { type: "array", items: slideSchema },
    captions: platformStrings,
    hashtags: platformTags,
  },
  required: ["title", "campaign", "slides", "captions", "hashtags"],
} as const;

export const slideRewriteSchema = { type: "object", additionalProperties: false, properties: { slide: slideSchema }, required: ["slide"] } as const;

export interface DraftRequest {
  topic: string;
  audience: Audience;
  template: Template;
  slideCount: number;
  destination: Destination;
}

export function draftRequest(r: DraftRequest): string {
  const count = Math.min(10, Math.max(4, Math.floor(r.slideCount) || 7));
  const shape =
    r.template === "list"
      ? `A numbered list: a cover promising ${count - 2} items, then ${count - 2} point slides numbered 1 to ${count - 2}, then the call to action.`
      : r.template === "story"
        ? "A story: a cover, then slides that move from the situation to the turning point to what changed (point, quote or photo slides), then the call to action. No numbers."
        : "Editorial tips: a cover, then point slides with a two-part title (a short kicker such as 'Know your' and a title such as 'Bylaws'), then the call to action. No numbers.";
  return [
    `Topic: ${r.topic}`,
    `Audience: ${AUDIENCE_LABELS[r.audience]}`,
    `Template: ${TEMPLATE_LABELS[r.template]}. ${shape}`,
    `Slides: exactly ${count}. The first is a cover, the last is a call to action pointing to ${DESTINATIONS[r.destination].label.toLowerCase()} at StrataCouncil.ca.`,
  ].join("\n");
}

export function slideRewriteRequest(input: { topic: string; template: Template; slides: SocialSlide[]; index: number; instruction: string }) {
  const outline = input.slides
    .map((s, i) => `${i + 1}. [${s.kind}] ${[s.number, s.kicker, s.title].filter(Boolean).join(" ")}${s.body ? ` — ${s.body}` : ""}`)
    .join("\n");
  return [
    `Topic: ${input.topic}`,
    `Template: ${TEMPLATE_LABELS[input.template]}`,
    "The carousel so far:",
    outline,
    "",
    `Rewrite slide ${input.index + 1} only, keeping its kind and its place in the carousel.${input.instruction.trim() ? ` What to change: ${input.instruction.trim()}` : ""}`,
  ].join("\n");
}
