import "server-only";
import { APP_URL } from "@/lib/app-url";
import { getTrainingTracksFor } from "@/lib/data/training";
import { IS_DEMO } from "@/lib/demo";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { signupEmail } from "@/lib/lifecycle/emails";
import { inSendingHours, nextSignupStep, SIGNUP_JOURNEY, type SignupPerson, type SignupStep } from "@/lib/lifecycle/signup";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextModule } from "@/lib/training/progress";

/**
 * Sends whatever the sign-up journey owes people right now (hourly, from
 * lib/inngest/lifecycle.ts). Nothing on the demo site, nothing outside
 * 9:00 to 17:00 Pacific, and nothing while the journey is off (0086's
 * lifecycle_signup_people() returns nobody then).
 *
 * Each send is logged before it goes (email_sends, unique per person and
 * step), so two runs can't send the same step twice, and links can carry
 * the send's id for click counts. A send Mailtrap refuses stays logged as
 * not accepted and isn't retried.
 */

/** A link through /e/<send id>, which counts the first click and goes on to `path`. */
export function trackedLink(sendId: string, path: string) {
  return `${APP_URL}/e/${sendId}?to=${encodeURIComponent(path)}`;
}

export function unsubscribeLinks(token: string) {
  return {
    page: `${APP_URL}/unsubscribe?t=${token}`,
    oneClick: `${APP_URL}/api/email/unsubscribe?t=${token}`,
  };
}

interface PersonRow {
  user_id: string;
  email: string;
  full_name: string;
  email_token: string;
  confirmed_at: string;
  pending_creation: boolean;
  pending_join: boolean;
  training_started: boolean;
  training_completed: boolean;
  last_sent_at: string | null;
  steps_sent: string[] | null;
}

const MAX_PER_RUN = 200;

export async function runSignupJourney(now = new Date()): Promise<{ sent: number; skipped: string | null }> {
  if (IS_DEMO) return { sent: 0, skipped: "demo site" };
  if (!inSendingHours(now)) return { sent: 0, skipped: "outside sending hours" };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("lifecycle_signup_people");
  if (error) {
    console.error("[lifecycle] people:", error.message);
    return { sent: 0, skipped: "couldn't read people" };
  }
  let sent = 0;
  for (const row of (data ?? []) as PersonRow[]) {
    if (sent >= MAX_PER_RUN) break;
    const person: SignupPerson = {
      confirmedAt: row.confirmed_at,
      pendingCreation: row.pending_creation,
      pendingJoin: row.pending_join,
      trainingStarted: row.training_started,
      trainingCompleted: row.training_completed,
      lastSentAt: row.last_sent_at,
      stepsSent: row.steps_sent ?? [],
    };
    let step = nextSignupStep(person, now);
    let module: { title: string; started: boolean; path: string } | null = null;
    if (step === "training") {
      const next = nextModule(await getTrainingTracksFor(row.user_id));
      if (next) module = { title: next.module.title, started: next.module.completedSections > 0, path: `/training/${next.track.slug}/${next.module.id}` };
      // Nothing to suggest: carry on as if this step were done, for this run.
      else step = nextSignupStep({ ...person, stepsSent: [...person.stepsSent, "training"] }, now);
    }
    if (!step) continue;
    if (await sendStep(row, step, module)) sent++;
  }
  return { sent, skipped: null };
}

async function sendStep(row: PersonRow, step: SignupStep, module: { title: string; started: boolean; path: string } | null) {
  const admin = createAdminClient();
  const { data: logged, error } = await admin
    .from("email_sends")
    .insert({ user_id: row.user_id, journey: SIGNUP_JOURNEY, step })
    .select("id")
    .single();
  // Already sent (another run got there first), or the log is unavailable: don't send.
  if (error || !logged) return false;
  const id = logged.id as string;
  const unsubscribe = unsubscribeLinks(row.email_token);
  const email = signupEmail(step, {
    firstName: row.full_name.trim().split(/\s+/)[0] ?? "",
    links: { training: trackedLink(id, "/training"), connect: trackedLink(id, "/strata"), module: module ? trackedLink(id, module.path) : null },
    module: module ? { title: module.title, started: module.started } : null,
    unsubscribeUrl: unsubscribe.page,
  });
  if (!email) {
    await admin.from("email_sends").delete().eq("id", id);
    return false;
  }
  try {
    await sendTransactionalEmail({
      to: row.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      category: "setup-tips",
      headers: { "List-Unsubscribe": `<${unsubscribe.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    await admin.from("email_sends").update({ subject: email.subject, accepted: true }).eq("id", id);
    return true;
  } catch (e) {
    console.error("[lifecycle] send failed:", step, e instanceof Error ? e.message : "unknown");
    await admin.from("email_sends").update({ subject: email.subject }).eq("id", id);
    return false;
  }
}
