import { bloomLabels, type BlueprintStep, type FurtherReading, type Objective, type Slide } from "./slides.ts";

/**
 * A Council Training module as one plain-text file, for reading and
 * reviewing outside the builder (Super Admin: Download as text). Everything
 * a learner reads or hears is here, in order: the module's settings, each
 * slide's text, narration, activity (quiz answers marked), and the
 * Knowledge Base sections it cites, then the further reading. Pictures,
 * audio, and music aren't text, so only their descriptions are listed.
 * Pure: unit-tested in tests/training-export.test.ts.
 */

export interface ExportModule {
  title: string;
  summary: string;
  estimatedMinutes: number | null;
  publishedVersion: number;
  publishedAt: string | null;
  track: { title: string };
  objectives: Objective[];
  blueprint: BlueprintStep[];
  furtherReading: FurtherReading[];
  slides: Slide[];
}

const ACTIVITY_LABELS: Record<string, string> = {
  none: "No activity",
  knowledge_check: "Knowledge check",
  accordion: "Accordion",
  flip_cards: "Flip cards",
};

const rule = (char = "=") => char.repeat(72);

function section(title: string): string {
  return `\n${rule()}\n${title.toUpperCase()}\n${rule()}\n`;
}

function slideElement(s: Slide): string[] {
  const e = s.element;
  if (!e) return [];
  if (e.type === "knowledge_check") {
    const letter = (i: number) => String.fromCharCode(65 + i);
    return [
      "Knowledge check:",
      `  Question: ${e.question}`,
      ...e.options.map((o, i) => `  ${letter(i)}. ${o.text}${o.id === e.correctId ? "   [CORRECT]" : ""}`),
      `  Explanation: ${e.explanation || "(none)"}`,
    ];
  }
  if (e.type === "accordion") {
    return ["Accordion:", ...e.items.flatMap((it, i) => [`  ${i + 1}. ${it.title}`, `     ${it.body}`])];
  }
  return ["Flip cards:", ...e.items.flatMap((it, i) => [`  ${i + 1}. Front: ${it.front}`, `     Back: ${it.back}`])];
}

export function moduleAsText(m: ExportModule, exportedAt: string): string {
  const out: string[] = [];
  out.push(m.title, `Track: ${m.track.title}`);
  out.push(
    m.publishedVersion
      ? `Published version ${m.publishedVersion}${m.publishedAt ? `, ${m.publishedAt.slice(0, 10)}` : ""}`
      : "Not published",
    `Estimated length: ${m.estimatedMinutes ? `${m.estimatedMinutes} minutes` : "not set"}`,
    `Slides: ${m.slides.length}`,
    `Exported ${exportedAt} (this is the module as saved in the builder, which may include changes not yet published)`
  );

  out.push(section("Summary"), m.summary || "(none)");

  out.push(section("Learning objectives"));
  if (m.objectives.length) m.objectives.forEach((o, i) => out.push(`${i + 1}. ${o.text} (${bloomLabels[o.bloom] ?? o.bloom})`));
  else out.push("(none)");

  out.push(section("Blueprint"));
  if (m.blueprint.length) {
    m.blueprint.forEach((b, i) => out.push(`${i + 1}. ${b.topic} [${ACTIVITY_LABELS[b.activity] ?? b.activity}]`, `   ${b.teach}`));
  } else out.push("(none)");

  out.push(section("Slides"));
  const slides = [...m.slides].sort((a, b) => a.position - b.position);
  slides.forEach((s, i) => {
    out.push("", rule("-"), `Slide ${i + 1} of ${slides.length}${s.topic ? `  |  Topic: ${s.topic}` : ""}`, rule("-"));
    out.push(`Title: ${s.title || "(untitled)"}`, "", "Text on the slide:", s.body || "(none)");
    out.push("", "Narration:", s.narrationScript || "(none)");
    if (s.narrationScript && s.narration && s.narrationVoiced !== s.narrationScript) {
      out.push("(The recorded narration was made from an earlier version of this script.)");
    }
    const element = slideElement(s);
    if (element.length) out.push("", ...element);
    out.push("", "Cites:");
    if (s.citations.length) s.citations.forEach((c) => out.push(`  ${c.label}`));
    else out.push("  (nothing)");
    if (s.visual) out.push("", `Picture or video: ${s.visual.alt || "(no description)"}`);
  });
  if (!slides.length) out.push("(no slides)");

  out.push(section("Further reading"));
  if (m.furtherReading.length) {
    m.furtherReading.forEach((r, i) => out.push(`${i + 1}. ${r.title}`, `   ${r.url}`, ...(r.note ? [`   ${r.note}`] : [])));
  } else out.push("(none)");

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** "Strata Buildings: Care, Repairs and Long-Term Planning" to "strata-buildings-care-repairs-and-long-term-planning.txt". */
export function exportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "training-module"}.txt`;
}
