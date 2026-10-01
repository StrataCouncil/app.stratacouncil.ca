import { notFound, redirect } from "next/navigation";
import { MeetingMode } from "@/components/meetings/MeetingMode";
import { getStrataAccess } from "@/lib/data/strata";
import { getLotRoll, getMeeting, getMeetingNotes } from "@/lib/data/meetings";
import { createClient } from "@/lib/supabase/server";
import { autoPopulate } from "@/lib/meetings/agenda";

export const metadata = { title: "Meeting Mode" };

/** Meeting Mode — only for whoever launched this meeting (doc01 §4: one launch). */
export default async function MeetingModePage({ params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) notFound();
  if (meeting.status === "ADJOURNED") redirect(`/strata/${corpId}/meetings/${meetingId}/minutes`);
  if (meeting.launchedBy !== access.userId) redirect(`/strata/${corpId}/meetings/${meetingId}`);

  const supabase = await createClient();
  const [notes, roll, { data: corp }, { data: aiAccess }] = await Promise.all([
    getMeetingNotes(meetingId),
    getLotRoll(corpId),
    supabase.from("strata_corporations").select("strata_plan_number, legal_name, building_name").eq("strata_plan_number", corpId).maybeSingle(),
    supabase.rpc("has_stratasphere_access", { target_corporation_id: corpId }),
  ]);

  return (
    <MeetingMode
      corpId={corpId}
      meetingId={meetingId}
      planNumber={corp?.strata_plan_number ?? corpId}
      corpName={corp?.building_name || corp?.legal_name || corpId}
      type={meeting.type}
      meetingDate={meeting.meetingDate}
      startTime={meeting.startTime}
      timezone={meeting.timezone}
      chairName={meeting.chairName}
      status={meeting.status}
      actualStartAt={meeting.actualStartAt}
      initialAgenda={meeting.agenda.map(autoPopulate)}
      initialAttendance={meeting.attendance}
      initialAgendaApproved={meeting.agendaApproved}
      initialNotes={notes}
      lots={roll.lots.map(({ lot, name, isCouncil }) => ({ lot, name, isCouncil }))}
      isTrial={meeting.isTrial}
      aiAvailable={aiAccess === true}
    />
  );
}
