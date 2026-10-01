import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { MeetingDetailsForm } from "@/components/meetings/MeetingDetailsForm";
import { getStrataAccess } from "@/lib/data/strata";
import { chairCandidates } from "@/lib/data/meetings";

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
      {access.canRunMeetings ? (
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
