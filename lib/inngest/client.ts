import { Inngest } from "inngest";
import { IS_DEMO } from "@/lib/demo";

/**
 * Background jobs (doc04 §4/§11): indexing strata documents and the
 * legislation library. Events are sent
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
