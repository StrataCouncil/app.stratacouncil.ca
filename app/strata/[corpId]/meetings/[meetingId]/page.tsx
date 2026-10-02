import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { AgendaBuilder } from "@/components/meetings/AgendaBuilder";
import { AgendaView } from "@/components/meetings/AgendaView";
import { DeleteMeetingButton, EditMeetingDetailsButton } from "@/components/meetings/MeetingActions";
import { getStrataAccess } from "@/lib/data/strata";
import { chairCandidates, getMeeting, getMeetingNotes } from "@/lib/data/meetings";
import { meetingFormatLabels, meetingTypeLabels } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { meetingStatus } from "@/lib/meetings/status";

/**
 * One meeting before it runs: details, the agenda builder (for whoever
 * can run meetings), and Launch. Once launched, the launcher runs it from
 * Meeting Mode and everyone else sees the agenda read-only.
 */
export default async function MeetingPage({ params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) notFound();

  const launchedByMe = meeting.launchedBy === access.userId;
  const launchedByOther = meeting.launchedBy !== null && !launchedByMe;
  const canEdit = access.canRunMeetings && meeting.status === "DRAFT" && meeting.launchedBy === null;
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
          {meeting.agenda.length > 0 && (
            <a className="button button-secondary button-small" href={`/strata/${corpId}/meetings/${meetingId}/agenda.docx`} data-testid="export-agenda">
              Export agenda (.docx)
            </a>
          )}
          {launchedByMe && meeting.status !== "ADJOURNED" && (
            <Link href={`/strata/${corpId}/meetings/${meetingId}/run`} className="button button-primary" data-testid="resume-meeting">
              Resume Meeting Mode
            </Link>
          )}
          {meeting.status === "ADJOURNED" && (
            <Link href={`/strata/${corpId}/meetings/${meetingId}/minutes`} className="button button-primary" data-testid="open-minutes">
              {meeting.minutesState === "FINAL" ? "View minutes" : "Review minutes"}
            </Link>
          )}
        </div>
      </div>

      {launchedByOther && meeting.status !== "ADJOURNED" && (
        <p className="roster-notice" data-testid="meeting-running-elsewhere">
          {meeting.launchedByName ?? "Someone else"} is running this meeting. You&rsquo;ll see the agenda here; the meeting
          itself is only visible to whoever is running it.
        </p>
      )}

      {canEdit ? (
        <AgendaBuilder
          corpId={corpId}
          meetingId={meetingId}
          meetingType={meeting.type}
          initialAgenda={meeting.agenda}
          initialUpdatedAt={meeting.updatedAt}
          initialNotes={notes}
          aiAvailable={access.subscribed || trialAvailable}
          launch={{ subscribed: access.subscribed, trialAvailable, isAdmin: access.isAdmin }}
        />
      ) : (
        <AgendaView corpId={corpId} agenda={meeting.agenda} />
      )}
    </>
  );
}
