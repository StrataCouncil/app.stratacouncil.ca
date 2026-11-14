import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../lib/kb/chunk.ts";
import { arrangePassages, overlapLength, passagesText, type PassageHit } from "../lib/kb/passages.ts";

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ") + ".";
const doc = [words(300, "alpha"), words(300, "beta"), words(300, "gamma"), words(300, "delta")].join("\n\n");
const chunks = chunkText(doc);

const hit = (id: string, documentId: string | null, title: string, text: string, similarity = 0.5): PassageHit => ({ id, documentId, title, text, similarity });

test("neighbouring passages of one document are joined without repeating their overlap", () => {
  assert.ok(chunks.length >= 3, "the test document makes several overlapping pieces");
  assert.ok(overlapLength(chunks[0], chunks[1]) > 50);
  assert.equal(overlapLength(chunks[1], chunks[0]), 0);
  // Found out of order, as search returns them.
  const { groups, charsSaved } = arrangePassages([hit("b", "d1", "Insurance", chunks[1], 0.7), hit("a", "d1", "Insurance", chunks[0], 0.6)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].segments.length, 1);
  assert.ok(doc.replace(/\s+/g, " ").includes(groups[0].segments[0].replace(/\s+/g, " ")), "the joined text is the document's own text, in order");
  assert.ok(charsSaved > 50);
  assert.equal(groups[0].relevance, 0.7);
});

test("passages that aren't neighbours stay separate, under one heading", () => {
  const { groups } = arrangePassages([hit("a", "d1", "Insurance", chunks[0]), hit("c", "d1", "Insurance", chunks[chunks.length - 1])]);
  assert.equal(groups[0].segments.length, 2);
  const text = passagesText(groups);
  assert.equal(text.match(/\[1 \| Insurance/g)?.length, 1);
  assert.match(text, /\n\[\.\.\.\]\n/);
});

test("identical copies are sent once, with the copy's title noted", () => {
  const { groups } = arrangePassages([
    hit("a", "d1", "Insurance certificate 2026", chunks[0], 0.8),
    hit("b", "d2", "Insurance cert (copy)", chunks[0], 0.8),
    hit("c", "d3", "Budget", "A different passage about the budget for the year ahead.", 0.4),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ["Insurance certificate 2026", "Budget"]);
  assert.deepEqual(groups[0].alsoFiledAs, ["Insurance cert (copy)"]);
  assert.match(passagesText(groups), /identical copy also filed as: "Insurance cert \(copy\)"/);
});

test("nothing found is ever dropped", () => {
  const hits = chunks.map((c, i) => hit(String(i), "d1", "Doc", c));
  const { groups } = arrangePassages([...hits].reverse());
  const sent = groups[0].segments.join(" ").replace(/\s+/g, " ");
  for (const c of chunks) assert.ok(sent.includes(c.replace(/\s+/g, " ")), "every passage is in what's sent");
  assert.equal(groups[0].segments.length, 1, "the whole run of passages joins into one");
});
