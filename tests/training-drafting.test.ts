import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftProblems,
  EXAMPLE_NAMES,
  namesForSlides,
  normalizeOutline,
  normalizePastedBlueprint,
  numberSources,
  outlineRequest,
  slideRequest,
  strayNames,
  toDraftedSlide,
  type OutlineSlide,
} from "../lib/training/drafting.ts";

const planned = (over: Partial<OutlineSlide> = {}): OutlineSlide => ({
  id: "o1",
  topic: "Units",
  title: "Who owns the hallway",
  point: "Hallways are common property.",
  element: "none",
  sourceIds: ["P1"],
  ...over,
});
const known = new Set(["P1", "P2"]);

test("every slide gets its own names, and no name repeats across a module", () => {
  const names = namesForSlides(12, "module-a").flat();
  assert.equal(new Set(names).size, 24);
  assert.ok(names.every((n) => EXAMPLE_NAMES.includes(n)));
  // A different module gets a different order.
  assert.notDeepEqual(namesForSlides(3, "module-b"), namesForSlides(3, "module-a"));
  // Same module, same names: a retried slide keeps its names.
  assert.deepEqual(namesForSlides(3, "module-a"), namesForSlides(3, "module-a"));
});

test("Priya is in the list, but only as one name among many", () => {
  assert.ok(EXAMPLE_NAMES.includes("Priya"));
  assert.ok(EXAMPLE_NAMES.length >= 50);
  const priyas = Array.from({ length: 20 }, (_, i) => namesForSlides(10, `m${i}`).flat()).filter((n) => n.includes("Priya")).length;
  assert.ok(priyas < 20, "Priya isn't in every module");
});

test("a name the slide wasn't given is caught", () => {
  assert.deepEqual(strayNames("Priya asks council about the roof.", ["Wei", "Rosa"]), ["Priya"]);
  assert.deepEqual(strayNames("Wei asks Rosa.", ["Wei", "Rosa"]), []);
  assert.match(draftProblems({ title: "t", body: "Priya asks.", narrationScript: "", element: null, sourceIds: [] }, planned(), ["Wei", "Rosa"]).join(" "), /Use only the names Wei and Rosa/);
});

test("more than 50 words is sent back once with the count", () => {
  const long = Array.from({ length: 52 }, () => "word").join(" ");
  assert.match(draftProblems({ title: "t", body: long, narrationScript: "", element: null, sourceIds: [] }, planned(), []).join(" "), /52 words/);
});

test("a knowledge check needs exactly three answers, one marked right", () => {
  const d = toDraftedSlide(
    {
      title: "Check",
      body: "Who owns it?",
      narrationScript: "",
      element: { type: "knowledge_check", question: "Who owns the hallway?", answers: [{ text: "All owners", correct: true }, { text: "The neighbour", correct: false }], explanation: "It's common property.", items: [] },
      sourceIds: ["P1", "P9"],
    },
    planned({ element: "knowledge_check" }),
    known
  );
  assert.equal(d.element?.type, "knowledge_check");
  assert.deepEqual(d.sourceIds, ["P1"], "only sources it was given");
  assert.match(draftProblems(d, planned({ element: "knowledge_check" }), []).join(" "), /exactly three answers/);
});

test("the plan decides whether a slide has an element", () => {
  const raw = { title: "T", body: "B", narrationScript: "", element: { type: "accordion", question: "", answers: [], explanation: "", items: [{ heading: "A", text: "a" }] }, sourceIds: [] };
  assert.equal(toDraftedSlide(raw, planned({ element: "none" }), known).element, null);
  assert.equal(toDraftedSlide(raw, planned({ element: "accordion" }), known).element?.type, "accordion");
  assert.match(draftProblems(toDraftedSlide({ ...raw, element: { ...raw.element, items: [] } }, planned({ element: "flip_cards" }), known), planned({ element: "flip_cards" }), []).join(" "), /needs its flip cards/);
});

test("outlines keep only sources they were given, and slides with titles", () => {
  const o = normalizeOutline({ slides: [{ topic: "A", title: "One", point: "p", element: "zzz", sourceIds: ["P1", "P7"] }, { title: "" }] }, known);
  assert.equal(o.length, 1);
  assert.equal(o[0].element, "none");
  assert.deepEqual(o[0].sourceIds, ["P1"]);
});

test("sources are numbered in the order given", () => {
  const p = (id: string) => ({ id, documentId: "d", documentTitle: "Strata Property Act", kind: "act" as const, label: `s. ${id}`, text: "x", chunkIndex: 0, similarity: 1 });
  const { ids, text } = numberSources([p("a"), p("b")]);
  assert.equal(ids.get("P2"), "b");
  assert.match(text, /<source id="P1" document="Strata Property Act" section="s. a">/);
});

test("the outline follows the blueprint, in order, and nothing else", () => {
  const req = outlineRequest({
    title: "What a strata is",
    summary: "",
    track: "Strata Basics",
    minutes: 12,
    objectives: [{ text: "Describe a strata lot", bloom: "understand" }],
    blueprint: [
      { topic: "What a strata is", teach: "A type of real estate, and the corporation of all the owners.", activity: "none" },
      { topic: "How a strata is created", teach: "The strata plan is deposited at the Land Title Office.", activity: "knowledge_check" },
    ],
    existingTitles: [],
  });
  assert.match(req, /Describe a strata lot \(Understand: the learner can say what something is and why it matters, in their own words; go no deeper\)/);
  assert.match(req, /1\. \[What a strata is\] A type of real estate/);
  assert.match(req, /2\. \[How a strata is created\] \(knowledge_check\)/);
  assert.match(req, /Follow the blueprint exactly/);
  assert.match(req, /lawsuits/);
  assert.doesNotMatch(req, /BOPPPS/);
  const slide = slideRequest({ module: { title: "M", objectives: [] }, outline: [planned()], index: 0, written: [], names: ["Wei", "Rosa"] });
  assert.match(slide, /use only these first names: Wei and Rosa/);
  assert.match(slide, /It teaches only this: Hallways are common property\./);
});

test("a pasted outline is held to the builder's limits", () => {
  const b = normalizePastedBlueprint({
    title: "Module 1 — What Is a Strata Corporation?",
    summary: "  What a strata is.  ",
    estimatedMinutes: 17.4,
    objectives: [
      { text: "Define a strata corporation", bloom: "remember" },
      { text: "Explain who owns what", bloom: "understand" },
      { text: "Describe the council's role", bloom: "nonsense" },
      { text: "A fourth", bloom: "apply" },
    ],
    originalObjectives: ["One", "Two", "", "Three"],
    blueprint: [
      { topic: "Owning together", teach: "Owners share common property.", activity: "flip_cards" },
      { topic: "Quiz", teach: "Three questions.", activity: "slideshow" },
    ],
    furtherReading: [
      { title: "Strata Property Act", url: "https://www.bclaws.gov.bc.ca/", note: "" },
      { title: "Old link", url: "http://example.com/", note: "" },
    ],
  });
  assert.equal(b.title, "What Is a Strata Corporation?");
  assert.equal(b.summary, "What a strata is.");
  assert.equal(b.estimatedMinutes, 17);
  assert.equal(b.objectives.length, 3);
  assert.equal(b.objectives[2].text, "Describe the council's role");
  assert.ok(["remember", "understand", "apply", "analyze", "evaluate", "create"].includes(b.objectives[2].bloom));
  assert.deepEqual(b.originalObjectives, ["One", "Two", "Three"]);
  assert.equal(b.blueprint[0].activity, "flip_cards");
  assert.equal(b.blueprint[1].activity, "none");
  assert.equal(b.furtherReading[0].url, "https://www.bclaws.gov.bc.ca/");
  assert.equal(b.furtherReading[1].url, "");
});

test("a pasted outline with nothing usable comes back empty", () => {
  const b = normalizePastedBlueprint("not an object");
  assert.equal(b.title, "");
  assert.equal(b.estimatedMinutes, null);
  assert.deepEqual(b.blueprint, []);
  assert.deepEqual(b.objectives, []);
});
