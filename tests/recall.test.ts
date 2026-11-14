import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCheck, findCheck, normalizeText, phraseLines, sentText, type RecallDiagnostics } from "../lib/ai/recall.ts";

const diag = (over: Partial<RecallDiagnostics> = {}): RecallDiagnostics => ({
  bylawDocumentIds: ["bylaws"],
  attachmentDocumentIds: [],
  ledgerDecisionIds: ["d1", "d2"],
  hits: [
    { scope: "corporation", documentId: "minutes-2023", title: "AGM minutes 2023", similarity: 0.61 },
    { scope: "global_precedent", documentId: null, title: "other", similarity: 0.6 },
    { scope: "corporation", documentId: "depreciation", title: "Depreciation report", similarity: 0.55 },
    { scope: "corporation", documentId: "minutes-2023", title: "AGM minutes 2023", similarity: 0.5 },
    { scope: "legislation", documentId: null, title: "s. 45", similarity: 0.7 },
  ],
  searchFailed: false,
  ...over,
});

const base = { expectDocuments: [], expectDecisions: [], expectPhrases: [], answerPhrases: [] };

test("phrases ignore case, spacing, curly quotes, and dashes", () => {
  assert.equal(normalizeText("  Owner’s   “Pets”—Bylaw\n3.1 "), `owner's "pets"-bylaw 3.1`);
  const r = findCheck({ ...base, expectPhrases: ["owner's pets", "BYLAW 3.1", "not here"] }, diag(), "The Owner’s  Pets rule, see bylaw\n3.1.");
  assert.deepEqual(r.phrases.map((p) => p.found), [true, true, false]);
  assert.equal(r.passed, false);
});

test("documents are found in the bylaws, the attachments, or search, with their ranks", () => {
  const r = findCheck(
    { ...base, expectDocuments: ["bylaws", "agenda-quote", "minutes-2023", "depreciation", "missing"] },
    diag({ attachmentDocumentIds: ["agenda-quote"] }),
    ""
  );
  assert.deepEqual(
    r.documents.map((d) => [d.found, d.where]),
    [
      [true, "Full text (bylaws)"],
      [true, "Full text (agenda item attachment)"],
      [true, "Search, results 1, 4"],
      [true, "Search, result 3"],
      [false, "Not sent"],
    ]
  );
  assert.equal(r.passed, false);
  // Only the strata's own results are listed, keeping their place among all results.
  assert.deepEqual(r.searchResults.map((s) => s.rank), [1, 3, 4]);
});

test("decisions are found only in the ledger that was sent", () => {
  const r = findCheck({ ...base, expectDecisions: ["d2", "d77"] }, diag(), "");
  assert.deepEqual(r.decisions, [{ id: "d2", found: true }, { id: "d77", found: false }]);
});

test("a case passes only when everything is found, and never when search failed", () => {
  const c = { ...base, expectDocuments: ["bylaws"], expectDecisions: ["d1"], expectPhrases: ["quorum"] };
  assert.equal(findCheck(c, diag(), "Quorum is one third.").passed, true);
  assert.equal(findCheck(c, diag({ searchFailed: true }), "Quorum is one third.").passed, false);
  assert.equal(findCheck(base, diag(), "").passed, true);
});

test("the answer must state its key figures and phrases; citations are shown, not scored", () => {
  const c = { ...base, expectDocuments: ["bylaws", "depreciation"], answerPhrases: ["two pets", "Bylaw 3.1"], keyFigures: ["$23,333.33", "2027-01-31"] };
  const sources = [{ kind: "document", documentId: "bylaws" }, { kind: "decisions" }];
  const r = answerCheck(c, "Under bylaw 3.1, each lot may keep two pets. FY2027 bears $23,333.33, to January 31, 2027.", sources);
  assert.deepEqual(r.phrases.map((p) => p.found), [true, true]);
  assert.deepEqual(r.figures.map((f) => f.found), [true, true]);
  assert.deepEqual(r.cited.map((x) => x.found), [true, false]);
  assert.equal(r.passed, true, "a document not cited doesn't fail the answer");
  assert.equal(r.checked, 4);
  assert.equal(answerCheck(c, "Under bylaw 3.1, each lot may keep two pets. FY2027 bears $23,333.", sources).passed, false);
  const none = answerCheck(base, "Anything.", []);
  assert.equal(none.checked, 0, "nothing to check: a person marks it");
});

test("Knowledge Base entries and sections are found among the passages sent", () => {
  const d = diag({
    hits: [
      { id: "s45", scope: "legislation", documentId: null, title: "s. 45", similarity: 0.7 },
      { id: "s46", scope: "legislation", documentId: null, title: "s. 46", similarity: 0.6 },
    ],
  });
  const entryOf = new Map([
    ["s45", "spa"],
    ["s46", "spa"],
  ]);
  const r = findCheck({ ...base, expectLegislationDocuments: ["spa", "regulation"], expectLegislationSections: ["s46", "s99"] }, d, "", entryOf);
  assert.deepEqual(
    r.knowledge.map((k) => [k.kind, k.found, k.where]),
    [
      ["entry", true, "Sections sent: 1, 2"],
      ["entry", false, "Not sent"],
      ["section", true, "Sent, result 2"],
      ["section", false, "Not sent"],
    ]
  );
  assert.equal(r.passed, false);
  assert.equal(findCheck(base, d, "").checked, false, "a case naming nothing checks only the answer");
});

test("sentText joins the system blocks and every message", () => {
  const text = sentText([{ text: "rules" }, { text: "bylaws" }], [{ content: "q1" }, { content: [{ type: "text", text: "a1" }] }, { content: "q2" }]);
  assert.equal(text, "rules\n\nbylaws\n\nq1\n\na1\n\nq2");
});

test("phraseLines keeps up to 20 trimmed lines", () => {
  assert.deepEqual(phraseLines(" a \n\n b\n"), ["a", "b"]);
  assert.equal(phraseLines(Array.from({ length: 30 }, (_, i) => `p${i}`).join("\n")).length, 20);
});
