import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { MinutesView } from "@/components/meetings/MinutesView";
import { getStrataAccess } from "@/lib/data/strata";
import { getMeeting } from "@/lib/data/meetings";
import type { MinutesContent } from "@/lib/meetings/minutes";

export default async function MeetingMinutesPage({ params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) notFound();
  if (meeting.status !== "ADJOURNED" || !meeting.minutesContent) redirect(`/strata/${corpId}/meetings/${meetingId}`);
  const final = meeting.minutesState === "FINAL";

  return (
    <>
      <StrataSphereNav active="minutes" />
      <Link href={`/strata/${corpId}/minutes`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All minutes
      </Link>
      <div className="doc-header">
        <div>
          <h2>Minutes</h2>
          <p className="card__meta">
            {final ? "Final. This record is locked." : access.canRunMeetings ? "Draft. Review and edit the summaries, then finalize." : "Draft. Not yet final."}
          </p>
        </div>
        <div className="meeting-row__actions">
          {final ? (
            <a className="button button-primary button-small" href={`/strata/${corpId}/meetings/${meetingId}/minutes.pdf`} data-testid="minutes-pdf">
              Download PDF
            </a>
          ) : (
            <a className="button button-secondary button-small" href={`/strata/${corpId}/meetings/${meetingId}/minutes.docx`} data-testid="minutes-docx">
              Export draft (.docx)
            </a>
          )}
        </div>
      </div>
      <MinutesView
        corpId={corpId}
        meetingId={meetingId}
        minutes={meeting.minutesContent as MinutesContent}
        editable={!final && access.canRunMeetings}
        final={final}
      />
    </>
  );
}
