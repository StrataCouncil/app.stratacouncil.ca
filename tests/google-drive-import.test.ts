import { test } from "node:test";
import assert from "node:assert/strict";
import { planImport } from "../lib/google-drive.ts";

const f = (name: string, mimeType: string, sizeBytes: number | null = 1000) => planImport({ id: "x", name, mimeType, sizeBytes });

test("Google Docs come in as Word; Sheets and Slides as PDF, so Stratasphere can read them", () => {
  assert.equal(f("Bylaws 2024", "application/vnd.google-apps.document", null).fileName, "Bylaws 2024.docx");
  assert.equal(f("Budget 2026", "application/vnd.google-apps.spreadsheet", null).fileName, "Budget 2026.pdf");
  assert.equal(f("AGM slides", "application/vnd.google-apps.presentation", null).fileName, "AGM slides.pdf");
  assert.equal(f("Bylaws 2024", "application/vnd.google-apps.document", null).problem, null);
});

test("ordinary files keep their names; unsupported ones are explained", () => {
  assert.deepEqual([f("Minutes.pdf", "application/pdf").fileName, f("Minutes.pdf", "application/pdf").problem], ["Minutes.pdf", null]);
  assert.match(f("Survey", "application/vnd.google-apps.form", null).problem ?? "", /can't be imported/);
  assert.match(f("Deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation").problem ?? "", /Only/);
  assert.match(f("Huge.pdf", "application/pdf", 60 * 1024 * 1024).problem ?? "", /50 MB/);
});
