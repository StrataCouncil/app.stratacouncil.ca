"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMeeting, getLotRoll } from "@/lib/data/meetings";
import { normalizeAgenda, meetingTypeLabels, type AgendaItem } from "@/lib/meetings/agenda";
import { deferUnresolved, minutesSummary, type AttendanceStatus } from "@/lib/meetings/rules";
import { buildMinutes } from "@/lib/meetings/minutes";
import { askStratasphere, type AssistantTurn } from "@/lib/ai/stratasphere";

/**
 * Meeting Mode (doc01 §4): saving the running meeting, Call to Order, the
 * embedded assistant, and adjournment. Only the person who launched the
 * meeting gets anywhere here — RLS and the lifecycle functions (0014,
 * 0015) enforce it.
 */

type Fail = { ok: false; error: string };

const ATTENDANCE: readonly AttendanceStatus[] = ["", "present", "regrets", "proxy"];

function cleanAttendance(raw: Record<string, string>): Record<string, AttendanceStatus> {
  const out: Record<string, AttendanceStatus> = {};
  for (const [lot, status] of Object.entries(raw ?? {}).slice(0, 5000)) {
    if (/^SL\s?-?\d{1,4}$/.test(lot) && (ATTENDANCE as readonly string[]).includes(status) && status) {
      out[lot] = status as AttendanceStatus;
    }
  }
  return out;
}

const presentLots = (attendance: Record<string, AttendanceStatus>) =>
  Object.keys(attendance).filter((k) => attendance[k] === "present").sort();

export async function saveMeetingState(
  corpId: string,
  meetingId: string,
  state: { agenda: unknown; attendance: Record<string, string>; agendaApproved: boolean }
): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const attendance = cleanAttendance(state.attendance);
  const { data, error } = await supabase
    .from("meetings")
    .update({
      agenda: normalizeAgenda(state.agenda).slice(0, 300),
      attendance,
      attendees: presentLots(attendance),
      agenda_approved: Boolean(state.agendaApproved),
    })
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .neq("status", "ADJOURNED")
    .select("id");
  if (error) {
    console.error("[saveMeetingState]", error.code, error.message);
    return { ok: false, error: "Couldn't save. Check your connection; your changes are kept on this screen." };
  }
  if (!data?.length) return { ok: false, error: "This meeting can't be changed from here any more." };
  return { ok: true };
}

export async function callToOrder(
  corpId: string,
  meetingId: string,
  attendance: Record<string, string>
): Promise<{ ok: true; startedAt: string } | Fail> {
  const supabase = await createClient();
  const clean = cleanAttendance(attendance);
  const { error } = await supabase.rpc("call_meeting_to_order", {
    p_meeting_id: meetingId,
    p_attendance: clean,
    p_attendees: presentLots(clean),
  });
  if (error) {
    console.error("[callToOrder]", error.code, error.message);
    return { ok: false, error: error.message.includes("already") ? error.message : "Couldn't call the meeting to order." };
  }
  const meeting = await getMeeting(corpId, meetingId);
  return { ok: true, startedAt: meeting?.actualStartAt ?? new Date().toISOString() };
}

export async function askMeetingAssistant(
  corpId: string,
  meetingId: string,
  itemId: string,
  agenda: unknown,
  history: AssistantTurn[],
  question: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meeting = await getMeeting(corpId, meetingId);
  if (!user || !meeting || meeting.launchedBy !== user.id || meeting.status === "ADJOURNED") {
    return { ok: false as const, error: "The assistant is available to whoever is running this meeting." };
  }
  const liveAgenda = normalizeAgenda(agenda);
  const item = liveAgenda.find((i) => i.id === itemId);
  if (!item) return { ok: false as const, error: "Pick an agenda item first." };
  return askStratasphere({
    supabase,
    corpId,
    question,
    history: (history ?? []).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string"),
    meeting: { item, agenda: liveAgenda, meetingLabel: meetingTypeLabels[meeting.type] },
  });
}

/**
 * Adjourn. Anything still unresolved is deferred (the user confirmed that
 * in the app), deferred items get their minutes line, the draft minutes are
 * built, and the meeting closes — writing carried motions to the ledger.
 */
export async function adjournMeeting(
  corpId: string,
  meetingId: string,
  rawAgenda: unknown,
  attendance: Record<string, string>
): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) return { ok: false, error: "Meeting not found." };

  const agenda: AgendaItem[] = deferUnresolved(normalizeAgenda(rawAgenda)).map((it) =>
    it.deferred && !it.done && !it.minutesSummary ? { ...it, minutesSummary: minutesSummary(it) } : it
  );
  const clean = cleanAttendance(attendance);
  const [{ data: corp }, roll] = await Promise.all([
    supabase.from("strata_corporations").select("strata_plan_number, legal_name, building_name, address, unit_count").eq("strata_plan_number", corpId).maybeSingle(),
    getLotRoll(corpId),
  ]);
  if (!corp) return { ok: false, error: "Corporation not found." };

  const minutes = buildMinutes({
    corporation: { planNumber: corp.strata_plan_number, name: corp.building_name || corp.legal_name, address: corp.address },
    meeting,
    agenda,
    attendance: clean,
    lotCount: roll.lots.length || corp.unit_count,
    councilCount: roll.councilLots.length,
    adjournedAt: new Date().toISOString(),
  });

  // Attendance may have changed since Call to Order (late arrivals).
  await supabase.from("meetings").update({ attendance: clean, attendees: presentLots(clean) }).eq("id", meetingId);
  const { error } = await supabase.rpc("adjourn_meeting", { p_meeting_id: meetingId, p_agenda: agenda, p_minutes: minutes });
  if (error) {
    console.error("[adjournMeeting]", error.code, error.message);
    return { ok: false, error: error.message.includes("already") || error.message.includes("decided") ? error.message : "Couldn't adjourn the meeting." };
  }
  revalidatePath(`/strata/${corpId}/meetings`, "layout");
  return { ok: true };
}
