import { AlignmentType, BorderStyle, ImageRun, Paragraph, TextRun } from "docx";
import { fitWithin, letterheadLines } from "@/lib/management";
import type { Letterhead } from "@/lib/data/management";

/**
 * The strata management letterhead at the top of an agenda or minutes in
 * Word: logo, then the company and manager lines, centred, then a rule.
 * Empty when the strata has no management details.
 */
export function letterheadParagraphs(letterhead: Letterhead | null | undefined): Paragraph[] {
  if (!letterhead) return [];
  const out: Paragraph[] = [];
  if (letterhead.logo) {
    const size = fitWithin(letterhead.logo.width, letterhead.logo.height, 180, 64);
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new ImageRun({ type: letterhead.logo.type, data: letterhead.logo.bytes, transformation: size })],
      })
    );
  }
  for (const l of letterheadLines(letterhead.details)) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [new TextRun({ text: l.text, bold: l.bold, size: l.bold ? 20 : 17, color: l.bold ? "1B2A41" : "555555", font: "Calibri" })],
      })
    );
  }
  out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, spacing: { after: 160 } }));
  return out;
}
