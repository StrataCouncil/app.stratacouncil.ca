import type { MeetingType } from "@/lib/meetings/agenda";

/**
 * The one naming pattern for every file StrataCouncil.ca exports
 * (Jeremy, 2026-10-05: "uniform for every doc we export ... clean and
 * tight"):
 *
 *   PLAN_YYYY-MM-DD_Document-Name.ext
 *   EPS-9048_2026-10-05_Council-Meeting-Agenda.docx
 *
 * The plan number as the app shows it, the date the document is about (a
 * meeting's date, otherwise the day it was exported, Pacific time), then
 * the document in hyphenated title case. Underscores only separate the
 * three parts.
 */
export function exportFileName(planNumber: string, date: string, documentName: string, ext: string): string {
  const plan = planNumber.trim().replace(/[^A-Za-z0-9-]/g, "") || "Strata";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInBC();
  return `${plan}_${day}_${documentSlug(documentName)}.${ext.replace(/^\./, "").toLowerCase()}`;
}

/** "Draft minutes" -> "Draft-Minutes"; keeps short capitalised words (AGM) as they are. */
export function documentSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join("-") || "Document"
  );
}

const meetingNames: Record<MeetingType, string> = {
  council: "Council Meeting",
  agm: "AGM",
  sgm: "SGM",
  committee: "Committee Meeting",
};

/** "Council Meeting Agenda", "AGM Minutes", "SGM Draft Minutes". */
export function meetingDocumentName(type: MeetingType, document: "Agenda" | "Minutes" | "Draft Minutes"): string {
  return `${meetingNames[type]} ${document}`;
}

/** Today's date in British Columbia, as YYYY-MM-DD. */
export function todayInBC(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
