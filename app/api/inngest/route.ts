import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { indexDocument } from "@/lib/inngest/index-document";
import { indexLegislation } from "@/lib/inngest/index-legislation";
import { fingerprintCorporation, fingerprintDocument } from "@/lib/inngest/fingerprint-document";
import { rereadScans } from "@/lib/inngest/reread-scans";

/** Inngest calls back here to run background jobs (doc04 §4). */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions: [indexDocument, indexLegislation, fingerprintDocument, fingerprintCorporation, rereadScans] });
