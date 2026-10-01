import Link from "next/link";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { MeetingsList } from "@/components/MeetingsList";
import { getStrataAccess } from "@/lib/data/strata";
import { meetings } from "@/lib/placeholder-data";

/**
 * Meetings — every meeting for this corporation, whatever state it's in,
 * one list (`MeetingsList`, grouped by status). This is the menu item
 * previously labeled "Meeting Mode" (nav renamed to just "Meetings" —
 * "Meeting Mode" stays the name of the in-progress, chair-only session
 * itself, doc01 §4/doc02 §5, it's just no longer what the nav tab is
 * called). One full free meeting before subscribing (doc01 §4b, doc03
 * Stage 5a), then gated — that gate is about *creating and running* a
 * meeting, not about seeing this list, so the "Create meeting" panel
 * below still branches on subscription/trial status the same as before.
 */
export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  const subscribed = access?.subscribed ?? false;
  const trialAvailable = !(access?.freeMeetingUsed ?? true);

  return (
    <>
      <StrataSphereNav active="meetings" />
      <h2 style={{ marginBottom: "1rem" }}>Meetings</h2>

      {subscribed || trialAvailable ? (
        <div className="card" style={{ maxWidth: 480, marginBottom: "2rem" }}>
          <h3>
            {subscribed ? "Start a meeting" : "Your free meeting is ready"}
          </h3>
          <p>
            {subscribed
              ? "Council, AGM, SGM or committee — set the type, date and format to begin."
              : "Full functionality, full document access, no restrictions. Ends when the meeting is adjourned and finalized."}
          </p>
          <button className="button button-primary" style={{ alignSelf: "flex-start" }} data-testid="start-meeting">
            Create meeting
          </button>
        </div>
      ) : (
        <div className="lock-panel" style={{ marginBottom: "2rem" }}>
          <h2>Your free meeting has been used</h2>
          <p>
            Subscribe to Stratasphere&trade; to run another meeting.
            Everything from your free meeting &mdash; documents, finalized
            minutes, decisions &mdash; stays fully accessible either way.
          </p>
          <Link
            href={`/strata/${corpId}/billing`}
            className="button button-primary"
            data-testid="meetings-subscribe-cta"
          >
            Subscribe to Stratasphere&trade;
          </Link>
        </div>
      )}

      <MeetingsList initialMeetings={meetings} />
    </>
  );
}
