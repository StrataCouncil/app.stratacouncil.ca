import type { AgendaItem, DecisionType, MeetingType, Motion } from "./agenda.ts";

/**
 * Meeting rules: quorum, vote thresholds, and the standard minutes text.
 * Pure; shared by Meeting Mode, minutes generation and their tests.
 */

export type AttendanceStatus = "" | "present" | "regrets" | "proxy";

export const isGeneralMeeting = (type: MeetingType) => type === "agm" || type === "sgm";

/** Smallest whole number at least a/b, for whole a >= 0 and b > 0, without floating point. */
const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);
const whole = (n: number) => Math.max(0, Math.floor(Number(n)) || 0);

/**
 * Council quorum by the number of council members (Standard Bylaws 16(1)):
 * 1 member, 1; 2 to 4 members, 2; 5 or 6, 3; 7, 4. The Standard Bylaws
 * allow at most 7; a larger council (under its own bylaws) needs a
 * majority.
 */
export function councilQuorum(members: number): number {
  const n = Math.max(1, whole(members));
  if (n === 1) return 1;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n === 7) return 4;
  return Math.floor(n / 2) + 1;
}

/**
 * Quorum.
 *
 * Council and committee meetings: by the size of the council (Standard
 * Bylaws 16(1)). Members attending electronically count as present
 * (17(2)); proxies don't exist at council.
 *
 * General meetings (SPA s.48(2)): eligible voters holding 1/3 of the
 * strata corporation's votes, present in person or by proxy; 2/3 if there
 * are fewer than 4 strata lots or fewer than 4 owners. One vote per lot
 * (s.53(1)); Schedules of Voting Rights and the arrears bar (s.53(2)) come
 * with full general-meeting support.
 */
export function quorum(
  type: MeetingType,
  {
    lotCount,
    councilCount,
    attendance,
    ownerCount,
  }: { lotCount: number; councilCount: number; attendance: Record<string, AttendanceStatus>; ownerCount?: number }
) {
  const general = isGeneralMeeting(type);
  const lots = whole(lotCount);
  const small = lots < 4 || (ownerCount !== undefined && whole(ownerCount) < 4);
  const required = general ? (small ? ceilDiv(2 * lots, 3) : ceilDiv(lots, 3)) : councilQuorum(councilCount);
  const values = Object.values(attendance);
  const present = values.filter((v) => v === "present").length;
  const proxies = general ? values.filter((v) => v === "proxy").length : 0;
  const counted = present + proxies;
  return { required, present, proxies, counted, met: counted >= required };
}

/**
 * The roll for attendance: council lots only for council/committee
 * meetings (never every lot), every lot for AGM/SGM.
 */
export function attendanceRoll(type: MeetingType, lots: string[], councilLots: string[]) {
  return isGeneralMeeting(type) ? lots : councilLots;
}

/**
 * The threshold that actually applies. At council and committee meetings
 * every decision is made by a majority of the members present (Standard
 * Bylaws 18(1)), whatever the motion was marked; 3/4, 80% and unanimous
 * votes are general-meeting thresholds.
 */
export function effectiveDecisionType(type: MeetingType, dt: DecisionType): DecisionType {
  return isGeneralMeeting(type) ? dt : "MAJORITY";
}

export interface VoteContext {
  type: MeetingType;
  /**
   * Council and committee: council members present when the vote is taken.
   * General meetings: eligible voters present in person or by proxy.
   */
  present: number;
  /** General meetings: the votes of all the eligible voters (one per strata lot), for 80% and unanimous votes. */
  eligible: number;
  /** Strata lots in the strata: there is no deciding vote when there are only 2 (Standard Bylaws 18(2), 27(6)). */
  lotCount: number;
}

/** A tie: as many for as against, with at least one of each. */
export function isTie(m: Pick<Motion, "for" | "against">) {
  const f = whole(m.for);
  return f > 0 && f === whole(m.against);
}

/** Whether the president may cast a deciding vote on this tie. */
export function tieBreakAllowed(m: Pick<Motion, "for" | "against">, ctx: Pick<VoteContext, "lotCount">) {
  return isTie(m) && whole(ctx.lotCount) !== 2;
}

/**
 * Whether a motion passes, in whole-number arithmetic (no rounding).
 *
 * Council and committee (Standard Bylaws 18(1)): more than half of the
 * council members present. An abstention counts like a vote against.
 *
 * General meetings (SPA s.1):
 * - majority: more than 1/2 of the votes cast (for + against);
 * - 3/4: at least 3/4 of the votes cast;
 * - 80%: at least 80% of the votes of all the eligible voters, present or not;
 * - unanimous: all the votes of all the eligible voters.
 * Abstentions are not votes cast.
 *
 * On a tie, the president's deciding vote (if cast and allowed) is added.
 */
export function evaluateVote(m: Pick<Motion, "for" | "against" | "abstain" | "dt" | "tieBreak">, ctx: VoteContext) {
  let forVotes = whole(m.for);
  let against = whole(m.against);
  const abstain = whole(m.abstain);
  const tieBroken = Boolean(m.tieBreak) && tieBreakAllowed(m, ctx);
  if (tieBroken && m.tieBreak === "for") forVotes += 1;
  if (tieBroken && m.tieBreak === "against") against += 1;
  const cast = forVotes + against;
  const total = whole(m.for) + whole(m.against) + abstain;
  const present = whole(ctx.present);
  const eligible = whole(ctx.eligible);
  const dt = effectiveDecisionType(ctx.type, m.dt);
  const general = isGeneralMeeting(ctx.type);

  let base: "present" | "cast" | "eligible";
  let of: number;
  let needed: number | null;
  let passing: boolean;
  if (!general) {
    base = "present";
    of = present;
    needed = present > 0 ? Math.floor(present / 2) + 1 : null;
    passing = present > 0 && forVotes * 2 > present;
  } else if (dt === "MAJORITY") {
    base = "cast";
    of = cast;
    needed = cast > 0 ? Math.floor(cast / 2) + 1 : null;
    passing = cast > 0 && forVotes * 2 > cast;
  } else if (dt === "THREE_QUARTER") {
    base = "cast";
    of = cast;
    needed = cast > 0 ? ceilDiv(3 * cast, 4) : null;
    passing = cast > 0 && forVotes * 4 >= cast * 3;
  } else if (dt === "EIGHTY_PERCENT") {
    base = "eligible";
    of = eligible;
    needed = eligible > 0 ? ceilDiv(4 * eligible, 5) : null;
    passing = eligible > 0 && forVotes * 5 >= eligible * 4;
  } else {
    base = "eligible";
    of = eligible;
    needed = eligible > 0 ? eligible : null;
    passing = eligible > 0 && forVotes === eligible && against === 0;
  }
  return { dt, base, of, cast, total, needed, passing, tieBroken };
}

/** "Need 3 of 5 council members present", for the operator while votes are counted. */
export function thresholdText(v: ReturnType<typeof evaluateVote>): string {
  if (v.needed === null) return v.base === "eligible" ? "No eligible voters recorded" : "No votes recorded yet";
  if (v.base === "present") return `Need ${v.needed} of ${v.of} council members present in favour`;
  if (v.base === "cast") return `Need ${v.needed} of ${v.of} votes cast`;
  if (v.dt === "UNANIMOUS") return `Need all ${v.of} eligible votes in favour, present or not`;
  return `Need ${v.needed} of all ${v.of} eligible votes, present or not`;
}

const decisionTypeMinutesLabels: Record<DecisionType, string> = {
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
  const tie =
    m.tieBreak && isTie(m)
      ? ` The vote was tied; the president cast a second, deciding vote ${m.tieBreak === "for" ? "in favour" : "against"}.`
      : "";
  const note = motionNote(it);
  return `MOTION: Moved by ${m.mover || "—"}, seconded by ${m.sec || "—"}.\nVOTE: ${tally} — ${outcome} by ${label} vote.${tie}${note ? ` ${note}` : ""}`;
}

/** The standing note a decided motion carries in the minutes, if any. */
export function motionNote(it: AgendaItem): string {
  const m = it.motion;
  if (!m) return "";
  const outcome = m.outcome ?? "CARRIED";
  if (m.dt === "THREE_QUARTER" && outcome === "CARRIED" && m.for + m.against > 0) {
    return "(Note: 3/4 vote resolutions require a one-week implementation delay unless immediate action is required for safety.)";
  }
  if (outcome === "DEFEATED") return "No further action to be taken on this matter at this time.";
  return "";
}

/** Items with a motion that were neither decided nor explicitly deferred. */
export function unresolvedItems(agenda: AgendaItem[]) {
  return agenda.filter((it) => !it.done && !it.deferred);
}

/** At adjournment: anything left unresolved is deferred, never silently dropped. */
export function deferUnresolved(agenda: AgendaItem[]): AgendaItem[] {
  return agenda.map((it) => (!it.done && !it.deferred ? { ...it, deferred: true } : it));
}
