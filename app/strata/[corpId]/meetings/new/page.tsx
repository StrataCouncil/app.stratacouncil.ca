import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { MeetingDetailsForm } from "@/components/meetings/MeetingDetailsForm";
import { getStrataAccess } from "@/lib/data/strata";
import { chairCandidates } from "@/lib/data/meetings";
import { DEMO_LIMIT_MESSAGE, IS_DEMO, SIGNUP_URL } from "@/lib/demo";
import { demoAllowanceLeft } from "@/lib/demo-usage";

export default async function NewMeetingPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();

  return (
    <>
      <StrataSphereNav active="meetings" />
      <Link href={`/strata/${corpId}/meetings`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All meetings
      </Link>
      <h2 style={{ marginBottom: "1rem" }}>New meeting</h2>
      {IS_DEMO && (
        <p className="card__meta" style={{ marginBottom: "1rem", maxWidth: 640 }}>
          Choose a date and time. The agenda for your strata&rsquo;s next council meeting fills in for you, with its
          attachments. You can edit its New Business item, Roof Repairs, then run the meeting in Meeting Mode.
        </p>
      )}
      {IS_DEMO && (await demoAllowanceLeft())?.meetings === 0 ? (
        <div className="card" style={{ maxWidth: 640 }} data-testid="demo-meeting-used">
          <p>You&rsquo;ve created this demo&rsquo;s meeting. {DEMO_LIMIT_MESSAGE}</p>
          <a href={SIGNUP_URL} className="button button-primary">
            Create your free account
          </a>
        </div>
      ) : access.canRunMeetings ? (
        <div className="card" style={{ maxWidth: 640 }}>
          <MeetingDetailsForm corpId={corpId} chairOptions={await chairCandidates(corpId)} />
        </div>
      ) : (
        <p className="roster-notice">
          Meetings are set up by your strata&rsquo;s secretary or admin, or anyone they&rsquo;ve allowed to run meetings.
        </p>
      )}
    </>
  );
}
