/**
 * Live voting (0073): what a follower's screen gets from
 * live_meeting_state(), and how a closed vote becomes the motion's counts.
 * Council meetings only for now. Shared by Meeting Mode (the runner) and
 * the members' live page; no app imports, so the unit tests can load it.
 */

export type Choice = "for" | "against" | "abstain";

export interface LiveConflict {
  itemId: string;
  lot: string;
  note: string;
}

export interface LiveBallot {
  lot: string;
  choice: Choice;
  /** Entered by the runner for someone else. */
  forOther: boolean;
  at: string;
}

export interface OpenVote {
  id: string;
  itemId: string;
  motion: string;
  decisionType: string;
  openedAt: string;
  eligibleLots: string[];
  votedCount: number;
  /** The signed-in member's own ballot, if they've voted. */
  myBallot: Choice | null;
  /** Every ballot: the runner only. */
  ballots: LiveBallot[] | null;
}

export interface ClosedVote {
  id: string;
  itemId: string;
  for: number;
  against: number;
  abstain: number;
  missing: number;
  present: number;
  closedAt: string;
}

/** Someone joining or leaving a launched meeting (0074). */
export interface PresenceEvent {
  id: number;
  userId: string | null;
  name: string;
  /** Their council lot, if they have one. */
  lot: string | null;
  event: "joined" | "left" | "marked_left";
  at: string;
}

export interface LiveState {
  status: "DRAFT" | "LIVE" | "ADJOURNED";
  /** Launched (it may not be called to order yet). */
  launched: boolean;
  agenda: unknown;
  attendance: Record<string, string>;
  currentItemId: string | null;
  calledToOrderAt: string | null;
  chair: string | null;
  updatedAt: string;
  isRunner: boolean;
  /** The member's council lot; null for a manager or anyone without a vote. */
  myLot: string | null;
  conflicts: LiveConflict[];
  presence: PresenceEvent[];
  openVote: OpenVote | null;
  closedVotes: ClosedVote[];
}

const CHOICES: readonly string[] = ["for", "against", "abstain"];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
const choice = (v: unknown): Choice | null => (CHOICES.includes(v as string) ? (v as Choice) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** live_meeting_state() as returned, checked field by field. Null when the caller may not follow. */
export function parseLiveState(raw: unknown): LiveState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = obj(raw);
  const status = r.status === "LIVE" || r.status === "ADJOURNED" ? r.status : "DRAFT";
  const ov = r.openVote ? obj(r.openVote) : null;
  return {
    status,
    launched: r.launched === true || status === "LIVE",
    agenda: r.agenda ?? [],
    attendance: Object.fromEntries(Object.entries(obj(r.attendance)).map(([k, v]) => [k, str(v)])),
    currentItemId: str(r.currentItemId) || null,
    calledToOrderAt: str(r.calledToOrderAt) || null,
    chair: str(r.chair) || null,
    updatedAt: str(r.updatedAt),
    isRunner: r.isRunner === true,
    myLot: str(r.myLot) || null,
    conflicts: arr(r.conflicts).map((c) => {
      const o = obj(c);
      return { itemId: str(o.itemId), lot: str(o.lot), note: str(o.note) };
    }),
    presence: arr(r.presence)
      .map((p) => {
        const o = obj(p);
        const event = o.event === "joined" || o.event === "left" || o.event === "marked_left" ? o.event : null;
        return event ? { id: int(o.id), userId: str(o.userId) || null, name: str(o.name), lot: str(o.lot) || null, event, at: str(o.at) } : null;
      })
      .filter((p): p is PresenceEvent => p !== null),
    openVote: ov
      ? {
          id: str(ov.id),
          itemId: str(ov.itemId),
          motion: str(ov.motion),
          decisionType: str(ov.decisionType),
          openedAt: str(ov.openedAt),
          eligibleLots: arr(ov.eligibleLots).map(str).filter(Boolean),
          votedCount: int(ov.votedCount),
          myBallot: choice(ov.myBallot),
          ballots: Array.isArray(ov.ballots)
            ? ov.ballots
                .map((b) => {
                  const o = obj(b);
                  const c = choice(o.choice);
                  return c ? { lot: str(o.lot), choice: c, forOther: o.forOther === true, at: str(o.at) } : null;
                })
                .filter((b): b is LiveBallot => b !== null)
            : null,
        }
      : null,
    closedVotes: arr(r.closedVotes).map((v) => {
      const o = obj(v);
      return {
        id: str(o.id),
        itemId: str(o.itemId),
        for: int(o.for),
        against: int(o.against),
        abstain: int(o.abstain),
        missing: int(o.missing),
        present: int(o.present),
        closedAt: str(o.closedAt),
      };
    }),
  };
}

/** Lots with a declared conflict on this item. */
export function conflictedLots(conflicts: LiveConflict[], itemId: string): string[] {
  return [...new Set(conflicts.filter((c) => c.itemId === itemId).map((c) => c.lot))].sort();
}

/**
 * Council members present for this item's votes: those marked present,
 * less anyone who declared a conflict on it (they leave the meeting while
 * it's discussed and voted on, SPA s.32).
 */
export function presentForItem(presentLots: string[], conflicts: LiveConflict[], itemId: string): string[] {
  const out = new Set(conflictedLots(conflicts, itemId));
  return presentLots.filter((l) => !out.has(l));
}

/**
 * A closed vote as the motion's counts. Someone present who didn't vote is
 * recorded as abstaining: a council decision needs a majority of the
 * members present (Standard Bylaws 18(1)), so a non-vote has the same
 * effect as an abstention, and the counts then add up to those present.
 */
export function motionCounts(v: Pick<ClosedVote, "for" | "against" | "abstain" | "missing">) {
  return { for: v.for, against: v.against, abstain: v.abstain + v.missing };
}

/** "2 of 4 have voted". */
export function votedLine(v: Pick<OpenVote, "votedCount" | "eligibleLots">) {
  return `${v.votedCount} of ${v.eligibleLots.length} ${v.eligibleLots.length === 1 ? "has" : "have"} voted`;
}

export const choiceLabels: Record<Choice, string> = { for: "For", against: "Against", abstain: "Abstain" };

/** The minutes line for an item's declared conflicts. */
export function conflictLine(lots: string[]): string {
  if (lots.length === 0) return "";
  const list = lots.length === 1 ? lots[0] : `${lots.slice(0, -1).join(", ")} and ${lots[lots.length - 1]}`;
  return lots.length === 1
    ? `${list} declared a conflict of interest, left the meeting for this item and did not vote.`
    : `${list} declared conflicts of interest, left the meeting for this item and did not vote.`;
}

/** Who's in the meeting now: each person's latest event is a join. */
export function inMeeting(presence: PresenceEvent[]): PresenceEvent[] {
  const last = new Map<string, PresenceEvent>();
  for (const p of [...presence].sort((a, b) => a.id - b.id)) last.set(p.userId ?? `lot:${p.lot}`, p);
  return [...last.values()].filter((p) => p.event === "joined");
}

/**
 * The attendance after applying join and leave events the screen hasn't
 * applied yet (ids above `afterId`): joining marks a council lot present,
 * leaving marks it left. Lots without a council seat aren't in attendance.
 */
export function applyPresence(
  attendance: Record<string, string>,
  presence: PresenceEvent[],
  afterId: number
): { attendance: Record<string, string>; lastId: number; changed: boolean } {
  const out = { ...attendance };
  let lastId = afterId;
  let changed = false;
  for (const p of [...presence].sort((a, b) => a.id - b.id)) {
    if (p.id <= afterId) continue;
    lastId = Math.max(lastId, p.id);
    if (!p.lot) continue;
    const next = p.event === "joined" ? "present" : out[p.lot] === "present" ? "left" : out[p.lot];
    if (next && out[p.lot] !== next) {
      out[p.lot] = next;
      changed = true;
    }
  }
  return { attendance: out, lastId, changed };
}

/**
 * Agenda items that don't take a conflict of interest: the procedural ones
 * (Call to Order, approving the agenda or minutes, electing a chair, the
 * next meeting date, adjournment). Matched by title, as the rest of the
 * meeting rules are.
 */
export function takesConflicts(text: string): boolean {
  const t = text.toLowerCase();
  return !(
    t.includes("call to order") ||
    t.includes("adjourn") ||
    (t.includes("approv") && (t.includes("agenda") || t.includes("minutes"))) ||
    (t.includes("adopt") && (t.includes("agenda") || t.includes("minutes"))) ||
    (t.includes("elect") && t.includes("chair")) ||
    t.includes("next meeting")
  );
}

/** "SL005 joined the meeting at 7:42 p.m." and "SL019 left the meeting at 8:15 p.m.", for the minutes. */
export function movementLines(presence: PresenceEvent[], calledToOrderAt: string | null, time: (iso: string) => string): string[] {
  if (!calledToOrderAt) return [];
  const start = Date.parse(calledToOrderAt);
  return [...presence]
    .filter((p) => p.lot && Date.parse(p.at) > start)
    .sort((a, b) => a.id - b.id)
    .map((p) => `${p.lot} ${p.event === "joined" ? "joined" : "left"} the meeting at ${time(p.at)}.`);
}
