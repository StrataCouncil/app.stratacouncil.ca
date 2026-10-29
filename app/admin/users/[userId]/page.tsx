import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { STAGE_LABELS, STAGES } from "@/lib/admin-users";
import { getAdminPerson } from "@/lib/data/admin-users";
import { getCurrentProfile } from "@/lib/data/profile";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";
import { corporationRoleLabels, isCorporationRole } from "@/lib/strata";

/**
 * Super Admin: one person. Account, stratas and roles, training by track,
 * Library use, meetings, Stratasphere question counts (never what was
 * asked), and everything on one timeline.
 */

const TZ = "America/Vancouver";
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) : "Never");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

const LIBRARY_KIND: Record<string, string> = {
  guide_opened: "Opened guide",
  template_downloaded: "Downloaded template",
  document_viewed: "Opened document",
  document_downloaded: "Downloaded document",
  agenda_downloaded: "Downloaded agenda",
  minutes_downloaded: "Downloaded minutes",
};

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { userId } = await params;
  const person = await getAdminPerson(userId);
  if (!person) notFound();
  const { row } = person;
  let lastDay = "";

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="users" />
        <Link href="/admin/users" className="kb-article__back">
          &larr; All users
        </Link>
        <div className="page-header">
          <h1 data-testid="admin-user-name">
            {row.name}
            {row.isSuperAdmin && <span className="pill pill--accent admin-user-staff">Staff</span>}
          </h1>
          <p>
            {row.email}
            {person.phone ? ` · ${person.phone}` : ""}
          </p>
        </div>

        <ol className="admin-user-stages" aria-label="Milestones">
          {STAGES.map((s) => (
            <li key={s} data-reached={row.reached.includes(s) || undefined}>
              {STAGE_LABELS[s]}
            </li>
          ))}
        </ol>
        {row.followUp && (
          <p className="sync-note" role="status" style={{ margin: "1rem 0 0" }} data-testid="admin-user-followup">
            <span>Worth a follow-up: {row.followUp}.</span>
          </p>
        )}

        <div className="admin-stats" style={{ marginTop: "1.5rem" }} data-testid="admin-user-summary">
          <section className="card admin-stat">
            <h3>Account</h3>
            <p className="admin-stat__main">{date(row.signedUpAt)}</p>
            <p className="card__meta">
              Signed up{row.campaign ? ` from ${row.campaign}` : ""}. Last signed in {date(row.lastSignInAt)}. Email{" "}
              {person.emailConfirmed ? "confirmed" : "not confirmed"}; two-step sign-in {person.twoStep ? "on" : "off"}; marketing
              emails {person.marketingOptIn ? "yes" : "no"}.
              {person.demoRequestedAt && ` Asked for a demo on ${date(person.demoRequestedAt)}.`}
            </p>
          </section>
          <section className="card admin-stat">
            <h3>Council Training</h3>
            <p className="admin-stat__main">
              {row.modulesFinished} of {row.modulesTotal}
            </p>
            <p className="card__meta">
              Modules finished. {row.credentials} {row.credentials === 1 ? "credential" : "credentials"}.
            </p>
          </section>
          <section className="card admin-stat">
            <h3>Stratasphere&trade;</h3>
            <p className="admin-stat__main">{person.questions.last30} questions</p>
            <p className="card__meta">
              In the last 30 days; {person.questions.total} in all. Counts only: conversations stay private.
            </p>
          </section>
          <section className="card admin-stat">
            <h3>Library and records</h3>
            <p className="admin-stat__main">{row.libraryOpens} guides</p>
            <p className="card__meta">
              Opened. {row.downloads} {row.downloads === 1 ? "download" : "downloads"}; {person.documentsUploaded}{" "}
              {person.documentsUploaded === 1 ? "document" : "documents"} uploaded.
            </p>
          </section>
        </div>

        <h2 style={{ margin: "2rem 0 0.75rem" }}>Stratas</h2>
        {row.stratas.length === 0 && person.joinRequests.length === 0 ? (
          <p className="roster-notice">Not in a strata.</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table" data-testid="admin-user-stratas">
              <thead>
                <tr>
                  <th>Strata</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Roles</th>
                  <th>Stratasphere&trade;</th>
                </tr>
              </thead>
              <tbody>
                {row.stratas.map((s) => (
                  <tr key={s.planNumber}>
                    <td>
                      <Link href={`/admin/${s.planNumber}`}>{s.name}</Link>
                    </td>
                    <td>{s.region ?? <span className="roster-table__na">Unknown</span>}</td>
                    <td>{s.status === "active" ? "Member" : "Invited"}</td>
                    <td>{s.roles.length ? s.roles.map((r) => (isCorporationRole(r) ? corporationRoleLabels[r] : r)).join(", ") : <span className="roster-table__na">None</span>}</td>
                    <td>{s.subscribed ? "Subscribed" : "Free tier"}</td>
                  </tr>
                ))}
                {person.joinRequests
                  .filter((j) => j.status === "pending")
                  .map((j) => (
                    <tr key={`join-${j.strata}`}>
                      <td>{j.strata}</td>
                      <td />
                      <td>Asked to join ({date(j.at)})</td>
                      <td />
                      <td />
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ margin: "2rem 0 0.75rem" }}>Training</h2>
        {person.tracks.length === 0 ? (
          <p className="roster-notice">No training started.</p>
        ) : (
          person.tracks.map((t) => (
            <div key={t.id} style={{ marginBottom: "1.25rem" }}>
              <h3 style={{ marginBottom: "0.5rem" }}>
                {t.title}
                {t.credentialAt && <span className="pill pill--accent admin-user-staff">Credential {date(t.credentialAt)}</span>}
              </h3>
              <div className="roster-table-wrap">
                <table className="roster-table" data-testid={`admin-user-track-${t.id}`}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.modules.map((m) => (
                      <tr key={m.id}>
                        <td>{m.title}</td>
                        <td>
                          {m.completedAt ? (
                            `Finished ${date(m.completedAt)}`
                          ) : m.startedAt ? (
                            `${m.sectionsDone} ${m.sectionsDone === 1 ? "section" : "sections"} done, last on ${date(m.startedAt)}`
                          ) : (
                            <span className="roster-table__na">Not started</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        <h2 style={{ margin: "2rem 0 0.75rem" }}>Meetings</h2>
        {person.meetings.length === 0 ? (
          <p className="roster-notice">No meetings created or run.</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table" data-testid="admin-user-meetings">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Meeting</th>
                  <th>Strata</th>
                  <th>They</th>
                </tr>
              </thead>
              <tbody>
                {person.meetings.map((m) => (
                  <tr key={m.id}>
                    <td>{m.date}</td>
                    <td>
                      {meetingTypeLabels[m.type as MeetingType] ?? m.type}
                      <div className="roster-table__meta">{m.status === "ADJOURNED" ? "Held" : m.status === "LIVE" ? "In progress" : "Draft"}</div>
                    </td>
                    <td>{m.strata}</td>
                    <td>{m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ margin: "2rem 0 0.75rem" }}>Library and downloads</h2>
        {person.library.length === 0 ? (
          <p className="roster-notice">Nothing opened or downloaded yet. (Recorded from October 29, 2026.)</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table" data-testid="admin-user-library">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Strata</th>
                </tr>
              </thead>
              <tbody>
                {person.library.slice(0, 100).map((a, i) => (
                  <tr key={i}>
                    <td>{date(a.at)}</td>
                    <td>
                      {LIBRARY_KIND[a.kind] ?? a.kind}
                      {a.label && <div className="roster-table__meta">{a.label}</div>}
                    </td>
                    <td>{a.strata}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ margin: "2rem 0 0.75rem" }}>Timeline</h2>
        <ol className="demo-activity" data-testid="admin-user-timeline">
          {person.timeline.slice(0, 300).map((e, i) => {
            const today = day(e.at);
            const heading = today !== lastDay ? today : null;
            lastDay = today;
            return (
              <li key={i} data-important={e.important || undefined}>
                {heading && <div className="demo-activity__day">{heading}</div>}
                <time dateTime={e.at}>{clock(e.at)}</time>
                <div>
                  <span>{e.text}</span>
                </div>
              </li>
            );
          })}
        </ol>

      </div>
    </AppShell>
  );
}
