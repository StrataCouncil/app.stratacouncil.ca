import type { AgendaItem, DecisionType, MeetingType, Motion } from "./agenda.ts";

/**
 * Meeting rules: quorum, vote thresholds, and the standard minutes text.
 * Pure; shared by Meeting Mode, minutes generation and their tests.
 */

export type AttendanceStatus = "" | "present" | "regrets" | "proxy";

export const isGeneralMeeting = (type: MeetingType) => type === "agm" || type === "sgm";

/**
 * Quorum. Council (and committee) meetings: a majority of council members
 * present. General meetings: a third of the strata lots, counting lots
 * represented by proxy (proxies count toward quorum at AGM/SGM only).
 */
export function quorum(
  type: MeetingType,
  { lotCount, councilCount, attendance }: { lotCount: number; councilCount: number; attendance: Record<string, AttendanceStatus> }
) {
  const general = isGeneralMeeting(type);
  const required = general ? Math.ceil(lotCount / 3) : Math.ceil(Math.max(councilCount, 1) / 2);
  const values = Object.values(attendance);
  const present = values.filter((v) => v === "present").length;
  const proxies = general ? values.filter((v) => v === "proxy").length : 0;
  const counted = present + proxies;
  return { required, present, proxies, counted, met: counted >= required };
}

/** The roll for attendance: council lots for council/committee meetings, every lot for AGM/SGM. */
export function attendanceRoll(type: MeetingType, lots: string[], councilLots: string[]) {
  return isGeneralMeeting(type) || councilLots.length === 0 ? lots : councilLots;
}

/**
 * Whether a motion passes. Thresholds are on votes cast (for + against);
 * abstentions don't count, except that a unanimous resolution needs every
 * vote, abstentions included, to be in favour.
 */
export function evaluateVote(m: Pick<Motion, "for" | "against" | "abstain" | "dt">) {
  const forVotes = Math.max(0, Math.floor(m.for) || 0);
  const against = Math.max(0, Math.floor(m.against) || 0);
  const abstain = Math.max(0, Math.floor(m.abstain) || 0);
  const cast = forVotes + against;
  const total = cast + abstain;
  let needed: number | null = null;
  if (cast > 0) {
    needed =
      m.dt === "MAJORITY"
        ? Math.floor(cast / 2) + 1
        : m.dt === "THREE_QUARTER"
          ? Math.ceil((cast * 3) / 4)
          : m.dt === "EIGHTY_PERCENT"
            ? Math.ceil(cast * 0.8)
            : total;
  }
  const passing =
    cast > 0 &&
    (m.dt === "MAJORITY"
      ? forVotes > cast / 2
      : m.dt === "THREE_QUARTER"
        ? forVotes >= Math.ceil((cast * 3) / 4)
        : m.dt === "EIGHTY_PERCENT"
          ? forVotes >= Math.ceil(cast * 0.8)
          : forVotes === total && against === 0 && abstain === 0);
  return { cast, total, needed, passing };
}

export const decisionTypeMinutesLabels: Record<DecisionType, string> = {
  MAJORITY: "Majority",
  THREE_QUARTER: "Three-Quarter (3/4)",
  EIGHTY_PERCENT: "80%",
  UNANIMOUS: "Unanimous",
};

/** Minutes record what was done, not what was said. */
export function minutesSummary(it: AgendaItem): string {
  if (it.deferred && !it.done) return `${it.text} was deferred to a future meeting.`;
  const m = it.motion;
  if (it.consensus) return `${it.text} was reviewed and accepted by consensus.`;
  if (it.type === "FOR_INFORMATION" || it.type === "FOR_DISCUSSION" || !m) {
    return `${it.text} was presented for information. The item was received and placed on file.`;
  }
  const outcome = m.outcome ?? "CARRIED";
  const label = decisionTypeMinutesLabels[m.dt] ?? "Majority";
  const tally =
    m.abstain > 0
      ? `${m.for} in favour, ${m.against} opposed, ${m.abstain} abstaining`
      : `${m.for} in favour, ${m.against} opposed`;
  let text = `MOTION: Moved by ${m.mover || "—"}, seconded by ${m.sec || "—"}.\nVOTE: ${tally} — ${outcome} by ${label} vote.`;
  if (m.dt === "THREE_QUARTER" && outcome === "CARRIED" && m.for + m.against > 0) {
    text += " (Note: 3/4 vote resolutions require a one-week implementation delay unless immediate action is required for safety.)";
  }
  if (outcome === "DEFEATED") text += " No further action to be taken on this matter at this time.";
  return text;
}

/** Items with a motion that were neither decided nor explicitly deferred. */
export function unresolvedItems(agenda: AgendaItem[]) {
  return agenda.filter((it) => !it.done && !it.deferred);
}

/** At adjournment: anything left unresolved is deferred, never silently dropped. */
export function deferUnresolved(agenda: AgendaItem[]): AgendaItem[] {
  return agenda.map((it) => (!it.done && !it.deferred ? { ...it, deferred: true } : it));
}
