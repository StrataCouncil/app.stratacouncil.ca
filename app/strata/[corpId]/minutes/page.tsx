import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { HistoricMinutesUpload } from "@/components/meetings/HistoricMinutesUpload";
import { DocumentList } from "@/components/DocumentList";
import { getStrataAccess } from "@/lib/data/strata";
import { listMeetings } from "@/lib/data/meetings";
import { listHistoricMinutes } from "@/lib/data/documents";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";

/**
 * Minutes: every meeting's minutes (draft until finalized, then locked),
 * and historic minutes uploaded from before the strata used the platform.
 * Finalized minutes stay readable whatever the subscription state.
 */
export default async function MinutesPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const [meetings, historic] = await Promise.all([listMeetings(corpId), listHistoricMinutes(corpId)]);
  const withMinutes = meetings.filter((m) => m.status === "ADJOURNED");

  return (
    <>
      <StrataSphereNav active="minutes" />
      <h2 style={{ marginBottom: "1rem" }}>Minutes</h2>

      {access.canRunMeetings && <HistoricMinutesUpload corpId={corpId} aiAvailable={access.subscribed || !access.freeMeetingUsed} />}

      <h3 style={{ margin: "1.5rem 0 0.75rem" }}>Meeting minutes</h3>
      {withMinutes.length === 0 ? (
        <p className="card__meta">Minutes appear here when a meeting is adjourned.</p>
      ) : (
        <div className="module-list" data-testid="minutes-list">
          {withMinutes.map((m) => (
            <div className="module-row" key={m.id}>
              <div>
                <div className="module-row__title">{meetingTypeLabels[m.type]}</div>
                <div className="module-row__meta">
                  {formatMeetingWhen(m)} &middot; {m.minutesState === "FINAL" ? "Final" : "Draft"}
                </div>
              </div>
              <div className="meeting-row__actions">
                {m.minutesState === "FINAL" && (
                  <a className="button button-secondary button-small" href={`/strata/${corpId}/meetings/${m.id}/minutes.pdf`}>
                    PDF
                  </a>
                )}
                <Link href={`/strata/${corpId}/meetings/${m.id}/minutes`} className="button button-secondary button-small" data-testid={`view-minutes-${m.id}`}>
                  {m.minutesState === "FINAL" ? "View" : "Review"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {historic.length > 0 && (
        <>
          <h3 style={{ margin: "1.5rem 0 0.75rem" }}>Historic minutes</h3>
          <DocumentList corpId={corpId} documents={historic} />
        </>
      )}
    </>
  );
}
