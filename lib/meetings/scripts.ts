import { isAdjournment, isNextMeeting, type AgendaItem, type MeetingType } from "./agenda.ts";
import { isGeneralMeeting } from "./rules.ts";

/**
 * What the chair can read aloud. Lines in [brackets] are stage directions,
 * not spoken. Pure, so the wording is the same wherever it's shown.
 */

function greeting(now: Date, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function clock(now: Date, timezone: string) {
  return now.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

export function callToOrderScript(opts: {
  type: MeetingType;
  planNumber: string;
  chair: string | null;
  quorumMet: boolean;
  counted: number;
  required: number;
  timezone: string;
  now?: Date;
}): { title: string; lines: string[] } {
  const now = opts.now ?? new Date();
  const g = greeting(now, opts.timezone);
  const t = clock(now, opts.timezone);
  const general = isGeneralMeeting(opts.type);
  const body = general ? "the Owners" : "the Strata Council";

  if (!opts.quorumMet && opts.counted > 0) {
    return {
      title: "No quorum: adjournment script",
      lines: [
        `"Good ${g}, everyone. I would like to note for the record that we have attempted to call this meeting of ${body} of Strata Plan ${opts.planNumber} to order at ${t}."`,
        "[State the attendance and the quorum requirement.]",
        `"Unfortunately, quorum has not been achieved. We currently have ${opts.counted} ${general ? "lots represented" : opts.counted === 1 ? "member present" : "members present"}, and ${opts.required} are required for quorum under ${general ? "the Strata Property Act and the bylaws" : "the bylaws"}."`,
        general
          ? `"Under the Strata Property Act, if quorum is not present within 30 minutes of the scheduled start, the meeting stands adjourned to the same day in the next week, at the same place and time, unless the bylaws provide otherwise. The eligible voters present at that adjourned meeting will constitute a quorum."`
          : `"As we do not have quorum, no resolutions may be passed at this meeting. We will adjourn and reschedule, and notice of the new date will follow."`,
        `"The meeting is therefore adjourned at ${t}."`,
      ],
    };
  }
  if (general) {
    const label = opts.type === "agm" ? "Annual General Meeting of the Owners" : "Special General Meeting of the Owners";
    return {
      title: "Call to Order script",
      lines: [
        `"Good ${g}, everyone. I would like to call the ${label} of Strata Plan ${opts.planNumber} to order at ${t}.${opts.chair ? ` My name is ${opts.chair}, and I will be chairing this meeting.` : ""}"`,
        "[If the chair needs to be elected, do that first.]",
        `"You are reminded that only eligible voters may move or second motions, and all speakers should be recognized by the chair before speaking."`,
        `"Before proceeding, I will confirm registration and that quorum has been established in accordance with the Strata Property Act and the bylaws."`,
        "[Pause to confirm.]",
        `"Quorum has been achieved, and the meeting is duly constituted."`,
      ],
    };
  }
  return {
    title: "Call to Order script",
    lines: [
      `"Good ${g}, everyone. I would like to call this meeting of the Strata Council for Strata Plan ${opts.planNumber} to order at ${t}. Before we begin, I will confirm attendance and that quorum has been achieved."`,
      "[Pause to confirm attendance.]",
      `"Quorum is present."`,
    ],
  };
}

export function itemScript(it: AgendaItem): string | null {
  if (isAdjournment(it)) {
    return `"Is there a motion to adjourn? … Moved by — seconded by — all in favour? … The motion is CARRIED. This meeting is adjourned at [time]. Thank you all for attending."`;
  }
  if (isNextMeeting(it)) {
    return `"Before we adjourn, we need to set the date for our next meeting. Does the council have any preferences for the next meeting date?"`;
  }
  const dt = it.motion?.dt;
  if (it.type === "FOR_INFORMATION") {
    return `"${it.text} is presented for information. [Present the content.] Any questions or discussion? … The item is received and placed on file."`;
  }
  if (dt === "THREE_QUARTER" || dt === "EIGHTY_PERCENT") {
    const label = dt === "THREE_QUARTER" ? "Three-Quarter (3/4)" : "80%";
    return `"This item requires a ${label} vote. The resolution wording was included in the meeting notice. [Read the resolution.] Moved by — seconded by — discussion? … Those in favour raise your hand — [count]. Those opposed — [count]. Any abstentions? — [count]. The ${label} resolution is [CARRIED/DEFEATED]."`;
  }
  if (dt === "UNANIMOUS") {
    return `"This item requires a Unanimous vote — every eligible voter must be in favour. [Read the resolution.] Moved by — seconded by — discussion? … Those in favour — [count]. Those opposed — [count]. Any abstentions? The Unanimous resolution is [CARRIED/DEFEATED]."`;
  }
  if (it.motion) {
    return `"[Introduce ${it.text}.] Is there a motion? … Moved by — seconded by — discussion? … Those in favour raise your hand. Those opposed. Any abstentions? The motion is [CARRIED/DEFEATED] by majority vote."`;
  }
  if (it.type === "FOR_DISCUSSION") {
    return `"The next item is ${it.text}, for discussion. [Introduce the topic.] The floor is open for discussion. … Thank you. Are there any further comments?"`;
  }
  return null;
}

/** Wall-clock date and time in a zone, as a UTC instant. */
export function zonedInstant(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return asUtc - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}
