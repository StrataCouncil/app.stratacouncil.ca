import { tz } from "../time-zone.ts";
import {
  groupByCategory,
  isAdjournment,
  isCallToOrder,
  isNextMeeting,
  meetingFormatLabels,
  meetingTypeLabels,
  type AgendaItem,
  type DecisionType,
  type MeetingFormat,
  type MeetingType,
} from "./agenda.ts";
import { zoneLabel } from "./format.ts";
import { minutesSummary, motionNote, quorum, type AttendanceStatus } from "./rules.ts";
import { conflictLine } from "./live.ts";

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
    /** Late arrivals and departures, with their times (0074). */
    movements?: string[];
  };
  calledToOrder: boolean;
  sections: Array<{ name: string; items: MinutesItem[] }>;
}

/**
 * The item's minutes text. A decided motion's mover, seconder and vote are
 * shown from the structured motion, so an untouched auto-generated summary
 * is reduced to its standing note instead of repeating them; anything the
 * chair wrote is kept as written.
 */
/** A vote was held on the item (a decided motion, not consensus). */
const voteHeld = (it: AgendaItem) => Boolean(it.motion && it.done && !it.consensus && it.motion.for + it.motion.against + it.motion.abstain > 0);

function summaryFor(it: AgendaItem): string {
  const written = it.minutesSummary.trim();
  const n = it.nextMeeting;
  if (isNextMeeting(it) && n?.date && !written) {
    return `The next meeting is scheduled for ${n.date}${n.time ? ` at ${n.time}` : ""}${n.location ? `, ${n.location}` : ""}.`;
  }
  const auto = minutesSummary(it);
  if (written && written !== auto.trim()) return written;
  if (it.motion && it.done && !it.consensus) return motionNote(it);
  return auto;
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
  /** "SL005 joined the meeting at 7:42 p.m.", from the join and leave log. */
  movements?: string[];
}): MinutesContent {
  const { meeting, attendance } = input;
  const general = meeting.type === "agm" || meeting.type === "sgm";
  const byStatus = (s: AttendanceStatus) => Object.keys(attendance).filter((k) => attendance[k] === s).sort();
  // The minutes' quorum line is for the meeting as held: anyone who left
  // before the end was present when it was called to order.
  const attended = Object.fromEntries(Object.entries(attendance).map(([k, v]) => [k, v === "left" ? "present" : v])) as Record<string, AttendanceStatus>;
  const q = quorum(meeting.type, { lotCount: input.lotCount, councilCount: input.councilCount, attendance: attended });
  // Everyone who attended, including anyone who left before the end.
  const present = [...byStatus("present"), ...byStatus("left")].sort();
  const proxies = byStatus("proxy");

  const sections = groupByCategory(input.agenda.filter((it) => !isCallToOrder(it) && !isAdjournment(it))).map((cat) => ({
    name: cat.name,
    items: cat.items.map(
      (it): MinutesItem => ({
        id: it.id,
        num: it.num,
        title: it.text,
        // A declared conflict (SPA s.32) is part of the record of the item.
        summary: [conflictLine(it.conflicts ?? [], voteHeld(it)), summaryFor(it)].filter(Boolean).join(" "),
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
        // Shown separately only when the chair wrote their own summary.
        nextMeeting: it.nextMeeting?.date && it.minutesSummary.trim() ? it.nextMeeting : undefined,
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
      ...(input.movements?.length ? { movements: input.movements } : {}),
    },
    calledToOrder: Boolean(meeting.actualStartAt),
    sections,
  };
}

/** "7:02 p.m. PT" in the meeting's own time zone (never PDT or PST). */
export function clockTime(iso: string | null, timezone: string) {
  if (!iso) return "—";
  const time = new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: tz(timezone, iso) });
  return `${time} ${zoneLabel(timezone)}`;
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
  for (const l of a.movements ?? []) lines.push(l);
  return lines;
}

export function voteLine(motion: NonNullable<MinutesItem["motion"]>) {
  // Everyone voting in favour, none opposed or abstaining: unanimous.
  if (motion.for > 0 && !motion.against && !motion.abstain) return `unanimous, ${motion.for} in favour`;
  return `${motion.for} in favour, ${motion.against} opposed${motion.abstain ? `, ${motion.abstain} abstaining` : ""}`;
}
