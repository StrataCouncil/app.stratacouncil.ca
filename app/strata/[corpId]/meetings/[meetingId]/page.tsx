import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { AgendaBuilder } from "@/components/meetings/AgendaBuilder";
import { agendaVersion } from "@/lib/meetings/agenda-version";
import { AgendaView } from "@/components/meetings/AgendaView";
import { AgendaCheckout } from "@/components/meetings/AgendaCheckout";
import { DeleteMeetingButton, EditMeetingDetailsButton, LaunchMeetingButton } from "@/components/meetings/MeetingActions";
import { getStrataAccess } from "@/lib/data/strata";
import { ratificationCandidates } from "@/lib/data/discussions";
import { chairCandidates, getMeeting, getMeetingNotes } from "@/lib/data/meetings";
import { meetingFormatLabels, meetingTypeLabels, missingMotions } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { meetingStatus } from "@/lib/meetings/status";

// An upload read here may be a scan, read by OCR while the person waits (lib/kb/ocr.ts).
export const maxDuration = 120;

/**
 * One meeting before it runs: details, the agenda builder (for whoever
 * can run meetings), and Launch. Once launched, the launcher runs it from
 * Meeting Mode and everyone else sees the agenda read-only.
 */
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpId: string; meetingId: string }>;
  searchParams: Promise<{ edit?: string; takenOver?: string }>;
}) {
  const { corpId, meetingId } = await params;
  const { edit, takenOver } = await searchParams;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) notFound();

  const launchedByMe = meeting.launchedBy === access.userId;
  // Following live (0073): council, the manager, and anyone who can run meetings.
  const canFollow = access.isCouncil || access.canRunMeetings || access.roles.includes("manager");
  const launchedByOther = meeting.launchedBy !== null && !launchedByMe;
  const canEdit = access.canRunMeetings && meeting.status === "DRAFT" && meeting.launchedBy === null;
  // Edit agenda opens the editor (and takes the agenda); otherwise it's read-only.
  const editing = canEdit && edit === "1";
  const [notes, chairOptions] = canEdit
    ? await Promise.all([getMeetingNotes(meetingId), chairCandidates(corpId)])
    : [{}, []];
  const trialAvailable = !access.freeMeetingUsed;

  return (
    <>
      <StrataSphereNav active="meetings" />
      <Link href={`/strata/${corpId}/meetings`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All meetings
      </Link>

      <div className="doc-header">
        <div>
          <h2>
            {meetingTypeLabels[meeting.type]}{" "}
            <span className="meeting-status" data-tone={meetingStatus(meeting).tone}>
              {meetingStatus(meeting).label}
            </span>
          </h2>
          <p className="card__meta">
            {formatMeetingWhen(meeting)} &middot; {meetingFormatLabels[meeting.format]}
            {meeting.location ? <> &middot; {meeting.location}</> : null}
            <> &middot; Chair: {meeting.chairName || "elected at the meeting"}</>
          </p>
        </div>
        <div className="meeting-row__actions">
          {canEdit && (
            <EditMeetingDetailsButton
              corpId={corpId}
              meetingId={meetingId}
              initial={{
                type: meeting.type,
                meetingDate: meeting.meetingDate,
                startTime: meeting.startTime ?? "",
                timezone: meeting.timezone,
                format: meeting.format,
                location: meeting.location ?? "",
                chairName: meeting.chairName ?? "",
              }}
              chairOptions={chairOptions}
            />
          )}
          {canEdit && <DeleteMeetingButton corpId={corpId} meetingId={meetingId} />}
          {canEdit && !editing && (
            <>
              <Link href={`/strata/${corpId}/meetings/${meetingId}?edit=1`} className="button button-secondary" data-testid="edit-agenda">
                Edit agenda
              </Link>
              <LaunchMeetingButton
                corpId={corpId}
                meetingId={meetingId}
                agendaSaved
                missingMotions={missingMotions(meeting.agenda)}
                editHref={`/strata/${corpId}/meetings/${meetingId}?edit=1`}
                subscribed={access.subscribed}
                trialAvailable={trialAvailable}
                isAdmin={access.isAdmin}
              />
            </>
          )}
          {meeting.agenda.length > 0 && (
            <a className="button button-secondary button-small" href={`/strata/${corpId}/meetings/${meetingId}/agenda.docx`} data-testid="export-agenda">
              Export agenda (.docx)
            </a>
          )}
          {!launchedByMe && meeting.launchedBy !== null && meeting.status !== "ADJOURNED" && canFollow && (
            <Link href={`/strata/${corpId}/meetings/${meetingId}/live`} className="button button-primary" data-testid="join-meeting">
              Join meeting
            </Link>
          )}
          {launchedByMe && meeting.status !== "ADJOURNED" && (
            <Link href={`/strata/${corpId}/meetings/${meetingId}/run`} className="button button-primary" data-testid="resume-meeting">
              Resume Meeting Mode
            </Link>
          )}
          {meeting.status === "ADJOURNED" && Boolean(meeting.minutesContent) && (
            <Link href={`/strata/${corpId}/meetings/${meetingId}/minutes`} className="button button-primary" data-testid="open-minutes">
              {meeting.minutesState === "FINAL" ? "View minutes" : "Draft minutes"}
            </Link>
          )}
        </div>
      </div>

      {launchedByOther && meeting.status !== "ADJOURNED" && (
        <p className="roster-notice" data-testid="meeting-running-elsewhere">
          {meeting.launchedByName ?? "Someone else"} is running this meeting.{" "}
          {canFollow ? "Join it with the Join meeting button." : "You\u2019ll see the agenda here."}
        </p>
      )}

      {takenOver && canEdit && !editing && (
        <p className="agenda-lock" role="status" data-testid="agenda-taken-over">
          {takenOver.slice(0, 120)} took over editing this agenda. Your changes were saved.
        </p>
      )}
      {editing ? (
        <AgendaCheckout
          corpId={corpId}
          meetingId={meetingId}
          editor={
            <AgendaBuilder
              corpId={corpId}
              meetingId={meetingId}
              meetingType={meeting.type}
              initialAgenda={meeting.agenda}
              initialVersion={agendaVersion(meeting.agenda)}
              initialNotes={notes}
              aiAvailable={access.subscribed || trialAvailable}
              ratifications={meeting.type === "council" ? await ratificationCandidates(corpId, meetingId) : []}
            />
          }
          viewer={<AgendaView corpId={corpId} agenda={meeting.agenda} />}
        />
      ) : (
        <AgendaView corpId={corpId} agenda={meeting.agenda} />
      )}
    </>
  );
}
