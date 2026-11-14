/**
 * How the demo's fictional council votes (lib/inngest/demo-council.ts).
 * Pure, so the tests can check it.
 */

/** A random vote: mostly For, sometimes Against, now and then an abstention. */
export function randomChoice(roll: number = Math.random()): "for" | "against" | "abstain" {
  return roll < 0.7 ? "for" : roll < 0.9 ? "against" : "abstain";
}

/** A whole number of seconds from min to max. */
export function randomSeconds(min: number, max: number, roll: number = Math.random()): number {
  return Math.round(min + roll * (max - min));
}

/** What a member says when they vote against, now and then. */
export const AGAINST_COMMENTS = [
  "I'd like to see another quote before I can support this.",
  "I'm not convinced this is the right time, with the roof project under way.",
  "I'd rather we discussed this at the next meeting, where owners can hear the reasons.",
];
