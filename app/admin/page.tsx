import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getAdminOverview } from "@/lib/data/admin-overview";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * The Super Admin console — platform staff only, gated on the real
 * `profiles.is_super_admin` flag (doc01 §4: a platform flag, not a
 * corporation role). `AppShell`'s nav link uses the same check; this is
 * the server-side backstop for anyone who navigates here directly.
 *
 * Overview: what needs attention, then platform-wide numbers. The work
 * itself is in the other tabs (components/AdminTabs.tsx).
 */
export default async function AdminConsolePage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const overview = await getAdminOverview();
  if (!overview) notFound();
  const { stratas, people, meetings, documents, stratasphere, training, demo, attention } = overview;
  const n = (x: number) => x.toLocaleString("en-CA");
  const usd = (x: number) => x.toLocaleString("en-CA", { style: "currency", currency: "USD" });

  return (
    <AppShell active="admin">
      <AutoRefresh />
      <div className="wrap page">
        <AdminTabs active="overview" />
        <div className="page-header">
          <h1>Super Admin console</h1>
          <p>Platform-staff only. What&rsquo;s waiting on you, and how the platform is doing.</p>
        </div>

        <h2 style={{ marginBottom: "1rem" }}>Needs attention</h2>
        {attention.length === 0 ? (
          <p className="roster-notice" data-testid="admin-attention-none" style={{ marginBottom: "2.5rem" }}>
            Nothing needs attention.
          </p>
        ) : (
          <ul className="admin-attention" data-testid="admin-attention">
            {attention.map((a) => (
              <li key={a.key} data-testid={`admin-attention-${a.key}`}>
                <Link href={a.href}>
                  {a.count > 0 && <strong className="admin-attention__count">{n(a.count)}</strong>}
                  <span>{a.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <h2 style={{ marginBottom: "1rem" }}>Platform</h2>
        <div className="admin-stats" data-testid="admin-overview-stats">
          <Stat title="Stratas" main={n(stratas.total)}>
            {n(stratas.subscribed)} subscribed{stratas.sandbox > 0 && `, ${n(stratas.sandbox)} on the Stripe sandbox`}. {n(stratas.new30)} new in
            the last 30 days.
          </Stat>
          <Stat title="People" main={n(people.users)}>
            {n(people.activeMembers)} active memberships, {n(people.invited)} invited. {n(people.new30)} new accounts in the last 30 days.
          </Stat>
          <Stat title="Meetings" main={`${n(meetings.held30)} held`}>
            In the last 30 days. {n(meetings.upcoming)} coming up, {n(meetings.total)} in all.
          </Stat>
          <Stat title="Documents" main={n(documents.total)}>
            {n(documents.indexed)} indexed for the Stratasphere&trade;.
          </Stat>
          <Stat title="Stratasphere™" main={`${n(stratasphere.questions30)} answers`}>
            In the last 30 days, for {n(stratasphere.askers30)} {stratasphere.askers30 === 1 ? "person" : "people"}. AI cost {usd(stratasphere.cost30Usd)}.
          </Stat>
          <Stat title="Council Training" main={`${n(training.completions30)} modules finished`}>
            In the last 30 days, by {n(training.learners30)} {training.learners30 === 1 ? "learner" : "learners"}. {n(training.credentials)} credentials
            issued in all.
          </Stat>
          <Stat title="Demo" main={demo ? `${n(demo.today)} links today` : "Not connected"}>
            {demo ? `${n(demo.opened)} opened so far.` : "Set DEMO_SUPABASE_URL and DEMO_SUPABASE_SERVICE_ROLE_KEY."}
          </Stat>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ title, main, children }: { title: string; main: string; children: React.ReactNode }) {
  return (
    <section className="card admin-stat">
      <h3>{title}</h3>
      <p className="admin-stat__main">{main}</p>
      <p className="card__meta">{children}</p>
    </section>
  );
}
