import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { MarketingTabs } from "@/components/MarketingTabs";
import { AppShell } from "@/components/AppShell";
import { JourneySwitch } from "@/components/JourneySwitch";
import { requireSuperAdmin } from "@/lib/data/admin";
import { creationRequestApprovedEmail } from "@/lib/email/templates";
import { signupEmail } from "@/lib/lifecycle/emails";
import { SIGNUP_JOURNEY, SIGNUP_STEPS, type SignupStep } from "@/lib/lifecycle/signup";
import { createAdminClient } from "@/lib/supabase/admin";
import { tz } from "@/lib/time-zone";

/**
 * Lifecycle emails (0086, docs/lifecycle-emails.md): each journey's switch,
 * what each step has done, a preview of every email, and the onboarding
 * numbers. Super Admins only.
 */
export const dynamic = "force-dynamic";

const STEP_INFO: Record<SignupStep, { when: string; condition: string }> = {
  welcome: { when: "About an hour after first sign-in", condition: "Always" },
  training: { when: "Day 2", condition: "No module finished. “Pick up where you left off” if one is under way" },
  connect: { when: "Day 4 (day 2 once a module is finished)", condition: "No strata, and no request to add or join one waiting" },
  last: { when: "Day 9", condition: "Nothing started: no training, no strata" },
};

const SAMPLE = {
  firstName: "Alex",
  links: { training: "#", connect: "#", module: "#" },
  unsubscribeUrl: "#",
};

const PT = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz("America/Vancouver", iso), dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " PT";

export default async function EmailsPage() {
  if (!(await requireSuperAdmin())) notFound();
  const admin = createAdminClient();
  const [{ data: journey, error: journeyError }, { data: sends }, { data: metrics }] = await Promise.all([
    admin.from("email_journeys").select("enabled, turned_on_at, changed_at").eq("journey", SIGNUP_JOURNEY).maybeSingle(),
    admin.from("email_sends").select("step, accepted, clicked_at").eq("journey", SIGNUP_JOURNEY),
    admin.rpc("lifecycle_signup_metrics", { days: 90 }),
  ]);
  const counts = new Map<string, { sent: number; failed: number; clicked: number }>();
  for (const s of sends ?? []) {
    const c = counts.get(s.step) ?? { sent: 0, failed: 0, clicked: 0 };
    if (s.accepted) c.sent++;
    else c.failed++;
    if (s.clicked_at) c.clicked++;
    counts.set(s.step, c);
  }
  const m = (Array.isArray(metrics) ? metrics[0] : metrics) as Record<string, number> | null;
  const pct = (n: number, of: number) => (of > 0 ? ` (${Math.round((n / of) * 100)}%)` : "");

  const previews: Array<{ key: string; label: string; subject: string; html: string }> = [];
  for (const step of SIGNUP_STEPS) {
    const variants = step === "training" ? [false, true] : [false];
    for (const started of variants) {
      const e = signupEmail(step, { ...SAMPLE, module: { title: "What a strata council does", started } });
      if (e) previews.push({ key: `${step}-${started}`, label: step === "training" ? (started ? "Training (under way)" : "Training (not started)") : step[0].toUpperCase() + step.slice(1), subject: e.subject, html: e.html });
    }
  }
  const ready = creationRequestApprovedEmail({ corporationName: "Larchwood Commons", strataPlanNumber: "EPS1234", openUrl: "#" });
  previews.push({ key: "ready", label: "Strata ready (sent on approval, to every new admin)", subject: ready.subject, html: ready.html });

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="marketing" />
        <MarketingTabs active="emails" />
        <div className="page-header">
          <h1>Lifecycle emails</h1>
          <p>
            Setup tips for people who sign up on their own: sent hourly from 9:00 to 17:00 PT, at most one every 2 days, and each
            checked against what the person has done before it goes. Every email carries the company&rsquo;s mailing address and a
            one-click &ldquo;Stop setup tips&rdquo; link, which never stops sign-in, security, invitation, meeting, or discussion emails.
          </p>
        </div>

        {journeyError || !journey ? (
          <p className="form-alert form-alert--error" role="alert">
            Run migration 0086 to set up lifecycle emails.
          </p>
        ) : (
          <div className="card" style={{ marginBottom: "1.5rem" }} data-testid="journey-signup">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0 }}>New sign-up</h3>
                <p className="card__meta" style={{ margin: "0.25rem 0 0" }}>
                  {journey.enabled && journey.turned_on_at
                    ? `On since ${PT(journey.turned_on_at)}. Only people who confirmed their email after that are in it.`
                    : "Off. Nothing is sent. Turning it on never emails existing accounts."}
                </p>
              </div>
              <JourneySwitch journey={SIGNUP_JOURNEY} enabled={journey.enabled} />
            </div>
            <table className="roster-table" style={{ marginTop: "1rem", width: "100%" }}>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Earliest</th>
                  <th>Sent only if</th>
                  <th>Sent</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {SIGNUP_STEPS.map((step) => {
                  const c = counts.get(step) ?? { sent: 0, failed: 0, clicked: 0 };
                  return (
                    <tr key={step}>
                      <td>{step[0].toUpperCase() + step.slice(1)}</td>
                      <td>{STEP_INFO[step].when}</td>
                      <td>{STEP_INFO[step].condition}</td>
                      <td>
                        {c.sent}
                        {c.failed ? ` (${c.failed} not accepted)` : ""}
                      </td>
                      <td>
                        {c.clicked}
                        {pct(c.clicked, c.sent)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {m && (
          <div className="card" style={{ marginBottom: "1.5rem" }} data-testid="onboarding-metrics">
            <h3 style={{ marginTop: 0 }}>Onboarding, last 90 days</h3>
            <p className="card__meta">People who confirmed their email in the last 90 days (Super Admins left out), and how many have reached each step.</p>
            <ul style={{ margin: 0 }}>
              <li>Signed up: {m.signed_up}</li>
              <li>First meaningful action (training, a strata request, or a strata): {m.first_action}{pct(m.first_action, m.signed_up)}</li>
              <li>Started training: {m.training_started}{pct(m.training_started, m.signed_up)}; finished a module: {m.training_completed}{pct(m.training_completed, m.training_started)} of those who started</li>
              <li>Connected to a strata: {m.strata_connected}{pct(m.strata_connected, m.signed_up)}</li>
              <li>In a strata that has held a meeting: {m.first_meeting}{pct(m.first_meeting, m.strata_connected)} of those connected</li>
              <li>In a subscribed strata: {m.subscribed}{pct(m.subscribed, m.first_meeting)} of those with a meeting</li>
            </ul>
          </div>
        )}

        <h2 style={{ margin: "2rem 0 1rem" }}>Previews</h2>
        <p className="card__meta">As a person named Alex would get them. Links are disabled here.</p>
        {previews.map((p) => (
          <details key={p.key} className="card" style={{ marginBottom: "1rem" }} data-testid={`preview-${p.key}`}>
            <summary>
              <strong>{p.label}</strong>: {p.subject}
            </summary>
            <iframe title={p.subject} srcDoc={p.html} sandbox="" style={{ width: "100%", height: 640, border: 0, marginTop: "1rem" }} />
          </details>
        ))}
      </div>
    </AppShell>
  );
}
