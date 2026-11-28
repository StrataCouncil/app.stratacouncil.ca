import { test } from "node:test";
import assert from "node:assert/strict";
import { copiesToRemove, groupDuplicates, suggestedKeep, type DuplicateCandidate } from "../lib/documents-duplicates.ts";

const doc = (id: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  title: id,
  category: null,
  sourceType: "upload",
  uploadedAt: "2026-10-01T00:00:00Z",
  sha256: null,
  textFingerprint: null,
  uses: 0,
  ...over,
});

test("groups copies with the same file or the same text, and nothing else", () => {
  const groups = groupDuplicates([
    doc("a", { sha256: "f1", textFingerprint: "t1" }),
    doc("b", { sha256: "f1", textFingerprint: "t1" }),
    doc("c", { sha256: "f2", textFingerprint: "t1" }), // a re-export: other bytes, same text
    doc("d", { sha256: "f3", textFingerprint: "t2" }),
    doc("e", { sha256: null, textFingerprint: null }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].copies.map((c) => c.id).sort(), ["a", "b", "c"]);
  assert.equal(groups[0].match, "text");
});

test("a set of identical files says so", () => {
  const [g] = groupDuplicates([doc("a", { sha256: "f1" }), doc("b", { sha256: "f1" })]);
  assert.equal(g.match, "file");
});

test("keeps a record first, then one in a folder, then the most attached, then the oldest", () => {
  assert.equal(suggestedKeep([doc("x", { category: "insurance" }), doc("m", { sourceType: "minutes" })]).id, "m");
  assert.equal(suggestedKeep([doc("u"), doc("f", { category: "insurance", uploadedAt: "2026-11-01T00:00:00Z" })]).id, "f");
  assert.equal(suggestedKeep([doc("p", { category: "insurance" }), doc("q", { category: "insurance", uses: 2 })]).id, "q");
  assert.equal(suggestedKeep([doc("new", { uploadedAt: "2026-11-01T00:00:00Z" }), doc("old", { uploadedAt: "2026-09-01T00:00:00Z" })]).id, "old");
});

test("removes only copies that match the kept one directly, never a record", () => {
  const [g] = groupDuplicates([
    doc("a", { sha256: "f1", textFingerprint: "t1", category: "insurance" }),
    doc("b", { sha256: "f1", textFingerprint: null }),
    doc("c", { sha256: "f2", textFingerprint: "t1" }),
    doc("d", { sha256: "f2", textFingerprint: "t9", sourceType: "minutes" }),
  ]);
  assert.equal(g.keepId, "d"); // the record
  assert.deepEqual(copiesToRemove(g, "d").map((c) => c.id), ["c"]);
  assert.deepEqual(copiesToRemove(g, "a").map((c) => c.id).sort(), ["b", "c"]);
  assert.deepEqual(copiesToRemove(g, "missing"), []);
});
