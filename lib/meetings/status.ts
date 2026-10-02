/**
 * The status label on a meeting. Adjourned without ever being called to
 * order means quorum wasn't reached: the meeting has to be held again
 * (rescheduling rules to come).
 */
export type MeetingStatusLabel = { label: string; tone: "draft" | "live" | "adjourned" | "no-quorum" };

export function meetingStatus(m: { status: "DRAFT" | "LIVE" | "ADJOURNED"; actualStartAt: string | null }): MeetingStatusLabel {
  if (m.status === "ADJOURNED") {
    return m.actualStartAt ? { label: "Adjourned", tone: "adjourned" } : { label: "No quorum: to be rescheduled", tone: "no-quorum" };
  }
  if (m.status === "LIVE") return { label: "In progress", tone: "live" };
  return { label: "Draft", tone: "draft" };
}
