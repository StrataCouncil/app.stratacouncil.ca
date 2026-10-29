import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AdminUserSearch } from "@/components/AdminUserSearch";
import { AppShell } from "@/components/AppShell";
import { STAGE_LABELS, STAGES, type Stage } from "@/lib/admin-users";
import { getAdminUsers } from "@/lib/data/admin-users";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * Super Admin: everyone with an account. How far each person has got (the
 * funnel), who might need a follow-up, where sign-ups came from and where
 * training stalls, then the searchable list. Each name opens the person's
 * page. Counts only for Stratasphere: conversations stay private.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const report = await getAdminUsers();
  if (!report) notFound();

  const asked = (await searchParams).stage ?? "";
  const initialStage = asked === "follow-up" || (STAGES as readonly string[]).includes(asked) ? (asked as Stage | "follow-up") : "";
  const followUps = report.people.filter((p) => p.followUp).length;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="users" />
        <div className="page-header">
          <h1>Users</h1>
          <p>
            Everyone with an account: their stratas, training, Library use and Stratasphere&trade; question counts. Conversations
            stay private; nothing here shows what anyone asked.
          </p>
        </div>

        <h2 style={{ marginBottom: "1rem" }}>How far people get</h2>
        <ol className="admin-funnel" data-testid="admin-user-funnel">
          {report.funnel.map((f) => (
            <li key={f.stage}>
              <Link href={f.stage === "signed_up" ? "/admin/users" : `/admin/users?stage=${f.stage}`}>
                <strong>{f.count}</strong>
                <span>{STAGE_LABELS[f.stage]}</span>
              </Link>
            </li>
          ))}
          <li data-followup="true">
            <Link href="/admin/users?stage=follow-up">
              <strong>{followUps}</strong>
              <span>Worth a follow-up</span>
            </Link>
          </li>
        </ol>
        <p className="card__meta" style={{ marginBottom: "2rem" }}>
          Counts each person once per milestone they&rsquo;ve reached; Super Admins aren&rsquo;t counted.
        </p>

        <h2 style={{ marginBottom: "1rem" }}>People</h2>
        <AdminUserSearch key={initialStage} people={report.people} initialStage={initialStage} />

        <div className="admin-user-insights">
          <section>
            <h2 style={{ marginBottom: "0.75rem" }}>Sign-ups by campaign</h2>
            {report.campaigns.length === 0 ? (
              <p className="roster-notice">No sign-ups have come from a tagged link yet.</p>
            ) : (
              <div className="roster-table-wrap">
                <table className="roster-table" data-testid="admin-user-campaigns">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th data-center="true">Sign-ups</th>
                      <th data-center="true">Started training</th>
                      <th data-center="true">Credentials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.campaigns.map((c) => (
                      <tr key={c.campaign}>
                        <td>{c.campaign}</td>
                        <td data-center="true">{c.signups}</td>
                        <td data-center="true">{c.startedTraining}</td>
                        <td data-center="true">{c.credentials}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section>
            <h2 style={{ marginBottom: "0.75rem" }}>Where training stalls</h2>
            {report.stalls.length === 0 ? (
              <p className="roster-notice">Nobody has left a module unfinished for more than a week.</p>
            ) : (
              <div className="roster-table-wrap">
                <table className="roster-table" data-testid="admin-user-stalls">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th data-center="true">Left unfinished 7+ days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.stalls.map((s) => (
                      <tr key={`${s.track}-${s.module}`}>
                        <td>
                          {s.module}
                          <div className="roster-table__meta">{s.track}</div>
                        </td>
                        <td data-center="true">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
