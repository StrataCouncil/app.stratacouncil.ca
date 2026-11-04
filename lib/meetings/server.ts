import { APP_URL } from "@/lib/app-url";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";
import { meetingStartedEmail } from "@/lib/email/templates";
import { notifyUser } from "@/lib/email/notify";
import { createAdminClient } from "@/lib/supabase/admin";

const COUNCIL_ROLES = ["president", "vice_president", "treasurer", "secretary", "member_at_large", "manager"];

/**
 * A meeting has been launched (0074): council and the manager are emailed a
 * link to join it, everyone but whoever launched it. Read with the service
 * role after launch_meeting has checked the caller. On the demo site only a
 * Super Admin's sandbox sends anything, and only to them (lib/demo-email.ts).
 */
export async function emailMeetingStarted(corpId: string, meetingId: string, launcherId: string) {
  const admin = createAdminClient();
  const [{ data: meeting }, { data: corp }, { data: roles }, { data: launcher }] = await Promise.all([
    admin.from("meetings").select("type, location").eq("id", meetingId).maybeSingle(),
    admin.from("strata_corporations").select("legal_name, building_name").eq("strata_plan_number", corpId).maybeSingle(),
    admin.from("corporation_role_assignments").select("user_id, role").eq("corporation_id", corpId).in("role", COUNCIL_ROLES),
    admin.from("profiles").select("full_name").eq("id", launcherId).maybeSingle(),
  ]);
  if (!meeting) return;
  const ids = [...new Set((roles ?? []).map((r) => r.user_id as string))].filter((id) => id && id !== launcherId);
  if (!ids.length) return;
  const { data: active } = await admin
    .from("corporation_memberships")
    .select("user_id")
    .eq("corporation_id", corpId)
    .eq("status", "active")
    .in("user_id", ids);
  const message = meetingStartedEmail({
    corporationName: corp?.building_name || corp?.legal_name || corpId,
    meetingLabel: meetingTypeLabels[meeting.type as MeetingType] ?? "Meeting",
    runnerName: (launcher?.full_name as string) || "",
    joinUrl: `${APP_URL}/strata/${encodeURIComponent(corpId)}/meetings/${meetingId}/live`,
    agendaUrl: `${APP_URL}/strata/${encodeURIComponent(corpId)}/meetings/${meetingId}`,
    location: (meeting.location as string | null) ?? null,
  });
  await Promise.all((active ?? []).map((m) => notifyUser(m.user_id as string, message)));
}
