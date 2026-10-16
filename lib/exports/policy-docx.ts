import {
  AlignmentType,
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
 * outlast the brokerage relationship), and "Activated" and "Version" lines are left
 * blank for council to complete on approval or revision. Boxes (summary,
 * notes, cautions, samples, fine print) are guidance for whoever adapts
 * the template, so they stay in the Library and out of the policy. No
 * disclaimer either: once council has adapted and approved it, the policy
 * is the strata's own.
 */

// After a council's own policies (Alterations Policy, EPS9048): Arial,
// blue section headings, grey subheadings, the policy's name and page
// number in the footer.
const BLUE = "0B5394";
const GREY = "434343";
const FONT = "Arial";
const BODY = 22; // 11 pt

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

const runs = (text: string) =>
  inlineParts(text).map(
    (p) => new TextRun({ text: typeof p === "string" ? p : p.bold, bold: typeof p === "string" ? undefined : true, font: FONT })
  );

const cell = (text: string, header: boolean) =>
  new TableCell({
    shading: header ? { fill: "EEF3F8" } : undefined,
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
            children: [new TextRun({ text: fill(b.text).replace(/\*\*/g, ""), font: FONT })],
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

export async function policyDocx({ corporation, title, markup }: PolicyExportInput): Promise<Buffer> {
  const fill = (s: string) => fillPlaceholders(s, corporation);
  const name = `${corporation.planNumber} ${corporation.name} \u2013 ${fill(title)}`;
  const footerName = `${corporation.planNumber} ${corporation.name} - ${fill(title)}`;
  const field = (label: string, after: number) =>
    new Paragraph({
      spacing: { after },
      children: [new TextRun({ text: `${label}: `, font: FONT }), new TextRun({ text: "____________________", font: FONT })],
    });

  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: name, font: FONT })] }),
    field("Activated", 0),
    field("Version", 240),
    ...body(policyBlocks(parseMarkup(markup)), fill),
  ];

  const doc = new Document({
    creator: corporation.name,
    title: name,
    styles: {
      default: { document: { run: { font: FONT, size: BODY }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 40, bold: true, color: BLUE }, paragraph: { spacing: { before: 0, after: 160, line: 240, lineRule: LineRuleType.AUTO } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: BLUE }, paragraph: { spacing: { before: 360, after: 120 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: GREY }, paragraph: { spacing: { before: 280, after: 80 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "policy-bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u25CF", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { size: 18 } } }],
        },
        {
          reference: "policy-numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
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
                  new TextRun({ text: footerName, font: FONT, size: 20 }),
                  new TextRun({ children: ["\tPage ", PageNumber.CURRENT], font: FONT, size: 20 }),
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
