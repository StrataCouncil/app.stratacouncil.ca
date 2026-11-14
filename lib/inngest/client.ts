import { Inngest } from "inngest";
import { IS_DEMO } from "@/lib/demo";

/**
 * Background jobs (doc04 §4/§11): indexing strata documents and the
 * Knowledge Base, and fingerprinting stored files (to find identical
 * copies). Events are sent
 * with INNGEST_EVENT_KEY; Inngest calls back into /api/inngest, verified
 * with INNGEST_SIGNING_KEY. Locally, `npx inngest-cli dev` stands in for
 * both.
 *
 * The demo site (lib/demo.ts) shares the Inngest account with the live
 * site but is its own app there, and its events have their own names
 * (prefixed "demo/"), so the live site never picks up a demo job, or the
 * demo a live one.
 */
export const inngest = new Inngest({ id: IS_DEMO ? "stratacouncil-demo" : "stratacouncil" });

const EVENT_PREFIX = IS_DEMO ? "demo/" : "";
export const DOCUMENT_INDEX_EVENT = `${EVENT_PREFIX}documents/index.requested`;
export const LEGISLATION_INDEX_EVENT = `${EVENT_PREFIX}legislation/index.requested`;
export const DOCUMENT_FINGERPRINT_EVENT = `${EVENT_PREFIX}documents/fingerprint.requested`;
export const CORPORATION_FINGERPRINT_EVENT = `${EVENT_PREFIX}documents/fingerprint-all.requested`;

/**
 * The demo's fictional council taking part (lib/demo-council.ts). Demo
 * site only: the live site never sends these, and only the demo app runs
 * the functions that handle them.
 */
export const DEMO_COUNCIL_EVENTS = {
  discussionOpened: "demo/council.discussion-opened",
  meetingLaunched: "demo/council.meeting-launched",
  voteOpened: "demo/council.vote-opened",
} as const;
