import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { getStrataAccess } from "@/lib/data/strata";
import { listMeetings, type MeetingRecord } from "@/lib/data/meetings";
import { createClient } from "@/lib/supabase/server";
import { meetingTypeLabels, missingMotions } from "@/lib/meetings/agenda";
import { LaunchMeetingButton } from "@/components/meetings/MeetingActions";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { meetingStatus } from "@/lib/meetings/status";
import { councilRoles } from "@/lib/strata";
import { DemoLimitButton } from "@/components/DemoLimitButton";
import { IS_DEMO } from "@/lib/demo";
import { demoAllowanceLeft } from "@/lib/demo-usage";

/**
 * Meetings. Until the first meeting has run, the first-meeting checklist
 * (doc03 Stage 5a) leads: roster, council roles, documents, create a
 * meeting, review its agenda, launch. Council and committee meetings are
 * free and unlimited (0090); general meetings come with Stratasphere.
 */
export default async function MeetingsPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meetings = await listMeetings(corpId);
  // The demo: one meeting per visitor (lib/demo.ts DEMO_LIMITS).
  const demoMeetingUsed = IS_DEMO && (await demoAllowanceLeft())?.meetings === 0;

  const supabase = await createClient();
  const [{ count: namedLots }, { count: documents }, { count: councilSeats }] = await Promise.all([
    supabase.from("owners_and_council").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).not("full_name", "is", null),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("corporation_id", corpId),
    supabase
      .from("corporation_role_assignments")
      .select("user_id", { count: "exact", head: true })
      .eq("corporation_id", corpId)
      .in("role", [...councilRoles]),
  ]);

  const steps = [
    { label: "Add your owners to the lot roster", done: (namedLots ?? 0) > 0, href: `/strata/${corpId}/lots` },
    {
      label: "Assign council roles",
      done: (councilSeats ?? 0) > 0,
      href: `/strata/${corpId}/council#roster`,
      hint: "President, Vice President, Treasurer, Secretary, Members at Large, each tied to their strata lot.",
    },
    { label: "Upload your governance documents", done: (documents ?? 0) > 0, href: `/strata/${corpId}/documents`, hint: "Bylaws, rules, past minutes, and financials." },
    { label: "Create your first meeting", done: meetings.length > 0, href: access.canRunMeetings ? `/strata/${corpId}/meetings/new` : undefined },
    { label: "Review the agenda", done: meetings.some((m) => m.agenda.length > 0), href: meetings[0] ? `/strata/${corpId}/meetings/${meetings[0].id}` : undefined },
    { label: "Launch Meeting Mode", done: meetings.some((m) => m.launchedAt) },
  ];

  // Gone once every step is done.
  const checklistDone = steps.every((s) => s.done);

  const upcoming = meetings.filter((m) => m.status !== "ADJOURNED");
  // Most recent first: by date, then start time (two meetings on one day).
  const when = (m: MeetingRecord) => `${m.meetingDate} ${m.startTime ?? ""}`;
  const past = meetings.filter((m) => m.status === "ADJOURNED").sort((a, b) => when(b).localeCompare(when(a)));

  return (
    <>
      <StrataSphereNav active="meetings" />
      <div className="doc-header">
        <div>
          <h2>Meetings</h2>
          <p className="card__meta">
            {access.subscribed
              ? "Council meetings, AGMs, SGMs, and committee meetings."
              : "Council and committee meetings are free, as many as you like."}
          </p>
        </div>
        <div className="meetings-actions">
          {(access.isCouncil || access.canRunMeetings || access.roles.includes("manager")) && (
            <Link href={`/strata/${corpId}/meetings/video-test`} className="button button-secondary" data-testid="video-test">
              Test video and audio
            </Link>
          )}
          {access.canRunMeetings &&
            (demoMeetingUsed ? (
              <DemoLimitButton reason="second meeting" className="button button-primary" testId="start-meeting">
                New meeting
              </DemoLimitButton>
            ) : (
              <Link href={`/strata/${corpId}/meetings/new`} className="button button-primary" data-testid="start-meeting">
                New meeting
              </Link>
            ))}
        </div>
      </div>

      {!checklistDone && (
        <section className="card checklist" data-testid="first-meeting-checklist">
          <h3>Your first meeting</h3>
          <ol className="checklist__steps">
            {steps.map((s) => (
              <li key={s.label} data-done={s.done}>
                <span className="checklist__mark" aria-hidden="true">
                  {s.done ? <Check /> : null}
                </span>
                <span>
                  {s.href && !s.done ? <Link href={s.href}>{s.label}</Link> : s.label}
                  <span className="visually-hidden">{s.done ? " (done)" : " (to do)"}</span>
                  {s.hint && !s.done && <span className="checklist__hint">{s.hint}</span>}
                </span>
              </li>
            ))}
          </ol>
          {!access.canRunMeetings && (
            <p className="card__meta">Meetings are set up and run by your secretary or admin, or anyone they&rsquo;ve allowed.</p>
          )}
        </section>
      )}

      <MeetingSection title="Upcoming and in progress" meetings={upcoming} corpId={corpId} userId={access.userId} seesDrafts={access.isCouncil || access.canRunMeetings} canFollow={access.isCouncil || access.canRunMeetings || access.roles.includes("manager")} launch={access.canRunMeetings ? { isAdmin: access.isAdmin } : null} empty={IS_DEMO ? "No meetings scheduled. Press New meeting: the agenda is written for you, ready to run in Meeting Mode." : "No meetings scheduled."} />
      {past.length > 0 && <MeetingSection title="Past meetings" meetings={past} corpId={corpId} userId={access.userId} seesDrafts={access.isCouncil || access.canRunMeetings} canFollow={access.isCouncil || access.canRunMeetings || access.roles.includes("manager")} launch={null} />}
    </>
  );
}

function MeetingSection({
  title,
  meetings,
  corpId,
  userId,
  seesDrafts,
  canFollow,
  launch,
  empty,
}: {
  title: string;
  meetings: MeetingRecord[];
  corpId: string;
  userId: string;
  /** Draft minutes are for council and whoever runs meetings (0072). */
  seesDrafts: boolean;
  /** Can follow a live meeting (0073): council, the manager, anyone who runs meetings. */
  canFollow: boolean;
  /** Can run meetings: draft rows get Edit agenda and Launch meeting. */
  launch: { isAdmin: boolean } | null;
  empty?: string;
}) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h3 style={{ marginBottom: "0.75rem" }}>{title}</h3>
      {meetings.length === 0 ? (
        <p className="card__meta">{empty}</p>
      ) : (
        <div className="module-list" data-testid="meetings-list">
          {meetings.map((m) => (
            <div className="module-row" key={m.id} data-testid={`meeting-${m.id}`}>
              <div>
                <div className="module-row__title">
                  <Link href={`/strata/${corpId}/meetings/${m.id}`}>{meetingTypeLabels[m.type]}</Link>
                  <span className="meeting-status" data-tone={meetingStatus(m).tone} data-testid={`meeting-status-${m.id}`}>
                    {meetingStatus(m).label}
                  </span>
                </div>
                <div className="module-row__meta">
                  {formatMeetingWhen(m)} &middot; {statusLabel(m)}
                </div>
              </div>
              <div className="meeting-row__actions">
                {m.launchedBy === userId && m.status !== "ADJOURNED" ? (
                  <Link href={`/strata/${corpId}/meetings/${m.id}/run`} className="button button-primary button-small">
                    Resume
                  </Link>
                ) : m.launchedBy !== null && m.status !== "ADJOURNED" && canFollow ? (
                  <Link href={`/strata/${corpId}/meetings/${m.id}/live`} className="button button-primary button-small" data-testid={`join-${m.id}`}>
                    Join meeting
                  </Link>
                ) : m.status === "ADJOURNED" && (m.minutesState === "FINAL" || (m.minutesState === "DRAFT" && seesDrafts)) ? (
                  <Link href={`/strata/${corpId}/meetings/${m.id}/minutes`} className="button button-secondary button-small">
                    {m.minutesState === "FINAL" ? "Minutes" : "Draft minutes"}
                  </Link>
                ) : launch && m.status === "DRAFT" && m.launchedBy === null ? (
                  <>
                    <Link href={`/strata/${corpId}/meetings/${m.id}?edit=1`} className="button button-secondary button-small" data-testid={`edit-agenda-${m.id}`}>
                      Edit agenda
                    </Link>
                    <LaunchMeetingButton
                      corpId={corpId}
                      meetingId={m.id}
                      missingMotions={missingMotions(m.agenda)}
                      editHref={`/strata/${corpId}/meetings/${m.id}?edit=1`}
                      className="button button-primary button-small"
                      {...launch}
                    />
                  </>
                ) : (
                  <Link href={`/strata/${corpId}/meetings/${m.id}`} className="button button-secondary button-small">
                    View agenda
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function statusLabel(m: MeetingRecord) {
  if (m.status === "ADJOURNED") {
    if (!m.actualStartAt) return "Adjourned without quorum";
    return m.minutesState === "FINAL" ? "Minutes final" : "Minutes in draft";
  }
  if (m.status === "LIVE") return `In progress${m.launchedByName ? ` (${m.launchedByName})` : ""}`;
  if (m.launchedAt) return `Launched${m.launchedByName ? ` by ${m.launchedByName}` : ""}`;
  return m.agenda.length ? "Draft" : "Draft, no agenda yet";
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
