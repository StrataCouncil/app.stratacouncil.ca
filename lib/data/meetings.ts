import { createClient } from "@/lib/supabase/server";
import { normalizeAgenda, type AgendaItem, type MeetingFormat, type MeetingType } from "@/lib/meetings/agenda";
import type { AttendanceStatus } from "@/lib/meetings/rules";

export interface MeetingRecord {
  id: string;
  corporationId: string;
  type: MeetingType;
  status: "DRAFT" | "LIVE" | "ADJOURNED";
  meetingDate: string;
  startTime: string | null;
  timezone: string;
  format: MeetingFormat;
  location: string | null;
  chairName: string | null;
  agenda: AgendaItem[];
  attendance: Record<string, AttendanceStatus>;
  attendees: string[];
  agendaApproved: boolean;
  launchedBy: string | null;
  launchedByName: string | null;
  launchedAt: string | null;
  actualStartAt: string | null;
  adjournedAt: string | null;
  isTrial: boolean;
  minutesState: "DRAFT" | "FINAL" | null;
  minutesContent: unknown;
  updatedAt: string;
}

const COLUMNS =
  "id, corporation_id, type, status, meeting_date, start_time, timezone, format, location, chair_name, agenda, attendance, attendees, agenda_approved, launched_by, launched_at, actual_start_at, adjourned_at, is_trial, minutes_state, minutes_content, updated_at, launcher:profiles!meetings_launched_by_fkey(full_name)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMeeting(r: any): MeetingRecord {
  return {
    id: r.id,
    corporationId: r.corporation_id,
    type: r.type,
    status: r.status,
    meetingDate: r.meeting_date,
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
    timezone: r.timezone,
    format: r.format,
    location: r.location,
    chairName: r.chair_name,
    agenda: normalizeAgenda(r.agenda),
    attendance: (r.attendance ?? {}) as Record<string, AttendanceStatus>,
    attendees: Array.isArray(r.attendees) ? r.attendees : [],
    agendaApproved: r.agenda_approved,
    launchedBy: r.launched_by,
    launchedByName: r.launcher?.full_name ?? null,
    launchedAt: r.launched_at,
    actualStartAt: r.actual_start_at,
    adjournedAt: r.adjourned_at,
    isTrial: r.is_trial,
    minutesState: r.minutes_state,
    minutesContent: r.minutes_content,
    updatedAt: r.updated_at,
  };
}

export async function listMeetings(corpId: string): Promise<MeetingRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .select(COLUMNS)
    .eq("corporation_id", corpId)
    .order("meeting_date", { ascending: false });
  if (error) console.error("[listMeetings]", error.message);
  return (data ?? []).map(toMeeting);
}

export async function getMeeting(corpId: string, meetingId: string): Promise<MeetingRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .select(COLUMNS)
    .eq("corporation_id", corpId)
    .eq("id", meetingId)
    .maybeSingle();
  if (error) console.error("[getMeeting]", error.message);
  return data ? toMeeting(data) : null;
}

/** Private notes, keyed by agenda item id. RLS returns nothing to anyone who may not see them. */
export async function getMeetingNotes(meetingId: string): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("meeting_item_notes").select("item_id, body").eq("meeting_id", meetingId);
  return Object.fromEntries((data ?? []).map((n) => [n.item_id, n.body]));
}

/** Lots, council lots, and display names for attendance and mover/seconder pickers. */
export async function getLotRoll(corpId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("owners_and_council")
    .select("lot_number, full_name, council_member_name, is_council_member, role")
    .eq("corporation_id", corpId)
    .order("lot_number");
  const lots = (data ?? []).map((r) => ({
    lot: r.lot_number as string,
    name: (r.council_member_name || r.full_name || "") as string,
    isCouncil: Boolean(r.is_council_member),
    role: (r.role as string | null) ?? null,
  }));
  return { lots, councilLots: lots.filter((l) => l.isCouncil) };
}

/** Default chair label: whoever holds the president role (BC SPA convention). */
export type ChairCandidate = { name: string; office: "President" | "Vice President" | "Manager" };

/** The usual chairs, in order: President, Vice President, Manager(s). */
export async function chairCandidates(corpId: string): Promise<ChairCandidate[]> {
  const supabase = await createClient();
  const [{ data: members }, { data: roles }] = await Promise.all([
    supabase.rpc("corporation_member_directory", { p_corporation_id: corpId }),
    supabase
      .from("corporation_role_assignments")
      .select("user_id, role")
      .eq("corporation_id", corpId)
      .in("role", ["president", "vice_president", "manager"]),
  ]);
  const nameOf = new Map(
    ((members ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map((m) => [
      m.user_id,
      m.full_name || m.email || null,
    ])
  );
  const offices = { president: "President", vice_president: "Vice President", manager: "Manager" } as const;
  const order = ["president", "vice_president", "manager"] as const;
  const out: ChairCandidate[] = [];
  for (const role of order) {
    for (const r of (roles ?? []).filter((x) => x.role === role)) {
      const name = nameOf.get(r.user_id);
      if (name) out.push({ name, office: offices[role] });
    }
  }
  return out;
}
