import { APP_URL } from "@/lib/app-url";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";
import { meetingStartedEmail } from "@/lib/email/templates";
import { notifyUser } from "@/lib/email/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { corporationRoleLabels, type CorporationRole } from "@/lib/strata";

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

/**
 * People who could run this strata's meetings (0079), for the Runner's
 * Hand over list: active members who are its admin or secretary, or have
 * been allowed to. The database checks again when the meeting is handed over.
 */
export async function runnerCandidates(corpId: string, excludeUser: string): Promise<Array<{ userId: string; name: string }>> {
  const admin = createAdminClient();
  const [{ data: members }, { data: roles }] = await Promise.all([
    admin.from("corporation_memberships").select("user_id, can_run_meetings").eq("corporation_id", corpId).eq("status", "active"),
    admin.from("corporation_role_assignments").select("user_id").eq("corporation_id", corpId).in("role", ["admin", "secretary"]),
  ]);
  const byRole = new Set((roles ?? []).map((r) => r.user_id as string));
  const ids = (members ?? []).filter((m) => m.can_run_meetings || byRole.has(m.user_id as string)).map((m) => m.user_id as string).filter((id) => id !== excludeUser);
  if (!ids.length) return [];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
  return (profiles ?? []).map((p) => ({ userId: p.id as string, name: (p.full_name as string) || "Someone" }));
}

/** Most telling first: an office, then council, then manager, then admin. */
const ROLE_ORDER: CorporationRole[] = ["president", "vice_president", "treasurer", "secretary", "member_at_large", "manager", "admin"];

/**
 * Each person's role on this strata ("President", "Manager"), by user id,
 * for Meeting Mode's list of who's in the meeting. Someone with several
 * shows the most telling one. Read with the service role: the page has
 * already checked that the caller runs this meeting.
 */
export async function meetingRoles(corpId: string): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data } = await admin.from("corporation_role_assignments").select("user_id, role").eq("corporation_id", corpId);
  const best = new Map<string, CorporationRole>();
  for (const r of data ?? []) {
    const role = r.role as CorporationRole;
    const id = r.user_id as string;
    if (!ROLE_ORDER.includes(role)) continue;
    const cur = best.get(id);
    if (!cur || ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(cur)) best.set(id, role);
  }
  return Object.fromEntries([...best].map(([id, role]) => [id, corporationRoleLabels[role]]));
}
