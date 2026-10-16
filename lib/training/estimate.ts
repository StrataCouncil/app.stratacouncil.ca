import type { PlayerContent, PlayerSlide } from "./slides.ts";

/**
 * A module's estimated time, worked out from what learners actually do:
 * listen to each slide's narration (its real length when known), read the
 * slides without narration, work through the activities, and read the
 * introduction and summary pages. Rounded up to whole minutes.
 */
const READING_WPM = 200;
const SPEAKING_WPM = 150; // when a narration's length isn't known yet
const PER_PAGE = 5; // seconds to take in a page and move on
const KNOWLEDGE_CHECK_THINKING = 15;
const PER_CARD = 3; // flipping a card or opening an accordion item
const HOW_THIS_WORKS_WORDS = 60; // the introduction page's fixed text

function words(...texts: string[]) {
  return texts.join(" ").split(/\s+/).filter(Boolean).length;
}

const reading = (n: number) => (n / READING_WPM) * 60;

/** Seconds a learner spends on one slide. narrationSeconds: the audio's measured length, if known. */
export function slideSeconds(slide: PlayerSlide, narrationSeconds: number | null | undefined): number {
  let s = PER_PAGE;
  if (slide.narration) s += narrationSeconds ?? (words(slide.narration.script) / SPEAKING_WPM) * 60;
  else s += reading(words(slide.title, slide.body));
  const e = slide.element;
  if (e?.type === "knowledge_check") s += reading(words(e.question, ...e.options.map((o) => o.text), e.explanation)) + KNOWLEDGE_CHECK_THINKING;
  if (e?.type === "accordion") s += e.items.reduce((t, i) => t + reading(words(i.title, i.body)) + PER_CARD, 0);
  if (e?.type === "flip_cards") s += e.items.reduce((t, i) => t + reading(words(i.front, i.back)) + PER_CARD, 0);
  return s;
}

/** Whole minutes, at least 1. narration: each slide's measured narration length in seconds, by slide id. */
export function estimateMinutes(content: PlayerContent, narration: Map<string, number>): number {
  let s = 0;
  if (content.objectives.length) {
    const objectives = words(...content.objectives.map((o) => o.text));
    s += PER_PAGE + reading(objectives + HOW_THIS_WORKS_WORDS);
    s += PER_PAGE + reading(objectives + words(...content.furtherReading.map((r) => `${r.title} ${r.note}`)));
  }
  for (const topic of content.topics) for (const slide of topic.slides) s += slideSeconds(slide, narration.get(slide.id));
  return Math.max(1, Math.ceil(s / 60));
}
