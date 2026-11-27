import { test } from "node:test";
import assert from "node:assert/strict";
import { byCitationOrder, citationLabels, namedDocuments } from "../lib/training/library.ts";

const docs = [
  { id: "spa", title: "Strata Property Act", shortName: "SPA" },
  { id: "reg", title: "Strata Property Regulation", shortName: null },
  { id: "resa", title: "Real Estate Services Act", shortName: "RESA" },
  { id: "rules", title: "Real Estate Services Rules", shortName: "RESR" },
  { id: "ia", title: "Interpretation Act", shortName: "IA" },
  { id: "lta", title: "Land Title Act", shortName: "LTA" },
];

test("reads the section labels a reference names", () => {
  assert.deepEqual(citationLabels("Strata Property Act, s. 37"), ["s. 37"]);
  assert.deepEqual(citationLabels("section 4.3"), ["s. 4.3"]);
  assert.deepEqual(citationLabels("Standard Bylaw 23"), ["Standard Bylaw 23"]);
  assert.deepEqual(citationLabels("roof repairs"), []);
});

test("a named Act limits the lookup to that Act", () => {
  assert.deepEqual(namedDocuments("Strata Property Act, s. 37", docs), ["spa"]);
  assert.deepEqual(namedDocuments("strata property act s 37", docs), ["spa"]);
  assert.deepEqual(namedDocuments("Strata Property Regulation, s. 4.3", docs), ["reg"]);
  assert.deepEqual(namedDocuments("Real Estate Services Rules, s. 88", docs), ["rules"]);
  assert.deepEqual(namedDocuments("SPA s. 39", docs), ["spa"]);
  assert.deepEqual(namedDocuments("RESA s. 3", docs), ["resa"]);
});

test("a bare number names no Act, and short two-letter abbreviations don't count", () => {
  assert.deepEqual(namedDocuments("s. 37", docs), []);
  assert.deepEqual(namedDocuments("IA s. 25", docs), []);
});

test("bare-number matches list the Strata Property Act first", () => {
  const hits = [
    { documentTitle: "Land Title Act", label: "s. 37" },
    { documentTitle: "Real Estate Services Rules", label: "s. 37" },
    { documentTitle: "Strata Property Act", label: "s. 37 Strata manager to return records" },
    { documentTitle: "Interpretation Act", label: "s. 37" },
  ];
  assert.deepEqual(hits.sort(byCitationOrder).map((h) => h.documentTitle), [
    "Strata Property Act",
    "Real Estate Services Rules",
    "Interpretation Act",
    "Land Title Act",
  ]);
});
