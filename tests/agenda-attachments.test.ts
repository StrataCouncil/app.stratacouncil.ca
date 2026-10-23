import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentUses, makeItem, reconcileAttachments, type AgendaItem, type AttachmentTarget } from "../lib/meetings/agenda.ts";
import { sha256Hex, isSha256Hex } from "../lib/fingerprint.ts";
import { folderLabel, pickableDocumentCategories, UNFILED_LABEL } from "../lib/documents.ts";

const item = (atts: AgendaItem["atts"], extra: Partial<AgendaItem> = {}): AgendaItem => ({ ...makeItem("Roof", "New Business"), atts, ...extra });

test("attachments are checked against the strata's documents before saving", () => {
  const targets = new Map<string, AttachmentTarget>([
    ["doc-1", { title: "Warranty Report", kind: "document", url: null }],
    ["link-1", { title: "Roofer's site", kind: "link", url: "https://roofer.example/quote" }],
  ]);
  const [out] = reconcileAttachments(
    [
      item([
        { id: "x", kind: "document", documentId: "doc-1", title: "warranty.pdf" },
        { id: "y", kind: "document", documentId: "doc-1", title: "again" },
        { id: "z", kind: "document", documentId: "someone-elses", title: "secret" },
        // A link attachment's address comes from the document, not the browser.
        { id: "l", kind: "document", documentId: "link-1", title: "" },
        // An older link with no document keeps its (web) address.
        { id: "old", kind: "link", documentId: null, url: "https://example.com", title: "old" },
        { id: "bad", kind: "link", documentId: null, url: "javascript:alert(1)", title: "bad" },
      ]),
    ],
    targets
  );
  assert.deepEqual(out.atts, [
    { id: "a_doc-1", kind: "document", documentId: "doc-1", title: "warranty.pdf" },
    { id: "a_link-1", kind: "link", documentId: "link-1", url: "https://roofer.example/quote", title: "Roofer's site" },
    { id: "old", kind: "link", documentId: null, url: "https://example.com", title: "old" },
  ]);
});

test("where each document is attached, newest meeting first", () => {
  const uses = attachmentUses([
    {
      id: "m2",
      type: "council",
      meetingDate: "2026-10-01",
      agenda: [
        item([{ id: "a", kind: "document", documentId: "doc-1", title: "w" }], { num: 4, text: "Roof" }),
        item([], { num: 5, text: "Other" }),
      ],
    },
    {
      id: "m1",
      type: "agm",
      meetingDate: "2026-03-01",
      agenda: [item([{ id: "a", kind: "document", documentId: "doc-1", title: "w" }, { id: "b", kind: "document", documentId: "doc-1", title: "w" }], { num: 2, text: "Budget" })],
    },
  ]);
  assert.deepEqual(uses.get("doc-1"), [
    { meetingId: "m2", meetingType: "council", meetingDate: "2026-10-01", itemNum: 4, itemText: "Roof" },
    { meetingId: "m1", meetingType: "agm", meetingDate: "2026-03-01", itemNum: 2, itemText: "Budget" },
  ]);
  assert.equal(uses.size, 1);
});

test("a file's fingerprint is the SHA-256 of its bytes", async () => {
  const hash = await sha256Hex(new TextEncoder().encode("abc"));
  assert.equal(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.ok(isSha256Hex(hash));
  assert.ok(!isSha256Hex("ABC"));
});

test("no Agenda Attachments folder; documents without one are Unfiled", () => {
  assert.ok(!(pickableDocumentCategories as readonly string[]).includes("agenda_attachments"));
  assert.equal(pickableDocumentCategories.length, 8);
  assert.equal(folderLabel(null), UNFILED_LABEL);
  assert.equal(folderLabel("agenda_attachments"), UNFILED_LABEL);
  assert.equal(folderLabel("insurance"), "Insurance");
});
