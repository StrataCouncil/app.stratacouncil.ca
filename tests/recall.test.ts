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

test("the answer must state its phrases and cite the expected documents", () => {
  const c = { ...base, expectDocuments: ["bylaws", "depreciation"], answerPhrases: ["two pets", "Bylaw 3.1"] };
  const sources = [{ kind: "document", documentId: "bylaws" }, { kind: "decisions" }];
  const r = answerCheck(c, "Under bylaw 3.1, each lot may keep two pets.", sources);
  assert.deepEqual(r.phrases.map((p) => p.found), [true, true]);
  assert.deepEqual(r.cited.map((x) => x.found), [true, false]);
  assert.equal(r.passed, false);
  assert.equal(answerCheck({ ...c, expectDocuments: ["bylaws"] }, "Under bylaw 3.1, each lot may keep two pets.", sources).passed, true);
});

test("sentText joins the system blocks and every message", () => {
  const text = sentText([{ text: "rules" }, { text: "bylaws" }], [{ content: "q1" }, { content: [{ type: "text", text: "a1" }] }, { content: "q2" }]);
  assert.equal(text, "rules\n\nbylaws\n\nq1\n\na1\n\nq2");
});

test("phraseLines keeps up to 20 trimmed lines", () => {
  assert.deepEqual(phraseLines(" a \n\n b\n"), ["a", "b"]);
  assert.equal(phraseLines(Array.from({ length: 30 }, (_, i) => `p${i}`).join("\n")).length, 20);
});
