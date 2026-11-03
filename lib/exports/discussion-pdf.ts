import { PDFDocument, StandardFonts } from "pdf-lib";
import { GREEN, INK, MUTED, RED, Writer } from "@/lib/exports/minutes-pdf";
import { RESULT_LABELS, tallyLine, VOTE_LABELS, type DiscussionResult, type DiscussionVote } from "@/lib/discussions/tally";

/**
 * The record of a council discussion's vote (0070), filed in Meetings &
 * Records when the author closes it, and filed again with its last line
 * once a council meeting has ratified it (or not). The motion, its
 * background, how each member voted, any conflicts declared, and the
 * result. Comments stay on the discussion; they aren't part of the record.
 */
export interface DiscussionRecord {
  corporation: { planNumber: string; name: string };
  title: string;
  motion: string;
  background: string;
  financial: string;
  risks: string;
  authorName: string;
  openedAt: string;
  closedAt: string;
  voters: Array<{ name: string; vote: DiscussionVote | null; recusalReason: string | null; votedAt: string | null }>;
  counts: { for: number; against: number; abstain: number; recused: number; missing: number };
  result: DiscussionResult;
  attachments: string[];
  ratification: { ratified: boolean; meetingDate: string } | null;
}

const TZ = "America/Vancouver";
const longDate = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "long", day: "numeric" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: TZ, year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export async function discussionPdf(r: DiscussionRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Council vote: ${r.title}`);
  doc.setCreator("StrataCouncil.ca");
  doc.setProducer("StrataCouncil.ca");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `Strata Plan ${r.corporation.planNumber} · Council vote between meetings`);

  w.text(r.corporation.name, { size: 15, bold: true, center: true });
  w.text(`Strata Plan ${r.corporation.planNumber}`, { size: 9.5, color: MUTED, center: true });
  w.space(4);
  w.rule();
  w.text("COUNCIL VOTE BETWEEN MEETINGS", { size: 14, bold: true, center: true });
  w.text("Subject to ratification at a council meeting", { size: 9.5, color: MUTED, center: true });
  w.space(10);
  w.text(r.title, { size: 13, bold: true });
  // Times end in "a.m." or "p.m.", so the lines don't add a full stop of their own.
  w.text(`Opened by ${r.authorName || "a council member"}: ${when(r.openedAt)}`, { color: MUTED });
  w.text(`Closed: ${when(r.closedAt)}`, { color: MUTED });
  w.space(8);

  w.text("Motion", { bold: true });
  w.text(r.motion);
  for (const [label, body] of [
    ["Background and rationale", r.background],
    ["Financial implications", r.financial],
    ["Risks and compliance", r.risks],
  ] as const) {
    if (!body.trim()) continue;
    w.space(6);
    w.text(label, { bold: true });
    w.text(body);
  }
  if (r.attachments.length) {
    w.space(6);
    w.text("Attachments", { bold: true });
    for (const a of r.attachments) w.text(`· ${a}`, { indent: 8 });
  }

  w.space(10);
  w.rule();
  w.text("Votes", { bold: true });
  for (const v of r.voters) {
    const line = v.vote ? VOTE_LABELS[v.vote] : "Didn't vote";
    w.text(`${v.name || "Council member"}: ${line}${v.votedAt ? ` (${when(v.votedAt)})` : ""}`, { indent: 8 });
    if (v.vote === "recused" && v.recusalReason) w.text(`Conflict declared: ${v.recusalReason}`, { indent: 20, color: MUTED });
  }
  w.space(6);
  w.text(`${tallyLine(r.counts)}.`, { color: MUTED });
  w.space(6);
  w.text(`Result: ${RESULT_LABELS[r.result]}.`, { bold: true, color: r.result === "supported" ? GREEN : r.result === "not_supported" ? RED : INK });
  if (r.ratification) {
    w.text(
      r.ratification.ratified
        ? `Ratified at the council meeting of ${longDate(r.ratification.meetingDate)}.`
        : `Not ratified at the council meeting of ${longDate(r.ratification.meetingDate)}.`,
      { bold: true }
    );
  } else if (r.result === "supported") {
    w.text("Awaiting ratification at a council meeting. A vote between meetings takes effect once council ratifies it at a meeting.", { color: MUTED });
  } else {
    w.text("The motion didn't pass, so it won't go to a meeting for ratification.", { color: MUTED });
  }
  return doc.save();
}
