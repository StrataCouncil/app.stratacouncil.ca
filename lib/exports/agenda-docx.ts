import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import { groupByCategory, meetingFormatLabels, meetingTypeLabels, type AgendaItem, type MeetingFormat, type MeetingType } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";

const INK = "1B2A41";
const MUTED = "555555";

export interface AgendaExportInput {
  corporation: { planNumber: string; name: string };
  meeting: {
    type: MeetingType;
    meetingDate: string;
    startTime: string | null;
    timezone: string;
    format: MeetingFormat;
    location: string | null;
    chairName: string | null;
  };
  agenda: AgendaItem[];
}

const rule = () =>
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, spacing: { after: 120 } });

const line = (text: string, opts: { bold?: boolean; size?: number; color?: string; center?: boolean; before?: number; after?: number } = {}) =>
  new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 80 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 22, color: opts.color, font: "Calibri" })],
  });

/** The agenda as an editable Word document, for circulating before the meeting. */
export async function agendaDocx({ corporation, meeting, agenda }: AgendaExportInput): Promise<Buffer> {
  const children: Paragraph[] = [
    line(corporation.name, { bold: true, size: 28, center: true, after: 40 }),
    line(`Strata Plan ${corporation.planNumber}`, { size: 20, center: true, color: MUTED, after: 40 }),
    rule(),
    line("MEETING AGENDA", { bold: true, size: 32, center: true, color: INK, before: 120, after: 60 }),
    line(meetingTypeLabels[meeting.type].toUpperCase(), { bold: true, size: 26, center: true, after: 160 }),
    line(`Date: ${formatMeetingWhen(meeting)}`, { color: "444444", after: 20 }),
    line(`Format: ${meetingFormatLabels[meeting.format]}`, { color: "444444", after: 20 }),
  ];
  if (meeting.location) children.push(line(`Location: ${meeting.location}`, { color: "444444", after: 20 }));
  if (meeting.chairName) children.push(line(`Chair: ${meeting.chairName}`, { color: "444444", after: 80 }));
  children.push(rule());

  for (const cat of groupByCategory(agenda)) {
    children.push(line(cat.name.toUpperCase(), { bold: true, color: INK, before: 200, after: 60 }));
    for (const it of cat.items) {
      const tag = it.type !== "FOR_INFORMATION" ? `  [${it.type.replace(/_/g, " ")}]` : "";
      children.push(line(`${it.num}. ${it.text}${tag}`, { before: 40, after: 40 }));
      if (it.background) children.push(line(it.background, { size: 20, color: MUTED, after: 40 }));
      if (it.motion?.text) children.push(line(`Proposed motion: ${it.motion.text}`, { size: 20, color: MUTED, after: 60 }));
    }
  }

  const doc = new Document({
    creator: "StrataCouncil.ca",
    title: `${meetingTypeLabels[meeting.type]} agenda`,
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

export function exportFileName(planNumber: string, type: MeetingType, date: string, suffix: string, ext: string) {
  return `${planNumber.replace(/[^A-Za-z0-9-]/g, "")}_${meetingTypeLabels[type].replace(/\s+/g, "_")}_${date}_${suffix}.${ext}`;
}
