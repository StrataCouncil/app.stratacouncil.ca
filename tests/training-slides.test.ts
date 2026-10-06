import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bloomFor,
  bodyParts,
  buildPlayerContent,
  countWords,
  coverOf,
  narrationOutOfDate,
  normalizeCitations,
  normalizeElement,
  normalizeObjectives,
  normalizePlayerContent,
  normalizeSlidePatch,
  publishProblems,
  slideFolder,
  slideProblems,
  toSlides,
  type Slide,
} from "../lib/training/slides.ts";

const slide = (over: Partial<Slide> = {}): Slide => ({
  id: "s1",
  position: 1,
  topic: "Units",
  title: "What you own",
  body: "Your strata lot is yours alone.",
  layout: "text",
  narrationScript: "",
  narrationVoiced: "",
  element: null,
  citations: [],
  visual: null,
  narration: null,
  ...over,
});
const picture = { id: "m1", role: "visual" as const, kind: "image" as const, source: "upload" as const, url: "https://x.test/p.jpg", alt: "A hallway", credit: null };
const audio = { id: "m2", role: "narration" as const, kind: "audio" as const, source: "upload" as const, url: "https://x.test/n.mp3", alt: "", credit: null };
const info = { title: "What a strata is", objectives: [{ text: "Describe a strata lot", bloom: "understand" as const }], furtherReading: [] };

test("words are counted without bullet dashes", () => {
  assert.equal(countWords("- One two\n- three\nfour, five."), 5);
  assert.equal(countWords("  "), 0);
});

test("a slide's text becomes paragraphs and bullet lists", () => {
  assert.deepEqual(bodyParts("Intro line\ncontinues\n\n- one\n- two\nAfter"), [
    { kind: "paragraph", text: "Intro line continues" },
    { kind: "bullets", items: ["one", "two"] },
    { kind: "paragraph", text: "After" },
  ]);
});

test("more than 50 words on a slide can't be published", () => {
  const long = Array.from({ length: 51 }, () => "word").join(" ");
  assert.match(slideProblems(slide({ body: long })).join(" "), /51 words/);
  assert.deepEqual(slideProblems(slide({ body: Array.from({ length: 50 }, () => "word").join(" ") })), []);
});

test("a picture layout needs a described picture", () => {
  assert.match(slideProblems(slide({ layout: "photo" })).join(" "), /Add a picture/);
  assert.match(slideProblems(slide({ layout: "photo", visual: { ...picture, alt: "" } })).join(" "), /Describe the picture/);
  assert.deepEqual(slideProblems(slide({ layout: "photo", visual: picture })), []);
});

test("narration is out of date once the script changes", () => {
  const s = slide({ narration: audio, narrationScript: "Hello there", narrationVoiced: "Hello there" });
  assert.equal(narrationOutOfDate(s), false);
  assert.equal(narrationOutOfDate({ ...s, narrationScript: "Hello again" }), true);
  assert.match(slideProblems({ ...s, narrationScript: "Hello again" }).join(" "), /Update the narration/);
  assert.match(slideProblems(slide({ narrationScript: "No audio yet" })).join(" "), /no audio yet/);
});

test("a knowledge check needs a question, a marked right answer and a wrong one", () => {
  const kc = normalizeElement({ type: "knowledge_check", question: "Who owns the hallway?", options: [{ id: "a", text: "All owners" }, { id: "b", text: "" }], correctId: "a" })!;
  assert.match(slideProblems(slide({ element: kc })).join(" "), /at least one wrong/);
  const ok = normalizeElement({ ...kc, options: [{ id: "a", text: "All owners" }, { id: "b", text: "The owner next door" }] })!;
  assert.deepEqual(slideProblems(slide({ element: ok })), []);
  const unmarked = normalizeElement({ type: "knowledge_check", options: [{ id: "a", text: "x" }], correctId: "zzz" });
  assert.equal(unmarked?.type === "knowledge_check" ? unmarked.correctId : null, "a", "an answer that isn't an option falls back to the first");
  assert.equal(normalizeElement({ type: "hotspots" }), null);
});

test("Bloom levels follow the objective's verb", () => {
  assert.equal(bloomFor("Explain how quorum works"), "understand");
  assert.equal(bloomFor("Apply the standard of care"), "apply");
  assert.equal(bloomFor("Name the documents"), "remember");
  assert.equal(bloomFor("Recognise a conflict"), "remember");
  assert.deepEqual(normalizeObjectives(["Compare two budgets", { text: "Judge a quote", bloom: "evaluate" }, "a", "b"]), [
    { text: "Compare two budgets", bloom: "analyze" },
    { text: "Judge a quote", bloom: "evaluate" },
    { text: "a", bloom: "understand" },
  ]);
});

test("citations keep only library ids, once each", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(normalizeCitations([{ chunkId: id, label: "Strata Property Act, s. 45" }, { chunkId: id }, { chunkId: "s. 1" }]), [
    { chunkId: id, label: "Strata Property Act, s. 45" },
  ]);
});

test("a save only touches the fields it names", () => {
  assert.deepEqual(normalizeSlidePatch({ title: "New", junk: 1 }), { title: "New" });
  assert.deepEqual(normalizeSlidePatch({ layout: "sideways" }), { layout: "photo" });
});

test("publishing needs objectives and slides, and names each problem", () => {
  assert.deepEqual(publishProblems({ ...info, objectives: [] }, []).length, 2);
  assert.deepEqual(publishProblems(info, [slide()]), []);
  assert.match(publishProblems(info, [slide({ title: "" })]).join(" "), /Slide 1: Give the slide a title/);
});

test("slides group into topics; a slide with no topic joins the one before", () => {
  const content = buildPlayerContent(info, [
    slide({ id: "a", position: 1, topic: "" }),
    slide({ id: "b", position: 2, topic: "Units", layout: "photo", visual: picture, narration: audio, narrationScript: " Hi " }),
    slide({ id: "c", position: 3, topic: "" }),
    slide({ id: "d", position: 4, topic: "Common property" }),
  ]);
  assert.deepEqual(
    content.topics.map((t) => [t.id, t.title, t.slides.map((s) => s.id)]),
    [
      ["t1", "Introduction", ["a"]],
      ["t2", "Units", ["b", "c"]],
      ["t3", "Common property", ["d"]],
    ]
  );
  assert.deepEqual(content.topics[1].slides[0].narration, { url: audio.url, script: "Hi" });
  assert.deepEqual(coverOf(content), { src: picture.url, alt: "A hallway", credit: null });
  // What's published reads back the same.
  assert.deepEqual(normalizePlayerContent(JSON.parse(JSON.stringify(content))), content);
  // The old format isn't read by the new player.
  assert.equal(normalizePlayerContent({ sections: [] }), null);
});

test("database rows become slides, in order, with their media", () => {
  const rows = [
    { id: "b", position: 2, topic: "", title: "B", body: "", layout: "left", narration_script: "", narration_voiced: "", element: null, citations: [] },
    { id: "a", position: 1, topic: "", title: "A", body: "", layout: "weird", narration_script: "", narration_voiced: "", element: null, citations: [] },
  ];
  const media = [{ id: "m", slide_id: "b", role: "visual", kind: "image", source: "upload", url: "http://not-https.test/x.jpg", alt: "", credit: null }];
  const slides = toSlides(rows, media);
  assert.deepEqual(slides.map((s) => [s.id, s.layout]), [["a", "photo"], ["b", "left"]]);
  assert.equal(slides[1].visual?.url, "", "only https media is used");
});

test("files live in Track -> Module -> Slide folders", () => {
  assert.equal(slideFolder("trk", "mod", "sld"), "trk/mod/sld");
});
