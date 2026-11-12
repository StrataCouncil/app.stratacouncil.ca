import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFocusRef, sameFocus, suggestionsFor } from "../lib/stratasphere-focus.ts";

const M = "11111111-2222-3333-4444-555555555555";
const D = "66666666-7777-8888-9999-000000000000";

test("a reference from the browser is checked for shape: ids only, never text", () => {
  assert.deepEqual(parseFocusRef({ kind: "meeting", meetingId: M }), { kind: "meeting", meetingId: M });
  assert.deepEqual(parseFocusRef({ kind: "agenda_item", meetingId: M, itemId: "i4" }), { kind: "agenda_item", meetingId: M, itemId: "i4" });
  assert.deepEqual(parseFocusRef({ kind: "document", documentId: D, title: "ignored" }), { kind: "document", documentId: D });
  assert.deepEqual(parseFocusRef({ kind: "discussion", discussionId: D }), { kind: "discussion", discussionId: D });
  assert.equal(parseFocusRef({ kind: "meeting", meetingId: "not-a-uuid" }), null);
  assert.equal(parseFocusRef({ kind: "agenda_item", meetingId: M, itemId: "x'; drop table" }), null);
  assert.equal(parseFocusRef({ kind: "page", page: "owners" }), null);
  assert.equal(parseFocusRef("meeting"), null);
  assert.equal(parseFocusRef(null), null);
});

test("the same record is recognised, whatever else came with it", () => {
  assert.ok(sameFocus({ kind: "meeting", meetingId: M }, { kind: "meeting", meetingId: M }));
  assert.ok(!sameFocus({ kind: "meeting", meetingId: M }, { kind: "agenda_item", meetingId: M, itemId: "i1" }));
  assert.ok(sameFocus(null, null) && !sameFocus(null, { kind: "document", documentId: D }));
});

test("suggested questions come from templates: the record's kind and title, no AI", () => {
  assert.deepEqual(suggestionsFor({ kind: "agenda_item", title: "Roof Replacement" }), [
    "What have we decided about roof replacement before?",
    "What do our bylaws say about this?",
    "Summarize the attachments.",
  ]);
  assert.equal(suggestionsFor({ kind: "agenda_item", title: "AGM date" })[0], "What have we decided about AGM date before?");
  assert.equal(suggestionsFor({ kind: "document", title: "Bylaws" })[0], "Summarize this document.");
  assert.equal(suggestionsFor({ kind: "discussion", title: "Fence repair." })[1], "Have we decided anything about fence repair before?");
  assert.equal(suggestionsFor({ kind: "none" }).length, 3);
});

test("a suggestion uses an item's subject, before a colon or dash", () => {
  assert.equal(suggestionsFor({ kind: "agenda_item", title: "Roof replacement: quotes" })[0], "What have we decided about roof replacement before?");
  assert.equal(suggestionsFor({ kind: "agenda_item", title: "AGM - date and venue" })[0], "What have we decided about AGM before?");
  assert.equal(suggestionsFor({ kind: "agenda_item", title: "Pet-friendly bylaw" })[0], "What have we decided about pet-friendly bylaw before?");
});
