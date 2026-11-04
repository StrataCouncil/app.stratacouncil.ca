import { notFound, redirect } from "next/navigation";
import { LiveMeeting } from "@/components/meetings/LiveMeeting";
import { getStrataAccess } from "@/lib/data/strata";
import { getLotRoll, getMeeting } from "@/lib/data/meetings";
import { getCurrentProfile } from "@/lib/data/profile";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import { createClient } from "@/lib/supabase/server";
import { demoAllowanceLeft } from "@/lib/demo-usage";
import { getLiveState } from "./actions";

export const metadata = { title: "Meeting" };

/**
 * Following a council meeting live (0073): the agenda as the person
 * running it moves through it, each item's details and attachments, and
 * the vote buttons while a vote is open. For council members, the manager
 * and anyone who can run meetings; whoever launched it is sent to Meeting Mode.
 */
export default async function LiveMeetingPage({ params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) notFound();
  // Open from launch until adjournment (0074).
  if (meeting.launchedBy === null || meeting.status === "ADJOURNED") redirect(`/strata/${corpId}/meetings/${meetingId}`);
  if (meeting.launchedBy === access.userId) redirect(`/strata/${corpId}/meetings/${meetingId}/run`);

  const supabase = await createClient();
  const [state, roll, { data: corp }, { data: aiAccess }, demoLeft, profile] = await Promise.all([
    getLiveState(meetingId),
    getLotRoll(corpId),
    supabase.from("strata_corporations").select("strata_plan_number, legal_name, building_name").eq("strata_plan_number", corpId).maybeSingle(),
    supabase.rpc("has_stratasphere_access", { target_corporation_id: corpId }),
    demoAllowanceLeft(),
    getCurrentProfile(),
  ]);
  // Not on council, not the manager and can't run meetings: the meeting page instead.
  if (!state) redirect(`/strata/${corpId}/meetings/${meetingId}`);

  return (
    <LiveMeeting
      corpId={corpId}
      meetingId={meetingId}
      title={meetingTypeLabels[meeting.type]}
      planNumber={corp?.strata_plan_number ?? corpId}
      corpName={corp?.building_name || corp?.legal_name || corpId}
      runnerName={meeting.launchedByName}
      names={Object.fromEntries(roll.lots.map((l) => [l.lot, l.name]))}
      me={{ name: profile?.fullName || "You", avatarUrl: profile?.avatarUrl ?? null }}
      initial={state}
      isTrial={meeting.isTrial}
      aiAvailable={aiAccess === true}
      demoLeft={demoLeft?.meeting ?? null}
    />
  );
}
