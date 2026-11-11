import { inngest } from "@/lib/inngest/client";
import { runSignupJourney } from "@/lib/lifecycle/run";

/**
 * Lifecycle emails (0086, docs/lifecycle-emails.md): every hour, send what
 * each journey owes people now. The journey itself only sends between 9:00
 * and 17:00 BC time (lib/lifecycle/signup.ts, which knows BC stayed on
 * UTC-7 from November 1, 2026), so the schedule doesn't need a time zone. Journeys are
 * off until a Super Admin turns them on; the demo site never sends.
 */
export const lifecycleEmails = inngest.createFunction(
  { id: "lifecycle-emails", triggers: [{ cron: "23 * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const signup = await step.run("signup", () => runSignupJourney());
    return { signup };
  }
);
