import { test } from "node:test";
import assert from "node:assert/strict";
import { exportFileName, moduleAsText, type ExportModule } from "../lib/training/export-text.ts";
import type { Slide } from "../lib/training/slides.ts";

const slide = (over: Partial<Slide>): Slide => ({
  id: "s",
  position: 0,
  topic: "",
  title: "",
  body: "",
  layout: "text",
  narrationScript: "",
  narrationVoiced: "",
  element: null,
  citations: [],
  visual: null,
  narration: null,
  music: null,
  ...over,
});

const mod: ExportModule = {
  title: "Strata Buildings: Care, Repairs and Long-Term Planning",
  summary: "How council looks after the building.",
  estimatedMinutes: 20,
  publishedVersion: 3,
  publishedAt: "2026-11-01T10:00:00Z",
  track: { title: "Council Ready" },
  objectives: [{ text: "Explain when a depreciation report is required", bloom: "understand" }],
  blueprint: [{ topic: "Depreciation reports", teach: "Who must get one, and how often.", activity: "knowledge_check" }],
  furtherReading: [{ title: "CHOA guide", url: "https://choa.bc.ca/", note: "Plain-language overview." }],
  slides: [
    slide({ id: "b", position: 1, title: "Second", body: "Body two." }),
    slide({
      id: "a",
      position: 0,
      topic: "Depreciation reports",
      title: "Every five years",
      body: "A depreciation report is renewed every five years.",
      narrationScript: "Most stratas renew it every five years.",
      citations: [{ chunkId: "c1", label: "Strata Property Regulation, s. 6.21" }],
      element: {
        type: "knowledge_check",
        question: "How often?",
        options: [
          { id: "o1", text: "Every year" },
          { id: "o2", text: "Every five years" },
        ],
        correctId: "o2",
        explanation: "Regulation s. 6.21.",
      },
      visual: { id: "m", role: "visual", kind: "image", source: "upload", url: "x", alt: "A roof under repair", credit: null },
    }),
  ],
};

test("the whole module reads as text, slides in order, quiz answers marked", () => {
  const text = moduleAsText(mod, "November 15, 2026, 9:00 a.m. PT");
  assert.match(text, /^Strata Buildings: Care, Repairs and Long-Term Planning\nTrack: Council Ready\nPublished version 3, 2026-11-01/);
  assert.match(text, /1\. Explain when a depreciation report is required \(Understand\)/);
  assert.match(text, /1\. Depreciation reports \[Knowledge check\]\n   Who must get one, and how often\./);
  assert.ok(text.indexOf("Every five years") < text.indexOf("Second"), "slides in position order");
  assert.match(text, /Slide 1 of 2  \|  Topic: Depreciation reports/);
  assert.match(text, /  A\. Every year\n  B\. Every five years   \[CORRECT\]\n  Explanation: Regulation s\. 6\.21\./);
  assert.match(text, /Cites:\n  Strata Property Regulation, s\. 6\.21/);
  assert.match(text, /Picture or video: A roof under repair/);
  assert.match(text, /Narration:\n\(none\)/, "a slide with no narration says so");
  assert.match(text, /1\. CHOA guide\n   https:\/\/choa\.bc\.ca\/\n   Plain-language overview\./);
});

test("file names come from the title", () => {
  assert.equal(exportFileName(mod.title), "strata-buildings-care-repairs-and-long-term-planning.txt");
  assert.equal(exportFileName("!!!"), "training-module.txt");
});
