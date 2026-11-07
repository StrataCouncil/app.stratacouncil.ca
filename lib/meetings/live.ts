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
  /**
   * The person running the meeting has acknowledged it (0082): the member
   * has stepped out. A member's own declaration waits for this; one the
   * runner records is acknowledged at once.
   */
  acknowledged: boolean;
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
  /** marked_joined and marked_left were entered by whoever runs the meeting (0075). */
  event: "joined" | "marked_joined" | "left" | "marked_left";
  at: string;
}

/** An attachment the runner is showing to everyone (0076), read from the saved agenda. */
export interface Presenting {
  itemId: string;
  attId: string;
  title: string;
  documentId: string | null;
  /** A web link (http or https only). */
  url: string | null;
  at: string;
}

/** meetings.presenting as stored, checked field by field. */
export function parsePresenting(raw: unknown): Presenting | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const url = s(o.url);
  const p = { itemId: s(o.itemId), attId: s(o.attId), title: s(o.title), documentId: s(o.documentId) || null, url: /^https?:\/\//i.test(url) ? url : null, at: s(o.at) };
  return p.itemId && p.attId && (p.documentId || p.url) ? p : null;
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
  /** What the runner is showing to everyone, if anything (0076). */
  presenting: Presenting | null;
  /** When the Runner's screen last checked in (0079); null before it has. */
  runnerSeenAt: string | null;
  /** The latest change of who runs the meeting (0079), if any. */
  lastHandover: Handover | null;
}

export type Handover = { toUser: string; fromName: string; toName: string; kind: "handed_over" | "took_over"; at: string };

/** The Runner's screen has gone quiet for 2 minutes: the meeting is paused and can be taken over (0079). */
export function runnerAway(state: Pick<LiveState, "runnerSeenAt" | "status">, now: number): boolean {
  if (state.status === "ADJOURNED" || !state.runnerSeenAt) return false;
  return now - Date.parse(state.runnerSeenAt) > 2 * 60 * 1000;
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
    presenting: parsePresenting(r.presenting),
    runnerSeenAt: null,
    lastHandover: null,
    conflicts: arr(r.conflicts).map((c) => {
      const o = obj(c);
      // Before 0082 every conflict took effect at once.
      return { itemId: str(o.itemId), lot: str(o.lot), note: str(o.note), acknowledged: o.acknowledged !== false };
    }),
    presence: arr(r.presence)
      .map((p) => {
        const o = obj(p);
        const event = o.event === "joined" || o.event === "marked_joined" || o.event === "left" || o.event === "marked_left" ? o.event : null;
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

/** Lots that have stepped out for this item: their conflict is acknowledged. */
export function conflictedLots(conflicts: LiveConflict[], itemId: string): string[] {
  return [...new Set(conflicts.filter((c) => c.itemId === itemId && c.acknowledged).map((c) => c.lot))].sort();
}

/** What the video shows someone who has stepped out for the item the meeting is on. */
export const STEPPED_OUT_VIDEO = "You've stepped out for this item because of your conflict of interest. The video comes back when the meeting moves on.";

/** Declarations on this item still waiting for the person running the meeting. */
export function pendingConflicts(conflicts: LiveConflict[], itemId: string): LiveConflict[] {
  return conflicts.filter((c) => c.itemId === itemId && !c.acknowledged);
}

/**
 * People to keep out of the video while the meeting is on this item: the
 * accounts of every lot that has stepped out for it (from the join log).
 */
export function steppedOutUsers(conflicts: LiveConflict[], itemId: string | null, presence: PresenceEvent[]): string[] {
  if (!itemId) return [];
  const lots = new Set(conflictedLots(conflicts, itemId));
  return [...new Set(presence.filter((p) => p.lot && lots.has(p.lot) && p.userId).map((p) => p.userId as string))];
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

/** A declared conflict as the minutes record it. */
export interface ConflictRecord {
  lot: string;
  /** Its nature, as declared (SPA s.32). */
  note: string;
  /** Acknowledged by the person running the meeting: they stepped out. */
  left: boolean;
}

/**
 * The minutes lines for an item's declared conflicts, one sentence each:
 * the lot, the nature of the interest, and that they left for the item (and,
 * where a vote was held, didn't vote). Lot numbers only: no names.
 */
export function conflictLine(conflicts: ConflictRecord[], voteHeld: boolean): string {
  return [...conflicts]
    .sort((a, b) => a.lot.localeCompare(b.lot))
    .map((c) => {
      const nature = c.note.trim().replace(/[.;:,\s]+$/, "");
      const declared = `${c.lot} declared a conflict of interest${nature ? ` (${nature})` : ""}`;
      if (!c.left) return `${declared}.`;
      return voteHeld ? `${declared}, left the meeting for this item, and did not vote.` : `${declared} and left the meeting for this item.`;
    })
    .join(" ");
}

/** Who's in the meeting now: each person's latest event is a join. */
export function inMeeting(presence: PresenceEvent[]): PresenceEvent[] {
  const last = new Map<string, PresenceEvent>();
  // One line per council lot, however they joined; people without a lot by account.
  for (const p of [...presence].sort((a, b) => a.id - b.id)) last.set(p.lot ? `lot:${p.lot}` : `user:${p.userId}`, p);
  return [...last.values()].filter((p) => isJoin(p.event));
}

/** Joined online or marked present by the runner. */
export function isJoin(event: PresenceEvent["event"]) {
  return event === "joined" || event === "marked_joined";
}

/**
 * The attendance after applying join and leave events the screen hasn't
 * applied yet (ids above `afterId`): joining marks a council lot present,
 * leaving marks it left. Lots without a council seat aren't in attendance.
 */
export function applyPresence(
  attendance: Record<string, string>,
  presence: PresenceEvent[],
  afterId: number,
  /** Leaving before Call to Order just clears the lot, as the database does (0075). */
  calledToOrderAt: string | null = null
): { attendance: Record<string, string>; lastId: number; changed: boolean } {
  const out = { ...attendance };
  let lastId = afterId;
  let changed = false;
  for (const p of [...presence].sort((a, b) => a.id - b.id)) {
    if (p.id <= afterId) continue;
    lastId = Math.max(lastId, p.id);
    if (!p.lot) continue;
    if (!isJoin(p.event) && out[p.lot] === "present" && (!calledToOrderAt || Date.parse(p.at) < Date.parse(calledToOrderAt))) {
      delete out[p.lot];
      changed = true;
      continue;
    }
    const next = isJoin(p.event) ? "present" : out[p.lot] === "present" ? "left" : out[p.lot];
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
export function movementLines(
  presence: PresenceEvent[],
  calledToOrderAt: string | null,
  time: (iso: string) => string,
  handovers: Array<Pick<Handover, "fromName" | "toName" | "kind" | "at">> = []
): string[] {
  const start = calledToOrderAt ? Date.parse(calledToOrderAt) : null;
  const moves = start === null
    ? []
    : [...presence]
        .filter((p) => p.lot && Date.parse(p.at) > start)
        .sort((a, b) => a.id - b.id)
        .map((p) => ({ at: Date.parse(p.at), line: `${p.lot} ${isJoin(p.event) ? "joined" : "left"} the meeting at ${time(p.at)}.` }));
  // Who ran the meeting, when it changed hands (0079).
  const hands = handovers.map((h) => ({
    at: Date.parse(h.at),
    line: h.kind === "took_over" ? `${h.toName} took over running the meeting at ${time(h.at)}.` : `${h.fromName} handed the meeting to ${h.toName} at ${time(h.at)}.`,
  }));
  // Stable: joins and leaves keep their order; a handover goes where its time puts it.
  return [...moves, ...hands].map((e, i) => ({ ...e, i })).sort((a, b) => a.at - b.at || a.i - b.i).map((e) => e.line);
}

/** Who's in the meeting, for the video tiles on the demo site (0080). */
export function videoPeople(presence: PresenceEvent[], names: Record<string, string>): Array<{ key: string; name: string; lot: string | null }> {
  return inMeeting(presence).map((p) => ({ key: p.lot ? `lot:${p.lot}` : `user:${p.userId}`, name: (p.lot && names[p.lot]) || p.name || "Council member", lot: p.lot }));
}
