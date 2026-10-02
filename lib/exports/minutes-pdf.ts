import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { attendanceLines, clockTime, voteLine, type MinutesContent } from "@/lib/meetings/minutes";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { fitWithin, letterheadLines } from "@/lib/management";
import type { Letterhead } from "@/lib/data/management";

/**
 * Final minutes as a PDF (Letter, 1" margins), with a real text layer so
 * the stored copy is indexed like any other document. Uses the standard
 * PDF fonts; characters they can't draw are replaced rather than dropped
 * silently.
 */
const INK = rgb(0.106, 0.165, 0.255);
const MUTED = rgb(0.38, 0.38, 0.38);
const GREEN = rgb(0.184, 0.451, 0.333);
const RED = rgb(0.651, 0.204, 0.165);
const PAGE = { w: 612, h: 792, margin: 72 };

function winAnsi(text: string) {
  return text
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2013\u2212]/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u2027]/g, "\u00B7")
    .replace(/[\u2713\u2714\u2705]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "?");
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  private doc: PDFDocument;
  private font: PDFFont;
  private bold: PDFFont;
  private footer: string;
  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, footer: string) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.footer = footer;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pageNo++;
    this.y = PAGE.h - PAGE.margin;
    this.page.drawText(winAnsi(`${this.footer} · Page ${this.pageNo}`), { x: PAGE.margin, y: 36, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) {
    if (this.y - h < PAGE.margin) this.newPage();
  }
  space(h: number) {
    this.y -= h;
  }
  text(raw: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; center?: boolean; indent?: number } = {}) {
    const size = o.size ?? 10.5;
    const font = o.bold ? this.bold : this.font;
    const width = PAGE.w - PAGE.margin * 2 - (o.indent ?? 0);
    const lineH = size * 1.4;
    for (const para of winAnsi(raw).split("\n")) {
      const words = para.split(/\s+/);
      let line = "";
      const lines: string[] = [];
      for (const w of words) {
        const attempt = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(attempt, size) > width && line) {
          lines.push(line);
          line = w;
        } else line = attempt;
      }
      lines.push(line);
      for (const l of lines) {
        this.ensure(lineH);
        const x = o.center ? (PAGE.w - font.widthOfTextAtSize(l, size)) / 2 : PAGE.margin + (o.indent ?? 0);
        this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
        this.y -= lineH;
      }
    }
  }
  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y - 4 }, end: { x: PAGE.w - PAGE.margin, y: this.y - 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    this.y -= 12;
  }
}

export async function minutesPdf(m: MinutesContent, opts: { finalizedAt: string | null; letterhead?: Letterhead | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${m.meeting.typeLabel} minutes, ${m.meeting.date}`);
  doc.setCreator("StrataCouncil.ca");
  doc.setProducer("StrataCouncil.ca");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const tz = m.meeting.timezone;
  const w = new Writer(doc, font, bold, `Strata Plan ${m.corporation.planNumber} · ${m.meeting.typeLabel} minutes · ${m.meeting.date}`);

  // The strata management letterhead: logo, then the company and manager lines.
  if (opts.letterhead) {
    const lh = opts.letterhead;
    // A logo that can't be drawn is left off rather than failing the minutes.
    const image = lh.logo
      ? await (lh.logo.type === "png" ? doc.embedPng(lh.logo.bytes) : doc.embedJpg(lh.logo.bytes)).catch(() => null)
      : null;
    if (image) {
      const size = fitWithin(image.width, image.height, 150, 52);
      w.ensure(size.height + 6);
      w.page.drawImage(image, { x: (PAGE.w - size.width) / 2, y: w.y - size.height, width: size.width, height: size.height });
      w.space(size.height + 6);
    }
    for (const l of letterheadLines(lh.details)) w.text(l.text, { size: l.bold ? 10 : 8.5, bold: l.bold, color: l.bold ? INK : MUTED, center: true });
    w.space(4);
    w.rule();
    w.space(4);
  }
  w.text(m.corporation.name, { size: 15, bold: true, center: true });
  w.text(`Strata Plan ${m.corporation.planNumber}`, { size: 9.5, color: MUTED, center: true });
  w.space(4);
  w.rule();
  w.text("MINUTES", { size: 17, bold: true, center: true });
  w.text(m.meeting.typeLabel.toUpperCase(), { size: 12, bold: true, center: true });
  w.space(10);
  w.text(`Date: ${formatMeetingWhen({ meetingDate: m.meeting.date, startTime: null, timezone: tz })}`, { color: MUTED });
  w.text(`Time: ${clockTime(m.meeting.calledToOrderAt, tz)} - ${clockTime(m.meeting.adjournedAt, tz)}`, { color: MUTED });
  w.text(`Format: ${m.meeting.format}${m.meeting.location ? ` · ${m.meeting.location}` : ""}`, { color: MUTED });
  if (m.meeting.chair) w.text(`Chair: ${m.meeting.chair}`, { color: MUTED });

  const heading = (t: string) => {
    w.space(12);
    w.ensure(40);
    w.text(t.toUpperCase(), { size: 11, bold: true });
    w.space(2);
  };

  heading("Attendance");
  for (const l of attendanceLines(m)) w.text(l);
  heading("Call to order");
  w.text(m.calledToOrder ? `The meeting was called to order at ${clockTime(m.meeting.calledToOrderAt, tz)}.` : "Quorum was not achieved and the meeting was not called to order.");

  for (const s of m.sections) {
    heading(s.name);
    for (const it of s.items) {
      w.space(6);
      w.ensure(30);
      w.text(`${it.num}. ${it.title}`, { bold: true });
      if (it.summary) w.text(it.summary);
      if (it.motion?.text) {
        w.text(`Moved by ${it.motion.mover || "--"}, seconded by ${it.motion.seconder || "--"}:`, { color: MUTED, indent: 12 });
        w.text(`"${it.motion.text}"`, { indent: 12 });
      }
      if (it.motion?.outcome) {
        w.text(`${it.motion.outcome} -- ${voteLine(it.motion)}`, { bold: true, color: it.motion.outcome === "CARRIED" ? GREEN : RED, indent: 12 });
      }
      if (it.nextMeeting) {
        const n = it.nextMeeting;
        w.text(`Next meeting: ${[n.date, n.time, n.location].filter(Boolean).join(" · ")}`);
      }
    }
  }

  heading("Adjournment");
  w.text(`There being no further business, the meeting was adjourned at ${clockTime(m.meeting.adjournedAt, tz)}.`);

  w.space(36);
  w.ensure(60);
  const y = w.y - 30;
  for (const [x, label] of [
    [PAGE.margin, "Chair"],
    [PAGE.w / 2 + 18, "Secretary"],
  ] as const) {
    w.page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.6, color: INK });
    w.page.drawText(label, { x, y: y - 14, size: 9, font, color: MUTED });
  }
  w.y = y - 30;
  if (opts.finalizedAt) w.text(`Finalized ${opts.finalizedAt.slice(0, 10)} on StrataCouncil.ca`, { size: 8, color: MUTED });

  return doc.save();
}
