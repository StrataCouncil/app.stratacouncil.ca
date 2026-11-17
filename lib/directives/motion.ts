/**
 * Directives from motions (0097), the part that needs no AI: which carried
 * motions call for follow-up, and the motion's own words as a directive
 * (the free plan, and the fallback when Stratasphere can't draft one).
 * Pure: unit-tested in tests/directives.test.ts.
 */

export interface MotionSource {
  /** The agenda item's text ("Roof membrane quotes"). */
  title: string;
  /** The motion as carried ("THAT council obtain three quotes ..."). */
  motion: string;
}

export interface DraftDirective {
  title: string;
  detail: string;
  assignee: "none" | "manager";
  /** YYYY-MM-DD, only when the motion itself gives one. */
  dueDate: string | null;
}

/**
 * Motions that settle something on the spot, with nothing left to do:
 * approving the agenda or minutes, receiving reports, ratifying decisions
 * already acted on, electing officers, adjourning, setting the next date.
 */
const ROUTINE: RegExp[] = [
  /\b(approve|adopt|accept)\w*\s+(the\s+)?(agenda|minutes)\b/i,
  /\bminutes\b.*\b(be\s+)?(approved|adopted|accepted)\b/i,
  /\bagenda\b.*\b(be\s+)?(approved|adopted|accepted)\b/i,
  /\b(receive|accept|approve|adopt)\w*\s+(the\s+)?(\w+\s+){0,3}(report|statements?|update)\b/i,
  /\b(report|statements?|update)s?\b.*\bbe\s+(received|accepted|approved|adopted)\b/i,
  /\bratif(y|ies|ied)\b/i,
  /\belect\w*\b.*\b(president|vice[ -]president|treasurer|secretary|chair|officer)/i,
  /\badjourn/i,
  /\b(next|following)\s+(council\s+)?meeting\b.*\b(be\s+held|is\s+scheduled|will\s+be)\b/i,
];

/** True when a carried motion leaves something to be done. */
export function needsFollowUp(m: MotionSource): boolean {
  const text = `${m.motion}`.trim();
  if (!text) return false;
  return !ROUTINE.some((r) => r.test(text) || r.test(m.title));
}

/** "THAT council obtain three quotes." to "Council obtain three quotes." */
export function motionAsTask(motion: string): string {
  let t = motion.replace(/\s+/g, " ").trim();
  t = t.replace(/^(be it resolved\b[^,]*?\bthat|it was moved\b[^,]*?\bthat|moved\b[^,]*?\bthat|resolved\s+that|that)\s+/i, "");
  t = t.replace(/[.;\s]+$/, "");
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

/** Who the motion names: the strata manager or management company, or nobody in particular. */
export function namedAssignee(motion: string): "none" | "manager" {
  return /\b(strata|property)\s+manag(er|ement)\b|\bmanagement\s+company\b|\bthe\s+manager\b|\bagent\b/i.test(motion) ? "manager" : "none";
}

/** The motion's own words as one directive (titles are capped at 300 characters). */
export function motionDirective(m: MotionSource): DraftDirective {
  const task = motionAsTask(m.motion) || m.title.trim();
  const title = task.length <= 300 ? task : `${task.slice(0, 297).replace(/\s+\S*$/, "")}...`;
  return {
    title,
    detail: task.length > 300 ? task : "",
    assignee: namedAssignee(m.motion),
    dueDate: null,
  };
}

/** A due date from the AI, kept only if it's a real calendar date. */
export function cleanDueDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** An AI-drafted directive, trimmed and checked; null if it's empty. */
export function cleanDraft(raw: unknown): DraftDirective | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!title) return null;
  return {
    title,
    detail: String(r.detail ?? "").trim().slice(0, 4000),
    assignee: r.assignee === "manager" ? "manager" : "none",
    dueDate: cleanDueDate(r.dueDate),
  };
}
