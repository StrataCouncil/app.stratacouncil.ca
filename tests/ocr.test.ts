import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mergeOcr, ocrPdfPages, OCR_UNCLEAR_BELOW, pdfTextByPage } from "../lib/kb/ocr.ts";

/** A two-page PDF: page 1 has a real text layer, page 2 is a picture of text (a "scan"). */
async function mixedPdf(): Promise<Uint8Array> {
  const c = createCanvas(1700, 2200);
  const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea";
  g.fillRect(0, 0, 1700, 2200);
  g.translate(850, 1100);
  g.rotate(0.01); // a slightly crooked scan
  g.translate(-850, -1100);
  g.fillStyle = "#222";
  g.font = "40px serif";
  ["THE OWNERS, STRATA PLAN BCS1234", "MINUTES OF THE COUNCIL MEETING", "MOTION: THAT council approve the roof inspection.", "CARRIED 4-0."].forEach((l, i) =>
    g.fillText(l, 150, 260 + i * 80)
  );
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const typed = doc.addPage([612, 792]);
  typed.drawText("Agenda for the council meeting of March 14, 2019, at 7:00 p.m. in the amenity room.", { x: 50, y: 700, size: 11, font });
  const scan = doc.addPage([612, 792]);
  scan.drawImage(await doc.embedPng(c.toBuffer("image/png")), { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}

test("finds the pages with no text layer", async () => {
  const { pages, scanned } = await pdfTextByPage(await mixedPdf());
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Agenda for the council meeting/);
  assert.deepEqual(scanned, [2]);
});

test("reads a scanned page on our own servers", { timeout: 120000 }, async () => {
  const [page] = await ocrPdfPages(await mixedPdf(), [2]);
  assert.equal(page.page, 2);
  assert.match(page.text, /STRATA PLAN BCS1234/);
  assert.match(page.text, /roof inspection/);
  assert.ok(page.confidence >= OCR_UNCLEAR_BELOW, `confidence ${page.confidence}`);
});

test("puts OCR'd pages back in order, and sums up how it went", () => {
  const { text, summary } = mergeOcr(
    ["Page one typed.", "", ""],
    [
      { page: 2, text: "Page two scanned.", confidence: 93 },
      { page: 3, text: "Page three, faint.", confidence: 41 },
    ],
    5
  );
  assert.equal(text, "Page one typed.\n\nPage two scanned.\n\nPage three, faint.");
  assert.deepEqual(summary, { read: 2, unclear: 1, skipped: 5, confidence: 67 });
});

test("a blank scanned page doesn't count as unclear", () => {
  const { summary } = mergeOcr(["", ""], [{ page: 1, text: "Text.", confidence: 90 }, { page: 2, text: "", confidence: 0 }], 0);
  assert.equal(summary.unclear, 0);
  assert.equal(summary.confidence, 90);
});
