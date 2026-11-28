import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { csvText, excelDate, xlsxText } from "../lib/kb/spreadsheet.ts";
import { extractDocumentText } from "../lib/kb/extract.ts";
import { isIndexableFile } from "../lib/documents.ts";

GlobalFonts.registerFromPath(new URL("../lib/exports/fonts/WorkSans-Regular.ttf", import.meta.url).pathname, "TestScan");

/** A small two-sheet workbook, written the way Excel writes one. */
async function workbook(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns:r="r"><sheets><sheet name="Operating" sheetId="1" r:id="rId1"/><sheet name="CRF &amp; Levies" sheetId="2" r:id="rId2"/></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`
  );
  zip.file("xl/sharedStrings.xml", `<sst><si><t>Line</t></si><si><t>FY28</t></si><si><r><t>Insurance</t></r><r><t xml:space="preserve"> premium</t></r></si><si><t>Approved</t></si></sst>`);
  zip.file(
    "xl/styles.xml",
    `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" s="2"><f>B5*2</f><v>95497.5</v></c></row>
      <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="1"><v>46358</v></c><c r="D3" t="b"><v>1</v></c></row>
      <row r="4"></row>
    </sheetData></worksheet>`
  );
  zip.file("xl/worksheets/sheet2.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Opening &lt;CRF&gt;</t></is></c><c r="B1"><v>212000</v></c></row></sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array" });
}

test("reads every sheet of a workbook, one line per row", async () => {
  const text = await xlsxText(await workbook());
  assert.equal(
    text,
    [
      "Sheet: Operating",
      "Line | FY28",
      "Insurance premium |  | 95497.5",
      "Approved | 2026-12-02 |  | TRUE",
      "",
      "Sheet: CRF & Levies",
      "Opening <CRF> | 212000",
    ].join("\n")
  );
});

test("dates come out as days", () => {
  assert.equal(excelDate(46358), "2026-12-02");
  assert.equal(excelDate(45658), "2025-01-01");
});

test("reads a CSV, quoted cells included", () => {
  assert.equal(csvText('﻿Lot,Owner,Fee\r\nSL001,"Smith, Ann",265.53\nSL002,"Said ""Hi""",\n\n'), 'Lot | Owner | Fee\nSL001 | Smith, Ann | 265.53\nSL002 | Said "Hi"');
});

test("spreadsheets and photos are now indexed", async () => {
  for (const name of ["budget.xlsx", "arrears.csv", "notice.jpg", "photo.JPEG", "scan.png", "minutes.pdf"]) assert.ok(isIndexableFile(name), name);
  assert.ok(!isIndexableFile("old.doc"));
  const r = await extractDocumentText(await workbook(), "FY28 Budget.xlsx", null);
  assert.equal(r.status, "ok");
  assert.match(r.status === "ok" ? r.text : "", /Insurance premium/);
  const empty = await extractDocumentText(new TextEncoder().encode(",,\n,,"), "blank.csv", "text/csv");
  assert.equal(empty.status, "needs_text");
});

test("reads a photo of a notice on our own servers", { timeout: 120000 }, async () => {
  const c = createCanvas(1400, 600);
  const g = c.getContext("2d");
  g.fillStyle = "#fbfaf6";
  g.fillRect(0, 0, 1400, 600);
  g.fillStyle = "#222";
  g.font = "44px TestScan";
  ["NOTICE TO OWNERS", "The elevator will be serviced on Tuesday.", "Please use the stairs between 9 and 11."].forEach((l, i) => g.fillText(l, 80, 140 + i * 110));
  const r = await extractDocumentText(new Uint8Array(c.toBuffer("image/png")), "notice.png", "image/png");
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.match(r.text, /NOTICE TO OWNERS/);
  assert.match(r.text, /elevator will be serviced/);
  assert.equal(r.ocr?.read, 1);
});
