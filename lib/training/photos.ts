import type { Slide } from "./slides.ts";

/**
 * The "Choose photos" pass (components/training/SlideBuilder.tsx): the AI
 * suggests Unsplash search words for each slide that should have a
 * picture, and the author chooses every photo from the results. Unsplash's
 * guidelines need a person to choose; nothing is picked automatically.
 */

/** A picture belongs on slides with no interactive element and a layout that shows one. */
export function wantsPhoto(slide: Pick<Slide, "element" | "layout">): boolean {
  return !slide.element && slide.layout !== "text";
}

export const PHOTO_SYSTEM = `You suggest stock photo searches for slides in a training course for volunteer strata council members in British Columbia, Canada.

For each slide, write words to search Unsplash for one photo that fits the slide's subject: two to five plain words describing something a camera can capture, such as people at a meeting table, a condo building exterior, a leaking pipe or a calculator with invoices.

- Concrete scenes, objects and people. No abstract ideas, no text, signs, documents up close, logos or screens.
- Everyday Canadian residential settings: apartment and townhouse buildings, lobbies, hallways, parkades, meeting rooms.
- Nothing that suggests a particular real person, company or building.
- Vary the searches across the module, so slides don't end up with the same photo.`;

export const photoSearchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["searches"],
  properties: {
    searches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slide", "query"],
        properties: { slide: { type: "integer" }, query: { type: "string" } },
      },
    },
  },
} as const;

/** The request: the module's title and each slide's words, numbered from 1. */
export function photoSearchRequest(moduleTitle: string, slides: Pick<Slide, "topic" | "title" | "body">[]): string {
  const list = slides
    .map((s, i) => `${i + 1}. [${s.topic.trim() || "Slide"}] ${s.title.trim()}\n${s.body.replace(/\s+/g, " ").trim().slice(0, 400)}`)
    .join("\n\n");
  return `Module: ${moduleTitle}\n\nSuggest one photo search for each of these ${slides.length} slides:\n\n${list}`;
}

/**
 * The AI's searches, back on the slides they were for. A slide it skipped
 * or answered badly falls back to its own title.
 */
export function normalizePhotoSearches(raw: unknown, slides: Pick<Slide, "id" | "title">[]): { slideId: string; query: string }[] {
  const byNumber = new Map<number, string>();
  const items = (raw as { searches?: unknown })?.searches;
  if (Array.isArray(items)) {
    for (const it of items) {
      const n = Number((it as { slide?: unknown })?.slide);
      const q = String((it as { query?: unknown })?.query ?? "")
        .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
      if (Number.isInteger(n) && n >= 1 && n <= slides.length && q && !byNumber.has(n)) byNumber.set(n, q);
    }
  }
  return slides.map((s, i) => ({ slideId: s.id, query: byNumber.get(i + 1) ?? s.title.trim().slice(0, 100) }));
}
