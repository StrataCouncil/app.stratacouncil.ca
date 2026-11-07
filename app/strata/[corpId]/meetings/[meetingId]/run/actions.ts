"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMeeting, getLotRoll } from "@/lib/data/meetings";
import { electedChair, normalizeAgenda, meetingTypeLabels, type AgendaItem } from "@/lib/meetings/agenda";
import { checkAttachments } from "@/lib/meetings/attachments";
import { deferUnresolved, minutesSummary, type AttendanceStatus } from "@/lib/meetings/rules";
import { buildMinutes, clockTime } from "@/lib/meetings/minutes";
import { askStratasphere, type AssistantTurn } from "@/lib/ai/stratasphere";
import { IS_DEMO, demoLimitFail } from "@/lib/demo";
import { logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";
import { fileDiscussionRecord } from "@/lib/discussions/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { motionCounts, movementLines } from "@/lib/meetings/live";
import { decidedDuringVote } from "@/lib/meetings/steps";
import { endMeetingVideo } from "@/lib/meetings/video";

/**
 * Meeting Mode (doc01 §4): saving the running meeting, Call to Order, the
 * embedded assistant, and adjournment. Only the person who launched the
 * meeting gets anywhere here — RLS and the lifecycle functions (0014,
 * 0015) enforce it.
 */

type Fail = { ok: false; error: string };

const ATTENDANCE: readonly AttendanceStatus[] = ["", "present", "regrets", "proxy", "left"];

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
  state: { agenda: unknown; attendance: Record<string, string>; agendaApproved: boolean; currentItemId?: string | null }
): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const attendance = cleanAttendance(state.attendance);
  let agenda;
  try {
    agenda = await checkAttachments(supabase, corpId, normalizeAgenda(state.agenda).slice(0, 300));
  } catch (err) {
    console.error("[saveMeetingState] attachments", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't save. Check your connection; your changes are kept on this screen." };
  }
  // While a vote is open, nothing else is decided: no other item may be
  // newly marked done or deferred until that vote closes.
  const { data: openVote } = await supabase
    .from("meeting_votes")
    .select("item_id")
    .eq("meeting_id", meetingId)
    .eq("status", "open")
    .maybeSingle();
  if (openVote) {
    const { data: stored } = await supabase.from("meetings").select("agenda").eq("id", meetingId).eq("corporation_id", corpId).maybeSingle();
    const before = normalizeAgenda(stored?.agenda ?? []);
    const early = decidedDuringVote(before, agenda, openVote.item_id as string);
    if (early.length) {
      const num = before.find((i) => i.id === openVote.item_id)?.num;
      return { ok: false, error: `A vote is open${num ? ` on item ${num}` : ""}. Close it before deciding anything else.` };
    }
  }
  // A chair elected at the meeting becomes the meeting's chair (agenda,
  // scripts and minutes).
  const chair = electedChair(agenda);
  const { data, error } = await supabase
    .from("meetings")
    .update({
      agenda,
      attendance,
      attendees: presentLots(attendance),
      agenda_approved: Boolean(state.agendaApproved),
      // Where the runner is, so members' live pages follow along (0073).
      current_item_id: typeof state.currentItemId === "string" ? state.currentItemId.slice(0, 100) : null,
      ...(chair ? { chair_name: chair } : {}),
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
  await logDemoActivity({ kind: "meeting.called_to_order", detail: { meetingId, present: presentLots(clean).length } });
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
  // Whoever runs the meeting, and council members following it live (0073).
  const following =
    meeting && meeting.launchedBy !== user?.id && meeting.status === "LIVE"
      ? (await supabase.rpc("can_follow_meeting", { p_meeting_id: meetingId })).data === true
      : false;
  if (!user || !meeting || (meeting.launchedBy !== user.id && !following) || meeting.status === "ADJOURNED") {
    return { ok: false as const, error: "The assistant is available to whoever is running this meeting, and to council members following it." };
  }
  const liveAgenda = normalizeAgenda(agenda);
  const item = liveAgenda.find((i) => i.id === itemId);
  if (!item) return { ok: false as const, error: "Pick an agenda item first." };
  if (IS_DEMO && !(await takeDemoAllowance("meeting"))) {
    await logDemoActivity({ kind: "limit", detail: { reason: "Meeting Mode questions", question } });
    return demoLimitFail();
  }
  const result = await askStratasphere({
    supabase,
    corpId,
    question,
    // Only the text of each turn: records come from our own database, never from the browser.
    history: (history ?? [])
      .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
      .slice(-10)
      .map((t) => ({ role: t.role, content: t.content })),
    meeting: { item, agenda: liveAgenda, meetingLabel: meetingTypeLabels[meeting.type] },
  });
  if (!result.ok) await refundDemoAllowance("meeting");
  await logDemoActivity({
    kind: "stratasphere.meeting",
    detail: result.ok ? { item: item.text, question, answer: result.text } : { item: item.text, question, failed: result.error },
  });
  // The records an answer drew on stay on the server.
  return result.ok ? { ok: true as const, text: result.text, sources: result.sources } : result;
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

  // Live votes and declared conflicts (0073) are taken from the database,
  // not the screen: a motion decided by a live vote keeps the counts the
  // vote recorded, and each item carries the conflicts declared on it.
  const [{ data: closedVotes }, { data: conflictRows, error: conflictsError }, { data: presenceRows }, { data: handoverRows }] = await Promise.all([
    supabase.from("meeting_votes").select("id, votes_for, votes_against, votes_abstain, votes_missing").eq("meeting_id", meetingId).eq("status", "closed"),
    // Read with the service key: the minutes must carry every declaration
    // (SPA s.32), whatever the reader's own access. The meeting itself was
    // read above with theirs, and only its runner can adjourn it.
    createAdminClient().from("meeting_conflicts").select("item_id, lot_number, note, acknowledged_at").eq("meeting_id", meetingId),
    // Late arrivals and departures, for the minutes (0074).
    supabase.from("meeting_presence").select("id, user_id, lot_number, event, at").eq("meeting_id", meetingId).order("id"),
    // Changes of who ran the meeting (0079).
    supabase.from("meeting_handovers").select("from_name, to_name, kind, at").eq("meeting_id", meetingId).order("id"),
  ]);
  if (conflictsError) console.error("[adjournMeeting] conflicts", conflictsError.code, conflictsError.message);
  const votesById = new Map((closedVotes ?? []).map((v) => [v.id as string, v]));
  const agenda: AgendaItem[] = deferUnresolved(normalizeAgenda(rawAgenda)).map((raw) => {
    let it = raw;
    const v = it.motion?.voteId ? votesById.get(it.motion.voteId) : undefined;
    if (it.motion && v) {
      it = { ...it, motion: { ...it.motion, ...motionCounts({ for: v.votes_for ?? 0, against: v.votes_against ?? 0, abstain: v.votes_abstain ?? 0, missing: v.votes_missing ?? 0 }) } };
    }
    const declared = (conflictRows ?? [])
      .filter((c) => c.item_id === it.id)
      .map((c) => ({ lot: c.lot_number as string, note: (c.note as string) ?? "", left: c.acknowledged_at != null }));
    if (declared.length) it = { ...it, conflicts: declared.sort((a, b) => a.lot.localeCompare(b.lot)) };
    return it.deferred && !it.done && !it.minutesSummary ? { ...it, minutesSummary: minutesSummary(it) } : it;
  });
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
    movements: movementLines(
      (presenceRows ?? []).map((p) => ({ id: p.id as number, userId: p.user_id, name: "", lot: p.lot_number, event: p.event, at: p.at })),
      meeting.actualStartAt,
      (iso) => clockTime(iso, meeting.timezone),
      (handoverRows ?? []).map((h) => ({
        fromName: (h.from_name as string) || "Someone",
        toName: (h.to_name as string) || "Someone",
        kind: h.kind === "took_over" ? ("took_over" as const) : ("handed_over" as const),
        at: h.at as string,
      }))
    ),
  });

  // Attendance may have changed since Call to Order (late arrivals).
  await supabase.from("meetings").update({ attendance: clean, attendees: presentLots(clean) }).eq("id", meetingId);
  const { error } = await supabase.rpc("adjourn_meeting", { p_meeting_id: meetingId, p_agenda: agenda, p_minutes: minutes });
  if (error) {
    console.error("[adjournMeeting]", error.code, error.message);
    return { ok: false, error: error.message.includes("already") || error.message.includes("decided") ? error.message : "Couldn't adjourn the meeting." };
  }
  // The Zoom meeting ends for everyone and its host licence is freed (0080).
  await endMeetingVideo(meetingId);
  // Council votes ratified (or not) at this meeting (0070): the database
  // settled them on adjournment; their records get the outcome as a last line.
  const { data: settled } = await createAdminClient().from("discussions").select("id").eq("ratified_meeting_id", meetingId);
  for (const d of settled ?? []) await fileDiscussionRecord(d.id);
  await logDemoActivity({
    kind: "meeting.adjourned",
    detail: { meetingId, decided: agenda.filter((i) => i.done).length, deferred: agenda.filter((i) => i.deferred).length, items: agenda.length },
  });
  revalidatePath(`/strata/${corpId}/meetings`, "layout");
  return { ok: true };
}
