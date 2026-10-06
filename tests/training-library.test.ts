/** Council Training's use of the Legislation Library. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeHits,
  moduleQueries,
  normalizeFactCheck,
  normalizeIssues,
  passagesAsSources,
  screenFactText,
  type LibraryPassage,
} from "../lib/training/library.ts";
import { newBlock, newScreen } from "../lib/training/content.ts";

const passage = (over: Partial<LibraryPassage>): LibraryPassage => ({
  id: "p",
  documentId: "act",
  documentTitle: "Strata Property Act",
  kind: "act",
  label: "s. 1",
  text: "Strata Property Act, section 1\nText",
  chunkIndex: 0,
  similarity: 0.5,
  ...over,
});

test("search hits merge: each passage once, at its best match, best first", () => {
  const merged = mergeHits([
    [passage({ id: "a", similarity: 0.4 }), passage({ id: "b", similarity: 0.7 })],
    [passage({ id: "a", similarity: 0.9 })],
  ]);
  assert.deepEqual(
    merged.map((p) => [p.id, p.similarity]),
    [
      ["a", 0.9],
      ["b", 0.7],
    ]
  );
});

test("passages become one source document per library document, law first, in the document's order", () => {
  const text = passagesAsSources([
    passage({ id: "g", documentId: "guide", documentTitle: "Strata guide", kind: "guidance", text: "Guide text", chunkIndex: 0 }),
    passage({ id: "s45", text: "Strata Property Act, section 45\nNotice", chunkIndex: 45 }),
    passage({ id: "s3", text: "Strata Property Act, section 3\nDuties", chunkIndex: 3 }),
  ]);
  assert.ok(text.indexOf('title="Strata Property Act (selected sections)" kind="act"') < text.indexOf('title="Strata guide (selected passages)" kind="guidance"'));
  assert.ok(text.indexOf("section 3") < text.indexOf("section 45"));
});

test("module queries: title and scope, then each objective", () => {
  assert.deepEqual(moduleQueries({ title: "What a strata is", summary: "Lots and common property.", objectives: ["Explain unit entitlement", " "] }), [
    "What a strata is. Lots and common property.",
    "Explain unit entitlement",
  ]);
});

test("a screen's fact-check text has what learners read and hear, with references and the right answer", () => {
  const s = newScreen("Notice");
  const kc = newBlock("knowledge_check");
  if (kc.type !== "knowledge_check") throw new Error();
  kc.question = "How much notice for an AGM?";
  kc.options = [
    { id: "a", text: "One week", feedback: "" },
    { id: "b", text: "Two weeks", feedback: "" },
  ];
  kc.correctId = "b";
  kc.reference = "Strata Property Act, s. 45";
  s.blocks = [kc];
  s.narration.transcript = "Owners need two weeks' notice.";
  const text = screenFactText(s);
  assert.match(text, /Option \(correct\): Two weeks/);
  assert.match(text, /\[Reference: Strata Property Act, s\. 45\]/);
  assert.match(text, /Narration: Owners need two weeks' notice\./);
});

test("fact-check issues: only real screens, known kinds, and a note", () => {
  const issues = normalizeIssues(
    {
      issues: [
        { screenId: "s1", quote: "one week", kind: "contradicted", note: "The Act says two weeks.", library: "s. 45" },
        { screenId: "ghost", quote: "x", kind: "contradicted", note: "n", library: "" },
        { screenId: "s1", quote: "x", kind: "made_up", note: "Odd kind becomes unsupported", library: "" },
        { screenId: "s1", quote: "x", kind: "unsupported", note: " ", library: "" },
      ],
    },
    new Set(["s1"])
  );
  assert.equal(issues.length, 2);
  assert.equal(issues[1].kind, "unsupported");
  assert.equal(normalizeFactCheck({ status: "nope" }), null);
  assert.equal(normalizeFactCheck({ status: "done", checkedAt: "t", issues })?.issues.length, 2);
});
