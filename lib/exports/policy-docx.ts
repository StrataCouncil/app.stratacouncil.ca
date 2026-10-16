import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { inlineParts, parseMarkup, type Block } from "../library/markup.ts";

/**
 * A Library policy template as an editable Word document, for council to
 * adapt, approve offline and, if it wishes, upload to Documents.
 *
 * For the strata corporation, not its manager: the strata's name and plan
 * number are filled in, there's no management letterhead (a policy can
 * outlast the brokerage relationship), and an "Activated" line is left
 * blank for council to complete on approval or revision. Boxes (summary,
 * notes, cautions, samples, fine print) are guidance for whoever adapts
 * the template, so they stay in the Library and out of the policy. No
 * disclaimer either: once council has adapted and approved it, the policy
 * is the strata's own.
 */

const INK = "1B2A41";
const MUTED = "555555";
const FONT = "Calibri";

export interface PolicyExportInput {
  corporation: { planNumber: string; name: string };
  title: string;
  markup: string;
}

/** The blocks that belong in the policy itself: everything but the boxes. */
export function policyBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.type !== "box");
}

/**
 * Fills the template's placeholders for the strata's name and plan number:
 * "[Strata Corporation name]", "[name of strata]", "[Strata Plan number]",
 * "[plan number]" and the like. Other placeholders are left for council.
 */
export function fillPlaceholders(text: string, corporation: { planNumber: string; name: string }): string {
  return text
    .replace(/\[\s*(?:strata\s+)?plan\s*(?:number|no\.?|#)\s*\]/gi, corporation.planNumber)
    .replace(/\[\s*(?:name\s+of\s+(?:the\s+)?strata(?:\s+corporation)?|strata(?:\s+corporation)?(?:'s)?\s+name|strata\s+corporation)\s*\]/gi, corporation.name);
}

const runs = (text: string, opts: { size?: number; color?: string } = {}) =>
  inlineParts(text).map(
    (p) =>
      new TextRun({
        text: typeof p === "string" ? p : p.bold,
        bold: typeof p === "string" ? undefined : true,
        font: FONT,
        size: opts.size,
        color: opts.color,
      })
  );

const cell = (text: string, header: boolean) =>
  new TableCell({
    shading: header ? { fill: "EEF1F5" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: header ? [new TextRun({ text: text.replace(/\*\*/g, ""), bold: true, font: FONT })] : runs(text) })],
  });

function body(blocks: Block[], fill: (s: string) => string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  let numbered = 0;
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(
          new Paragraph({
            heading: b.level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
            spacing: { before: b.level === 2 ? 280 : 200, after: 80 },
            children: runs(fill(b.text)),
          })
        );
        break;
      case "paragraph":
        out.push(new Paragraph({ spacing: { after: 120 }, children: runs(fill(b.text)) }));
        break;
      case "list": {
        const instance = b.style === "number" ? ++numbered : 0;
        for (const item of b.items) {
          const text = fill(item);
          if (b.style === "check") {
            out.push(
              new Paragraph({
                spacing: { after: 60 },
                indent: { left: 360, hanging: 360 },
                children: [new TextRun({ text: "☐\t", font: FONT }), ...runs(text)],
                tabStops: [{ type: "left", position: 360 }],
              })
            );
          } else {
            out.push(
              new Paragraph({
                spacing: { after: 60 },
                numbering: b.style === "number" ? { reference: "policy-numbers", level: 0, instance } : { reference: "policy-bullets", level: 0 },
                children: runs(text),
              })
            );
          }
        }
        out.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
        break;
      }
      case "table":
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: b.head.map((h) => cell(fill(h), true)) }),
              ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(fill(c), false)) })),
            ],
          }),
          new Paragraph({ spacing: { after: 120 }, children: [] })
        );
        break;
      case "box":
        break;
    }
  }
  return out;
}

export async function policyDocx({ corporation, title, markup }: PolicyExportInput): Promise<Buffer> {
  const fill = (s: string) => fillPlaceholders(s, corporation);
  const line = (text: string, opts: { bold?: boolean; size?: number; color?: string; after?: number }) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: opts.after ?? 40 },
      children: [new TextRun({ text, bold: opts.bold, size: opts.size, color: opts.color, font: FONT })],
    });

  const children: Array<Paragraph | Table> = [
    line(corporation.name, { bold: true, size: 28 }),
    line(`Strata Plan ${corporation.planNumber}`, { size: 20, color: MUTED }),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, spacing: { after: 200 } }),
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: fill(title), font: FONT })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new TextRun({ text: "Activated: ", bold: true, font: FONT }), new TextRun({ text: "____________________", font: FONT })],
    }),
    ...body(policyBlocks(parseMarkup(markup)), fill),
  ];

  const doc = new Document({
    creator: corporation.name,
    title: fill(title),
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 36, bold: true, color: INK } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, color: INK } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: INK } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "policy-bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } }],
        },
        {
          reference: "policy-numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
