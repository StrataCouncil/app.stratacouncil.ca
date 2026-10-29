import { parseCivicAddress } from "./billing-address.ts";

/**
 * The Super Admin console's Users tab: how far each person has got, and who
 * might need a nudge. Pure, so it can be tested; lib/data/admin-users.ts
 * gathers the facts.
 */

/** Milestones in the order people usually reach them. */
export const STAGES = [
  "signed_up",
  "training_started",
  "module_finished",
  "credential",
  "in_strata",
  "ran_meeting",
  "subscribed",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  signed_up: "Signed up",
  training_started: "Started training",
  module_finished: "Finished a module",
  credential: "Earned a credential",
  in_strata: "In a strata",
  ran_meeting: "Ran a meeting",
  subscribed: "Subscribed strata",
};

export interface PersonFacts {
  signedUpAt: string;
  /** Modules with any progress, finished or not. */
  modulesStarted: number;
  modulesFinished: number;
  credentials: number;
  /** When they last made progress in a module they haven't finished, if any. */
  unfinishedSince: string | null;
  activeStratas: number;
  /** Launched a meeting in Meeting Mode. */
  ranMeeting: boolean;
  /** Belongs to a strata with an active or complimentary subscription. */
  subscribedStrata: boolean;
  /** Email invitations to a strata still waiting, with when they were sent. */
  pendingInvites: Array<{ strata: string; sentAt: string }>;
}

/** Every milestone reached. Signing up always counts. */
export function reachedStages(f: PersonFacts): Stage[] {
  const reached: Record<Stage, boolean> = {
    signed_up: true,
    training_started: f.modulesStarted > 0,
    module_finished: f.modulesFinished > 0,
    credential: f.credentials > 0,
    in_strata: f.activeStratas > 0,
    ran_meeting: f.ranMeeting,
    subscribed: f.subscribedStrata,
  };
  return STAGES.filter((s) => reached[s]);
}

/** The furthest milestone reached, in STAGES order. */
export function furthestStage(f: PersonFacts): Stage {
  const reached = reachedStages(f);
  return reached[reached.length - 1];
}

const DAY = 86_400_000;
const daysSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / DAY);

/**
 * Why someone might need a follow-up, or null. Signed up 3+ days ago with
 * no training and no strata; training started but untouched for 7+ days
 * with nothing finished; or a strata invitation unanswered for 7+ days.
 */
export function followUpReason(f: PersonFacts, now = Date.now()): string | null {
  const invite = f.pendingInvites.find((i) => daysSince(i.sentAt, now) >= 7);
  if (invite) return `Invited to ${invite.strata} ${daysSince(invite.sentAt, now)} days ago and hasn’t joined`;
  if (f.modulesStarted === 0 && f.activeStratas === 0 && daysSince(f.signedUpAt, now) >= 3) {
    return `Signed up ${daysSince(f.signedUpAt, now)} days ago; no training or strata yet`;
  }
  if (f.modulesFinished === 0 && f.unfinishedSince && daysSince(f.unfinishedSince, now) >= 7) {
    return `Started training, then stopped ${daysSince(f.unfinishedSince, now)} days ago`;
  }
  return null;
}

/** "1702 Coursier Ave, Revelstoke, BC, V0E 2S1" -> "Revelstoke, BC". Null when it can't tell. */
export function regionFromAddress(address: string | null | undefined): string | null {
  const parsed = parseCivicAddress(address);
  return parsed ? `${parsed.city}, ${parsed.province}` : null;
}

/** "BCS-1234" or "Larchwood Commons (BCS-1234)". */
export function strataName(planNumber: string, buildingName: string | null | undefined) {
  return buildingName ? `${buildingName} (${planNumber})` : planNumber;
}
