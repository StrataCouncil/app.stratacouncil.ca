import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import { attendanceLines, clockTime, voteLine, type MinutesContent } from "@/lib/meetings/minutes";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { letterheadParagraphs } from "@/lib/exports/letterhead-docx";
import type { Letterhead } from "@/lib/data/management";

const INK = "1B2A41";
const MUTED = "555555";

const p = (text: string, o: { bold?: boolean; size?: number; color?: string; center?: boolean; before?: number; after?: number; italics?: boolean } = {}) =>
  new Paragraph({
    alignment: o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 80 },
    children: text.split("\n").map(
      (line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0, bold: o.bold, italics: o.italics, size: o.size ?? 22, color: o.color, font: "Calibri" })
    ),
  });

const heading = (text: string) => p(text.toUpperCase(), { bold: true, color: INK, before: 240, after: 80 });
const rule = () => new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, spacing: { after: 120 } });

/** Draft minutes as an editable Word document. */
export async function minutesDocx(m: MinutesContent, opts: { draft: boolean; letterhead?: Letterhead | null }): Promise<Buffer> {
  const tz = m.meeting.timezone;
  const children: Paragraph[] = [...letterheadParagraphs(opts.letterhead)];
  if (opts.draft) children.push(p("DRAFT — NOT YET APPROVED", { bold: true, color: "A6342A", center: true, after: 120 }));
  children.push(
    p(m.corporation.name, { bold: true, size: 28, center: true, after: 40 }),
    p(`Strata Plan ${m.corporation.planNumber}`, { size: 20, center: true, color: MUTED, after: 40 }),
    rule(),
    p("MINUTES", { bold: true, size: 32, center: true, color: INK, before: 120, after: 60 }),
    p(m.meeting.typeLabel.toUpperCase(), { bold: true, size: 26, center: true, after: 160 }),
    p(`Date: ${formatMeetingWhen({ meetingDate: m.meeting.date, startTime: null, timezone: tz })}`, { color: "444444", after: 20 }),
    p(`Time: ${clockTime(m.meeting.calledToOrderAt, tz)} – ${clockTime(m.meeting.adjournedAt, tz)}`, { color: "444444", after: 20 }),
    p(`Format: ${m.meeting.format}${m.meeting.location ? ` · ${m.meeting.location}` : ""}`, { color: "444444", after: 20 })
  );
  if (m.meeting.chair) children.push(p(`Chair: ${m.meeting.chair}`, { color: "444444", after: 80 }));

  children.push(heading("Attendance"), ...attendanceLines(m).map((l) => p(l)));
  children.push(
    heading("Call to order"),
    p(m.calledToOrder ? `The meeting was called to order at ${clockTime(m.meeting.calledToOrderAt, tz)}.` : "Quorum was not achieved and the meeting was not called to order.")
  );

  for (const section of m.sections) {
    children.push(heading(section.name));
    for (const it of section.items) {
      children.push(p(`${it.num}. ${it.title}`, { bold: true, before: 120, after: 40 }));
      if (it.summary) children.push(p(it.summary));
      if (it.motion?.text) {
        children.push(
          p(`Moved by ${it.motion.mover || "—"}, seconded by ${it.motion.seconder || "—"}:`, { color: MUTED, after: 20 }),
          p(`“${it.motion.text}”`, { italics: true, after: 40 })
        );
      }
      if (it.motion?.outcome) children.push(p(`${it.motion.outcome} — ${voteLine(it.motion)}`, { bold: true, color: it.motion.outcome === "CARRIED" ? "2F7355" : "A6342A" }));
      if (it.nextMeeting) {
        const n = it.nextMeeting;
        children.push(p(`Next meeting: ${[n.date, n.time, n.location].filter(Boolean).join(" · ")}`));
      }
    }
  }

  children.push(
    heading("Adjournment"),
    p(`There being no further business, the meeting was adjourned at ${clockTime(m.meeting.adjournedAt, tz)}.`),
    p("", { before: 600 }),
    p("_______________________________          _______________________________", { before: 240 }),
    p("Chair                                                              Secretary", { color: MUTED })
  );

  const doc = new Document({
    creator: "StrataCouncil.ca",
    title: `${m.meeting.typeLabel} minutes`,
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
