import { Inngest } from "inngest";

/**
 * Background jobs (doc04 §4/§11): indexing strata documents and the
 * legislation library. Events are sent
 * with INNGEST_EVENT_KEY; Inngest calls back into /api/inngest, verified
 * with INNGEST_SIGNING_KEY. Locally, `npx inngest-cli dev` stands in for
 * both.
 */
export const inngest = new Inngest({ id: "stratacouncil" });

export const DOCUMENT_INDEX_EVENT = "documents/index.requested";
export const LEGISLATION_INDEX_EVENT = "legislation/index.requested";
export const TRAINING_IMPORT_PLAN_EVENT = "training/import.plan.requested";
export const TRAINING_IMPORT_BUILD_EVENT = "training/import.build.requested";
