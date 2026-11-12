import { test } from "node:test";
import assert from "node:assert/strict";
import { containsWhole, exactStrings, lineScore, mergeHits, searchWords } from "../lib/kb/keywords.ts";

test("lot numbers become the forms stored text uses", () => {
  assert.deepEqual(exactStrings("What did SL12 ask about?"), ["SL12", "SL012", "SL 12", "strata lot 12"]);
  assert.deepEqual(exactStrings("anything about strata lot 7?"), ["SL7", "SL007", "SL 7", "strata lot 7"]);
  assert.ok(exactStrings("lot #061 parking").includes("SL061"));
});

test("bylaw and section numbers, quoted phrases, and reference numbers are searched as written", () => {
  assert.deepEqual(exactStrings("What does bylaw 7.3 say?"), ["bylaw 7.3", "by-law 7.3"]);
  assert.deepEqual(exactStrings("by-law 12(4)"), ["bylaw 12(4)", "by-law 12(4)"]);
  assert.deepEqual(exactStrings("SPA section 45"), ["section 45", "s. 45"]);
  assert.deepEqual(exactStrings('Did we hire "Apex Roofing"?'), ["Apex Roofing"]);
  assert.deepEqual(exactStrings("Was INV-20931 paid?"), ["INV-20931"]);
  assert.deepEqual(exactStrings("What did council decide about pets?"), []);
});

test("a lot number isn't also taken as a reference number", () => {
  assert.equal(exactStrings("SL12").filter((s) => /^SL12$/i.test(s)).length, 1);
});

test("words for full-text search: lower case, no short words, no repeats", () => {
  assert.deepEqual(searchWords("Did the roof roof get fixed? Who's on it"), ["did", "the", "roof", "get", "fixed", "who's"]);
});

test("a string is found only as a whole, ignoring case and spacing", () => {
  assert.ok(containsWhole("SL12 asked about the skylight.", "SL12"));
  assert.ok(!containsWhole("SL120 parking stall swap.", "SL12"));
  assert.ok(containsWhole("Under Bylaw  7.3, hallways...", "bylaw 7.3"));
  assert.ok(!containsWhole("Bylaw 7.31 says", "bylaw 7.3"));
  assert.ok(containsWhole("Invoice (INV-20931) paid", "INV-20931"));
});

test("older decisions are scored by exact strings first, then words", () => {
  const line = "[2015-03-04, AGM] Roof replacement — CARRIED. Motion: approve Apex Roofing for SL12";
  assert.equal(lineScore(line, ["SL12"], ["roof", "apex"]), 3 + 1 + 1);
  assert.equal(lineScore(line, [], ["pets"]), 0);
});

test("keyword finds join the strata's own passages; precedent and legislation stay as they were", () => {
  const h = (id: string, scope: string, match?: string) => ({ id, scope, match });
  const merged = mergeHits(
    [h("a", "corporation"), h("p", "global_precedent"), h("l", "legislation")],
    [h("a", "corporation", "words"), h("w", "corporation", "words"), h("e", "corporation", "exact")]
  );
  assert.deepEqual(merged.map((x) => x.id), ["a", "e", "w", "p", "l"]);
});
