import { test } from "node:test";
import assert from "node:assert/strict";
import { findSection, parseCitationLabel, planRepair, type LibraryChunk, type LibraryDoc } from "../lib/kb/citation-repair.ts";

const docs: LibraryDoc[] = [
  { id: "spa", title: "Strata Property Act" },
  { id: "rules", title: "Real Estate Services Rules" },
  { id: "hrc", title: "Human Rights Code" },
  { id: "pipa", title: "Personal Information Protection Act" },
];
const chunk = (id: string, doc: string, title: string, i: number): LibraryChunk => ({ id, title, legislationDocumentId: doc, chunkIndex: i });
const chunks = new Map<string, LibraryChunk[]>([
  ["spa", [
    chunk("spa-45b", "spa", "s. 45 Notice requirements for annual or special general meeting", 61),
    chunk("spa-45a", "spa", "s. 45 Notice requirements for annual or special general meeting", 60),
    chunk("spa-450", "spa", "s. 450 Not a real section", 400),
    chunk("sb-20", "spa", "Standard Bylaw 20 Delegation of council's powers and duties", 320),
    chunk("form-b", "spa", "Form B Information certificate", 330),
  ]],
  ["rules", [chunk("r-77", "rules", "s. 77 Trust accounts for strata corporations", 90)]],
]);

test("labels split into the entry and the section", () => {
  assert.deepEqual(parseCitationLabel("Strata Property Act, s. 45 Notice requirements"), { document: "Strata Property Act", ref: "s. 45" });
  assert.deepEqual(parseCitationLabel("Strata Property Act, Standard Bylaw 20 Delegation"), { document: "Strata Property Act", ref: "Standard Bylaw 20" });
  assert.deepEqual(parseCitationLabel("Strata Property Regulation, s. 6.21 When depreciation report"), { document: "Strata Property Regulation", ref: "s. 6.21" });
  assert.deepEqual(parseCitationLabel("Strata Property Regulation, Form B"), { document: "Strata Property Regulation", ref: "Form B" });
  assert.deepEqual(parseCitationLabel("BC Strata Property Standard Bylaws"), { document: "BC Strata Property Standard Bylaws", ref: null });
});

test("a section is its first passage, and s. 45 never matches s. 450", () => {
  assert.equal(findSection("s. 45", chunks.get("spa")!)?.id, "spa-45a");
  assert.equal(findSection("s. 4", chunks.get("spa")!), null);
});

test("a renumbered passage of an entry still in the library is re-linked", () => {
  assert.deepEqual(planRepair("Strata Property Act, s. 45 Old heading", docs, chunks), {
    kind: "relink",
    chunkId: "spa-45a",
    label: "Strata Property Act, s. 45 Notice requirements for annual or special general meeting",
  });
  assert.equal((planRepair("Real Estate Services Rules, s. 77 Trust accounts", docs, chunks) as { chunkId: string }).chunkId, "r-77");
});

test("a numbered Standard Bylaw from the deleted PDF moves to the Act's Schedule", () => {
  const r = planRepair("BC Strata Property Standard Bylaws, Standard Bylaw 20", docs, chunks);
  assert.equal(r.kind, "relink");
  assert.equal((r as { chunkId: string }).chunkId, "sb-20");
});

test("anything that would be a guess goes to review", () => {
  const whole = planRepair("BC Strata Property Standard Bylaws", docs, chunks);
  assert.deepEqual(whole.kind, "review");
  assert.equal((whole as { lookIn: string }).lookIn, "spa");
  const rulesWhole = planRepair("Real Estate Services Rules", docs, chunks);
  assert.equal(rulesWhole.kind, "review", "the Rules used to be cited as a whole; the section must be chosen");
  const federal = planRepair("Canadian Human Rights Act, s. 3 Prohibited grounds", docs, chunks);
  assert.equal(federal.kind, "review", "a different law is never substituted automatically");
  assert.equal((federal as { lookIn: string }).lookIn, "hrc");
  assert.equal(planRepair("Personal Information Protection and Electronic Documents Act, s. 2", docs, chunks).kind, "review");
  assert.equal(planRepair("Strata Property Act, s. 999 Nothing", docs, chunks).kind, "review");
  const gone = planRepair("Some Removed Guide", docs, chunks);
  assert.deepEqual(gone, { kind: "review", lookIn: null, reason: '"Some Removed Guide" is no longer in the Knowledge Base.' });
});
