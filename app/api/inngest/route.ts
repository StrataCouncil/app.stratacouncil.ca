import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { indexDocument } from "@/lib/inngest/index-document";
import { indexLegislation } from "@/lib/inngest/index-legislation";
import { fingerprintCorporation, fingerprintDocument } from "@/lib/inngest/fingerprint-document";
import { rereadScans } from "@/lib/inngest/reread-scans";
import { lifecycleEmails } from "@/lib/inngest/lifecycle";
import { demoDiscussionVotes, demoMeetingArrivals, demoMeetingBallots } from "@/lib/inngest/demo-council";
import { IS_DEMO } from "@/lib/demo";

/** Inngest calls back here to run background jobs (doc04 §4). */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    indexDocument,
    indexLegislation,
    fingerprintDocument,
    fingerprintCorporation,
    rereadScans,
    lifecycleEmails,
    // The demo's fictional council (lib/demo-council.ts): the demo app only.
    ...(IS_DEMO ? [demoDiscussionVotes, demoMeetingArrivals, demoMeetingBallots] : []),
  ],
});
