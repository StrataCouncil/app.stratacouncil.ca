import {
  groupByCategory,
  isAdjournment,
  isCallToOrder,
  meetingFormatLabels,
  meetingTypeLabels,
  type AgendaItem,
  type DecisionType,
  type MeetingFormat,
  type MeetingType,
} from "./agenda.ts";
import { minutesSummary, quorum, type AttendanceStatus } from "./rules.ts";

/**
 * Minutes as structured data (meetings.minutes_content), built once at
 * adjournment from the final agenda and attendance, then edited in draft
 * (summaries only) and frozen when finalized. Exports render from this.
 * Private notes are never part of it.
 */
export interface MinutesItem {
  id: string;
  num: number;
  title: string;
  summary: string;
  deferred: boolean;
  motion: null | {
    text: string;
    mover: string;
    seconder: string;
    outcome: "CARRIED" | "DEFEATED" | null;
    for: number;
    against: number;
    abstain: number;
    dt: DecisionType;
  };
  nextMeeting?: { date: string; time: string; location: string };
}

export interface MinutesContent {
  version: 1;
  corporation: { planNumber: string; name: string; address: string | null };
  meeting: {
    type: MeetingType;
    typeLabel: string;
    date: string;
    timezone: string;
    scheduledStart: string | null;
    calledToOrderAt: string | null;
    adjournedAt: string;
    format: string;
    location: string | null;
    chair: string | null;
  };
  attendance: {
    general: boolean;
    present: string[];
    regrets: string[];
    proxies: string[];
    absentCount: number;
    quorumRequired: number;
    quorumMet: boolean;
  };
  calledToOrder: boolean;
  sections: Array<{ name: string; items: MinutesItem[] }>;
}

export function buildMinutes(input: {
  corporation: { planNumber: string; name: string; address: string | null };
  meeting: {
    type: MeetingType;
    meetingDate: string;
    startTime: string | null;
    timezone: string;
    format: MeetingFormat;
    location: string | null;
    chairName: string | null;
    actualStartAt: string | null;
  };
  agenda: AgendaItem[];
  attendance: Record<string, AttendanceStatus>;
  lotCount: number;
  councilCount: number;
  adjournedAt: string;
}): MinutesContent {
  const { meeting, attendance } = input;
  const general = meeting.type === "agm" || meeting.type === "sgm";
  const byStatus = (s: AttendanceStatus) => Object.keys(attendance).filter((k) => attendance[k] === s).sort();
  const q = quorum(meeting.type, { lotCount: input.lotCount, councilCount: input.councilCount, attendance });
  const present = byStatus("present");
  const proxies = byStatus("proxy");

  const sections = groupByCategory(input.agenda.filter((it) => !isCallToOrder(it) && !isAdjournment(it))).map((cat) => ({
    name: cat.name,
    items: cat.items.map(
      (it): MinutesItem => ({
        id: it.id,
        num: it.num,
        title: it.text,
        summary: it.minutesSummary || minutesSummary(it),
        deferred: it.deferred && !it.done,
        motion:
          it.motion && (it.motion.text || it.done)
            ? {
                text: it.motion.text,
                mover: it.motion.mover,
                seconder: it.motion.sec,
                outcome: it.done ? it.motion.outcome : null,
                for: it.motion.for,
                against: it.motion.against,
                abstain: it.motion.abstain,
                dt: it.motion.dt,
              }
            : null,
        nextMeeting: it.nextMeeting && (it.nextMeeting.date || it.nextMeeting.location) ? it.nextMeeting : undefined,
      })
    ),
  }));

  return {
    version: 1,
    corporation: input.corporation,
    meeting: {
      type: meeting.type,
      typeLabel: meetingTypeLabels[meeting.type],
      date: meeting.meetingDate,
      timezone: meeting.timezone,
      scheduledStart: meeting.startTime,
      calledToOrderAt: meeting.actualStartAt,
      adjournedAt: input.adjournedAt,
      format: meetingFormatLabels[meeting.format],
      location: meeting.location,
      chair: meeting.chairName,
    },
    attendance: {
      general,
      present,
      regrets: byStatus("regrets"),
      proxies,
      absentCount: general ? Math.max(0, input.lotCount - present.length - proxies.length) : 0,
      quorumRequired: q.required,
      quorumMet: q.met,
    },
    calledToOrder: Boolean(meeting.actualStartAt),
    sections,
  };
}

/** "7:02 p.m. PDT" in the meeting's own time zone. */
export function clockTime(iso: string | null, timezone: string) {
  if (!iso) return "—";
  return new Date(iso)
    .toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short" });
}

export function attendanceLines(m: MinutesContent): string[] {
  const a = m.attendance;
  const lines: string[] = [];
  if (a.general) {
    lines.push(
      `${a.present.length} strata lot${a.present.length === 1 ? "" : "s"} present${a.proxies.length ? `, ${a.proxies.length} represented by proxy` : ""}, ${a.absentCount} absent.`
    );
  } else {
    if (a.present.length) lines.push(`Council members present: ${a.present.join(", ")}`);
    if (a.regrets.length) lines.push(`Regrets: ${a.regrets.join(", ")}`);
  }
  const counted = a.present.length + (a.general ? a.proxies.length : 0);
  lines.push(
    `${counted} ${a.general ? "lots counted toward quorum" : "present"}. Quorum requires ${a.quorumRequired}. ${a.quorumMet ? "Quorum confirmed." : "Quorum not met."}`
  );
  return lines;
}

export function voteLine(motion: NonNullable<MinutesItem["motion"]>) {
  return `${motion.for} in favour, ${motion.against} opposed${motion.abstain ? `, ${motion.abstain} abstaining` : ""}`;
}
