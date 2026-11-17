"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { generateMeetingDirectives } from "@/lib/directives/generate";
import { createClient } from "@/lib/supabase/server";
import { getMeeting, getLotRoll } from "@/lib/data/meetings";
import { electedChair, normalizeAgenda, type AgendaItem } from "@/lib/meetings/agenda";
import { checkAttachments } from "@/lib/meetings/attachments";
import { deferUnresolved, minutesSummary, type AttendanceStatus } from "@/lib/meetings/rules";
import { buildMinutes, clockTime } from "@/lib/meetings/minutes";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import { logDemoActivity } from "@/lib/demo-usage";
import { fileDiscussionRecord } from "@/lib/discussions/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { motionCounts, movementLines } from "@/lib/meetings/live";
import { decidedDuringVote } from "@/lib/meetings/steps";

/**
 * Meeting Mode (doc01 §4): saving the running meeting, Call to Order, the
 * Stratasphere conversation for the meeting, and adjournment. Only the person who launched the
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

/** A saved question or answer from this meeting, for Meeting Mode's Stratasphere panel. */
export type MeetingTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: StratasphereSource[];
  itemId: string;
};

/**
 * This person's Stratasphere conversation for this meeting (PR 4b), if they
 * have one: its id and the questions asked about each agenda item, with
 * their answers. Conversations are private to their owner (RLS, 0019).
 */
export async function meetingConversation(corpId: string, meetingId: string): Promise<{ id: string | null; turns: MeetingTurn[] }> {
  const none = { id: null, turns: [] };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return none;
  const { data: last } = await supabase
    .from("conversation_messages")
    .select("conversation_id, conversations!inner(user_id, corporation_id)")
    .eq("role", "user")
    .eq("focus->>kind", "agenda_item")
    .eq("focus->>meetingId", meetingId)
    .eq("conversations.user_id", user.id)
    .eq("conversations.corporation_id", corpId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return none;
  const id = last.conversation_id as string;
  const { data: rows } = await supabase
    .from("conversation_messages")
    .select("id, role, content, citations, focus")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(400);
  const turns: MeetingTurn[] = [];
  let itemId: string | null = null;
  for (const m of rows ?? []) {
    if (m.role === "user") {
      const f = (m.focus ?? null) as { kind?: string; meetingId?: string; itemId?: string } | null;
      itemId = f?.kind === "agenda_item" && f.meetingId === meetingId && f.itemId ? f.itemId : null;
    }
    if (!itemId) continue;
    turns.push({
      id: m.id as string,
      role: m.role as "user" | "assistant",
      content: m.content as string,
      sources: Array.isArray(m.citations) ? (m.citations as StratasphereSource[]) : [],
      itemId,
    });
  }
  return { id, turns };
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
    supabase.from("meeting_handovers").select("from_name, to_name, kind, at, item_id, reason").eq("meeting_id", meetingId).order("id"),
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
    // The Runner stepped out for this item and handed the meeting over (0084).
    const standIn = (handoverRows ?? []).find((h) => h.item_id === it.id && h.reason === "conflict");
    if (standIn) it = { ...it, standInRunner: (standIn.to_name as string) || "Someone else" };
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
  // Council votes ratified (or not) at this meeting (0070): the database
  // settled them on adjournment; their records get the outcome as a last line.
  const { data: settled } = await createAdminClient().from("discussions").select("id").eq("ratified_meeting_id", meetingId);
  for (const d of settled ?? []) await fileDiscussionRecord(d.id);
  // Directives (0097): follow-up from the carried motions, written after the
  // response so adjourning doesn't wait on Stratasphere.
  after(() => generateMeetingDirectives(corpId, meetingId));
  await logDemoActivity({
    kind: "meeting.adjourned",
    detail: { meetingId, decided: agenda.filter((i) => i.done).length, deferred: agenda.filter((i) => i.deferred).length, items: agenda.length },
  });
  revalidatePath(`/strata/${corpId}/meetings`, "layout");
  return { ok: true };
}
