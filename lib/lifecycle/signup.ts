/**
 * The sign-up journey's rules (docs/lifecycle-emails.md, journey 0): which
 * setup tip, if any, a person gets now. Pure, so the timing and the
 * conditions are tested on their own; lib/lifecycle/run.ts gathers the
 * facts (lifecycle_signup_people(), 0086) and sends.
 *
 * Chosen by what the person has done, not only by the calendar: the days
 * are the earliest each email can go, and at send time each is checked
 * against what they've done since.
 */

import { tz } from "../time-zone.ts";

export const SIGNUP_JOURNEY = "signup";

export type SignupStep = "welcome" | "training" | "connect" | "last";
export const SIGNUP_STEPS: SignupStep[] = ["welcome", "training", "connect", "last"];

/** Where a person stands, from lifecycle_signup_people(). */
export interface SignupPerson {
  confirmedAt: string;
  pendingCreation: boolean;
  pendingJoin: boolean;
  trainingStarted: boolean;
  trainingCompleted: boolean;
  lastSentAt: string | null;
  stepsSent: string[];
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** At most one lifecycle email every 2 days (the welcome is the first). */
export const MIN_GAP = 2 * DAY;
/** Sent only between 9:00 and 17:00 Pacific. */
export const SEND_HOURS = { from: 9, to: 17 } as const;

/** The hour (0 to 23) in BC at this moment (fixed UTC-7 from November 1, 2026: lib/time-zone.ts). */
export function pacificHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz("America/Vancouver", now), hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function inSendingHours(now: Date): boolean {
  const h = pacificHour(now);
  return h >= SEND_HOURS.from && h < SEND_HOURS.to;
}

/** The step to send now, or null. One at a time, in order; a step whose goal is met is skipped for good. */
export function nextSignupStep(p: SignupPerson, now: Date): SignupStep | null {
  const age = now.getTime() - new Date(p.confirmedAt).getTime();
  const sent = new Set(p.stepsSent);
  if (p.lastSentAt && now.getTime() - new Date(p.lastSentAt).getTime() < MIN_GAP) return null;
  const connecting = p.pendingCreation || p.pendingJoin;

  if (!sent.has("welcome")) return age >= HOUR ? "welcome" : null;
  // Training: only until they finish a module.
  if (!sent.has("training") && !p.trainingCompleted && age >= 2 * DAY) return "training";
  // Connect: from day 4, or day 2 once they've finished a module; never while a request is waiting.
  if (!sent.has("connect") && !connecting && age >= (p.trainingCompleted ? 2 : 4) * DAY) return "connect";
  // The last note: only for someone who hasn't started anything.
  if (!sent.has("last") && !connecting && !p.trainingStarted && age >= 9 * DAY) return "last";
  return null;
}
