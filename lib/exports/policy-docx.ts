import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopType,
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
 * outlast the brokerage relationship), and "Effective" and "Version" lines are
 * left blank for council to complete on approval or revision. Boxes (summary,
 * notes, cautions, samples, fine print) are guidance for whoever adapts
 * the template, so they stay in the Library and out of the policy. No
 * disclaimer either: once council has adapted and approved it, the policy
 * is the strata's own.
 */

// Laid out like a council's own policy (title, Effective and Version
// lines, section headings, the policy's name and page number in the
// footer), in StrataCouncil.ca's colours: navy-slate and clay (--ink,
// --accent). Headings are Georgia, the serif nearly everyone has (the
// app's Fraunces rarely is); body text is Work Sans, embedded in the file
// when the caller passes it, so Word shows it even where it isn't
// installed (Google Docs has it already).
const NAVY = "1B2A41";
const CLAY = "B4602F";
const MUTED = "6B7280";
const RULE = "E3DFD5";
const FONT = "Work Sans";
const HEADING_FONT = "Georgia";
const BODY = 21; // 10.5 pt

export interface PolicyExportInput {
  corporation: { planNumber: string; name: string };
  title: string;
  markup: string;
  /** Work Sans Regular (lib/exports/fonts), embedded in the document. */
  bodyFont?: Buffer;
  /** A form, not a policy: no Effective and Version lines, just the clay rule under the title. */
  form?: boolean;
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

const runs = (text: string) =>
  inlineParts(text).map(
    (p) => new TextRun({ text: typeof p === "string" ? p : p.bold, bold: typeof p === "string" ? undefined : true, font: FONT })
  );

const cell = (text: string, header: boolean) =>
  new TableCell({
    shading: header ? { fill: "F8F6F1" } : undefined,
    borders: Object.fromEntries(["top", "bottom", "left", "right"].map((side) => [side, { style: BorderStyle.SINGLE, size: 4, color: RULE }])),
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0 }, children: header ? [new TextRun({ text: text.replace(/\*\*/g, ""), bold: true, font: FONT })] : runs(text) })],
  });

/** Space after a paragraph, a list or a table; list items sit close together. */
const GAP = 200;

function body(blocks: Block[], fill: (s: string) => string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  let numbered = 0;
  blocks.forEach((b, index) => {
    switch (b.type) {
      case "heading":
        out.push(
          new Paragraph({
            heading: b.level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
            keepNext: true,
            children: [new TextRun(fill(b.text).replace(/\*\*/g, ""))],
          })
        );
        break;
      case "paragraph": {
        // A lead-in line ("Owners must submit:") sits right above its list.
        const leadIn = blocks[index + 1]?.type === "list";
        out.push(new Paragraph({ spacing: { after: leadIn ? 40 : GAP }, keepNext: leadIn, children: runs(fill(b.text)) }));
        break;
      }
      case "list": {
        const instance = b.style === "number" ? ++numbered : 0;
        b.items.forEach((item, i) => {
          const after = i === b.items.length - 1 ? GAP : 0;
          const text = fill(item);
          out.push(
            b.style === "check"
              ? new Paragraph({
                  spacing: { after },
                  indent: { left: 720, hanging: 360 },
                  tabStops: [{ type: TabStopType.LEFT, position: 720 }],
                  children: [new TextRun({ text: "\u2610\t", font: FONT }), ...runs(text)],
                })
              : new Paragraph({
                  spacing: { after },
                  numbering: b.style === "number" ? { reference: "policy-numbers", level: 0, instance } : { reference: "policy-bullets", level: 0 },
                  children: runs(text),
                })
          );
        });
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
          new Paragraph({ spacing: { after: GAP }, children: [] })
        );
        break;
      case "box":
        break;
    }
  });
  return out;
}

export async function policyDocx({ corporation, title, markup, bodyFont, form }: PolicyExportInput): Promise<Buffer> {
  const fill = (s: string) => fillPlaceholders(s, corporation);
  const name = `${corporation.planNumber} ${corporation.name} \u2013 ${fill(title)}`;
  const footerName = `${corporation.planNumber} ${corporation.name} - ${fill(title)}`;
  const field = (label: string, last: boolean) =>
    new Paragraph({
      spacing: { after: last ? 320 : 0 },
      // A clay rule under the Effective and Version lines.
      border: last ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: CLAY, space: 8 } } : undefined,
      children: [new TextRun({ text: `${label}: `, bold: true, font: FONT }), new TextRun({ text: "____________________", font: FONT })],
    });

  const children: Array<Paragraph | Table> = [
    form
      ? new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 320 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: CLAY, space: 8 } },
          children: [new TextRun(name)],
        })
      : new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(name)] }),
    ...(form ? [] : [field("Effective", false), field("Version", true)]),
    ...body(policyBlocks(parseMarkup(markup)), fill),
  ];

  const doc = new Document({
    creator: corporation.name,
    title: name,
    fonts: bodyFont ? [{ name: FONT, data: bodyFont }] : undefined,
    styles: {
      default: { document: { run: { font: FONT, size: BODY, color: NAVY }, paragraph: { spacing: { line: 288, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: HEADING_FONT, size: 40, color: NAVY }, paragraph: { spacing: { before: 0, after: 200, line: 240, lineRule: LineRuleType.AUTO } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: HEADING_FONT, size: 30, color: NAVY }, paragraph: { spacing: { before: 400, after: 120 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 22, bold: true, color: CLAY }, paragraph: { spacing: { before: 280, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "policy-bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u25CF", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { size: 16, color: CLAY } } }],
        },
        {
          reference: "policy-numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { color: CLAY, bold: true } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, footer: 720 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
                children: [
                  new TextRun({ text: footerName, font: FONT, size: 17, color: MUTED }),
                  new TextRun({ children: ["\tPage ", PageNumber.CURRENT], font: FONT, size: 17, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
