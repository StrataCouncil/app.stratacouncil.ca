/**
 * Council discussions (0070): the count. A discussion never decides
 * anything by itself: a motion that passes (a majority in favour) goes to a
 * council meeting for ratification. A majority is more than half of the voters who aren't
 * recused (Strata Property Act s. 32 conflicts): 4 of 7, or 4 of 6 with
 * one recused. Abstaining and not voting count toward the total but not
 * toward either side. close_discussion() in the database does the same
 * sums; tests/discussions.test.ts checks both agree on the cases.
 */

export type DiscussionVote = "for" | "against" | "abstain" | "recused";
export type DiscussionResult = "supported" | "not_supported" | "no_majority";
export type DiscussionStatus = "open" | "closed" | "awaiting_ratification" | "ratified" | "not_ratified";

export interface Tally {
  for: number;
  against: number;
  abstain: number;
  recused: number;
  /** Eligible voters who haven't voted. */
  missing: number;
  /** Voters who aren't recused. */
  eligible: number;
  /** Votes either side needs for a majority. */
  needed: number;
  result: DiscussionResult;
}

export function tally(votes: Array<DiscussionVote | null>): Tally {
  const count = (v: DiscussionVote) => votes.filter((x) => x === v).length;
  const t = { for: count("for"), against: count("against"), abstain: count("abstain"), recused: count("recused") };
  const missing = votes.filter((x) => x === null).length;
  const eligible = votes.length - t.recused;
  const needed = Math.floor(eligible / 2) + 1;
  const result: DiscussionResult = eligible > 0 && t.for >= needed ? "supported" : eligible > 0 && t.against >= needed ? "not_supported" : "no_majority";
  return { ...t, missing, eligible, needed, result };
}

export const RESULT_LABELS: Record<DiscussionResult, string> = {
  supported: "Council supports the motion",
  not_supported: "Council does not support the motion",
  no_majority: "No majority either way",
};

export const STATUS_LABELS: Record<DiscussionStatus, string> = {
  open: "Open",
  closed: "Closed",
  awaiting_ratification: "Awaiting ratification",
  ratified: "Ratified",
  not_ratified: "Not ratified",
};

export const VOTE_LABELS: Record<DiscussionVote, string> = {
  for: "For",
  against: "Against",
  abstain: "Abstain",
  recused: "Recused (conflict of interest)",
};

/** "4 of 7 for: a majority has been reached", or null while neither side has one. */
export function majorityNote(t: Tally): string | null {
  if (t.eligible === 0) return null;
  if (t.for >= t.needed) return `${t.for} of ${t.eligible} for: a majority has been reached.`;
  if (t.against >= t.needed) return `${t.against} of ${t.eligible} against: a majority has been reached.`;
  return null;
}

/**
 * The status shown. A closed discussion whose motion passed (a majority in
 * favour) is awaiting ratification at a council meeting; one that didn't
 * pass is simply closed, since nothing was decided.
 */
export function displayStatus(stored: "open" | "closed" | "ratified" | "not_ratified", result: DiscussionResult | null): DiscussionStatus {
  return stored === "closed" && result === "supported" ? "awaiting_ratification" : stored;
}

/** The motion put to the meeting, from the discussion's own. */
export function ratificationMotion(motion: string, closedOn: string): string {
  const text = motion.trim().replace(/^that\s+/i, "");
  return `THAT council ratify its vote between meetings, closed ${closedOn}, on the motion: that ${text}`;
}

/** "4 for, 1 against, 1 abstained, 1 recused, 0 didn't vote". */
export function tallyLine(t: Pick<Tally, "for" | "against" | "abstain" | "recused" | "missing">): string {
  return `${t.for} for, ${t.against} against, ${t.abstain} abstained, ${t.recused} recused, ${t.missing} didn’t vote`;
}
