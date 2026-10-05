import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { getStrataAccess } from "@/lib/data/strata";
import { listMeetings, type MeetingRecord } from "@/lib/data/meetings";
import { createClient } from "@/lib/supabase/server";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { meetingStatus } from "@/lib/meetings/status";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { councilRoles } from "@/lib/strata";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/**
 * Meetings. Before the free meeting is used, the first-meeting checklist
 * (doc03 Stage 5a) leads: roster, council roles, documents, create a meeting, review its
 * agenda, launch. Draft meetings are unlimited; launching one is what uses
 * the free meeting.
 */
export default async function MeetingsPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meetings = await listMeetings(corpId);
  const trialAvailable = !access.freeMeetingUsed;

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
    { label: "Upload your governance documents", done: (documents ?? 0) > 0, href: `/strata/${corpId}/documents`, hint: "Bylaws, rules, past minutes, financials — so Stratasphere has real material to work with." },
    { label: "Create your first meeting", done: meetings.length > 0, href: access.canRunMeetings ? `/strata/${corpId}/meetings/new` : undefined },
    { label: "Review the agenda", done: meetings.some((m) => m.agenda.length > 0), href: meetings[0] ? `/strata/${corpId}/meetings/${meetings[0].id}` : undefined },
    { label: "Launch Meeting Mode", done: meetings.some((m) => m.launchedAt), hint: "This uses your one free meeting." },
  ];

  // Gone once every step is done.
  const checklistDone = steps.every((s) => s.done);

  const upcoming = meetings.filter((m) => m.status !== "ADJOURNED");
  const past = meetings.filter((m) => m.status === "ADJOURNED");

  return (
    <>
      <StrataSphereNav active="meetings" />
      <div className="doc-header">
        <div>
          <h2>Meetings</h2>
          <p className="card__meta">
            {access.subscribed
              ? "Council meetings, AGMs, SGMs and committee meetings."
              : trialAvailable
                ? "Your first meeting is free: the full product, no card needed."
                : "Your free meeting has been used. Everything from it stays here."}
          </p>
        </div>
        {access.canRunMeetings && (
          <Link href={`/strata/${corpId}/meetings/new`} className="button button-primary" data-testid="start-meeting">
            New meeting
          </Link>
        )}
      </div>

      {!access.subscribed && trialAvailable && !checklistDone && (
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

      {!access.subscribed && !trialAvailable && (
        <div className="lock-panel" style={{ marginBottom: "2rem" }}>
          <h2>Run your next meeting with Stratasphere&trade;</h2>
          <p>
            You can keep setting up draft meetings and agendas. Launching one needs a subscription. Documents, finalized
            minutes and everything from your free meeting stay fully accessible either way.
          </p>
          {access.pending ? (
            <SubscriptionPendingNote />
          ) : access.isAdmin ? (
            <Link href={`/strata/${corpId}/billing`} className="button button-primary" data-testid="meetings-subscribe-cta">
              See plans
            </Link>
          ) : (
            <RequestSubscriptionButton corpId={corpId} />
          )}
        </div>
      )}

      <MeetingSection title="Upcoming and in progress" meetings={upcoming} corpId={corpId} userId={access.userId} empty="No meetings scheduled." />
      {past.length > 0 && <MeetingSection title="Past meetings" meetings={past} corpId={corpId} userId={access.userId} />}
    </>
  );
}

function MeetingSection({
  title,
  meetings,
  corpId,
  userId,
  empty,
}: {
  title: string;
  meetings: MeetingRecord[];
  corpId: string;
  userId: string;
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
                  {m.isTrial ? " · Free meeting" : ""}
                </div>
              </div>
              <div className="meeting-row__actions">
                {m.launchedBy === userId && m.status !== "ADJOURNED" ? (
                  <Link href={`/strata/${corpId}/meetings/${m.id}/run`} className="button button-primary button-small">
                    Resume
                  </Link>
                ) : m.status === "ADJOURNED" ? (
                  <Link href={`/strata/${corpId}/meetings/${m.id}/minutes`} className="button button-secondary button-small">
                    {m.minutesState === "FINAL" ? "Minutes" : "Review minutes"}
                  </Link>
                ) : (
                  <Link href={`/strata/${corpId}/meetings/${m.id}`} className="button button-secondary button-small">
                    Agenda
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
