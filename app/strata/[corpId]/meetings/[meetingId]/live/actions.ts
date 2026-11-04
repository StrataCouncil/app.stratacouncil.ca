"use server";

import { createClient } from "@/lib/supabase/server";
import { motionCounts, parseLiveState, type Choice, type LiveState } from "@/lib/meetings/live";
import { logDemoActivity } from "@/lib/demo-usage";

/**
 * Live voting (0073). Every rule (who runs the meeting, who may vote, one
 * ballot per lot, nothing changes once a vote closes) is enforced by the
 * database functions; these only check the shape of what's sent.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOT = /^SL\s?-?\d{1,4}$/;
const CHOICES: readonly string[] = ["for", "against", "abstain"];
const DECISION_TYPES: readonly string[] = ["MAJORITY", "THREE_QUARTER", "EIGHTY_PERCENT", "UNANIMOUS"];

/** The database's own message when it's one written for people; otherwise a general one. */
function failFrom(error: { message: string; code?: string } | null, fallback: string): Fail {
  const msg = error?.message ?? "";
  const ours = /^(Only|This vote|Another vote|Call the meeting|That |Write the motion|Choose|No council|No quorum|Live voting|Conflicts|Declare a conflict|Describe the conflict|Unknown)/.test(msg);
  if (!ours) console.error("[live voting]", error?.code, msg);
  return { ok: false, error: ours ? msg : fallback };
}

/** What the live screens need, polled every few seconds. Null if the person may not follow. */
export async function getLiveState(meetingId: string): Promise<LiveState | null> {
  if (!UUID.test(meetingId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("live_meeting_state", { p_meeting_id: meetingId });
  if (error) {
    console.error("[getLiveState]", error.code, error.message);
    return null;
  }
  return parseLiveState(data);
}

export async function openVote(meetingId: string, itemId: string, motion: string, decisionType: string): Promise<Ok<{ voteId: string }> | Fail> {
  if (!UUID.test(meetingId) || !itemId || itemId.length > 100) return { ok: false, error: "That item isn't available." };
  if (!DECISION_TYPES.includes(decisionType)) return { ok: false, error: "Unknown decision type." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_meeting_vote", {
    p_meeting_id: meetingId,
    p_item_id: itemId,
    p_motion: String(motion ?? "").slice(0, 4000),
    p_decision_type: decisionType,
  });
  if (error || !data) return failFrom(error, "Couldn't open the vote. Try again.");
  await logDemoActivity({ kind: "meeting.vote_opened", detail: { meetingId, itemId } });
  return { ok: true, voteId: data as string };
}

/** A council member's own vote. */
export async function castVote(voteId: string, choice: Choice): Promise<Ok | Fail> {
  if (!UUID.test(voteId) || !CHOICES.includes(choice)) return { ok: false, error: "Choose For, Against or Abstain." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cast_meeting_vote", { p_vote_id: voteId, p_choice: choice });
  return error ? failFrom(error, "Your vote didn't go through. Try again.") : { ok: true };
}

/** The runner enters a vote for a council member (or their own). */
export async function recordVote(voteId: string, lot: string, choice: Choice): Promise<Ok | Fail> {
  if (!UUID.test(voteId) || !LOT.test(lot) || !CHOICES.includes(choice)) return { ok: false, error: "Choose For, Against or Abstain." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_meeting_vote", { p_vote_id: voteId, p_lot: lot, p_choice: choice });
  return error ? failFrom(error, "That vote didn't go through. Try again.") : { ok: true };
}

/** Closes the vote and returns the counts for the motion (a non-vote counts as abstaining). */
export async function closeVote(voteId: string): Promise<Ok<{ counts: { for: number; against: number; abstain: number }; present: number; missing: number }> | Fail> {
  if (!UUID.test(voteId)) return { ok: false, error: "That vote isn't available." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_meeting_vote", { p_vote_id: voteId });
  if (error || !data) return failFrom(error, "Couldn't close the vote. Try again.");
  const r = data as { for: number; against: number; abstain: number; missing: number; present: number };
  return { ok: true, counts: motionCounts(r), present: r.present, missing: r.missing };
}

export async function cancelVote(voteId: string): Promise<Ok | Fail> {
  if (!UUID.test(voteId)) return { ok: false, error: "That vote isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_meeting_vote", { p_vote_id: voteId });
  return error ? failFrom(error, "Couldn't cancel the vote. Try again.") : { ok: true };
}

/** A conflict of interest on an item: declared by the member for themselves, or recorded by the runner. */
export async function declareConflict(meetingId: string, itemId: string, lot: string, note: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId) || !itemId || itemId.length > 100 || !LOT.test(lot)) return { ok: false, error: "That item isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("declare_meeting_conflict", {
    p_meeting_id: meetingId,
    p_item_id: itemId,
    p_lot: lot,
    p_note: String(note ?? "").slice(0, 500),
  });
  return error ? failFrom(error, "Couldn't record the conflict. Try again.") : { ok: true };
}

export async function withdrawConflict(meetingId: string, itemId: string, lot: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId) || !itemId || !LOT.test(lot)) return { ok: false, error: "That item isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_meeting_conflict", { p_meeting_id: meetingId, p_item_id: itemId, p_lot: lot });
  return error ? failFrom(error, "Couldn't remove the conflict. Try again.") : { ok: true };
}

/** Joins (or rejoins) a launched meeting: a council member's lot is marked present (0074). */
export async function joinMeeting(meetingId: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId)) return { ok: false, error: "That meeting isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_meeting", { p_meeting_id: meetingId });
  if (error) {
    if (error.message.includes("isn't running")) return { ok: false, error: "This meeting isn't running." };
    if (error.message.includes("isn't available")) return { ok: false, error: "This meeting isn't available to you." };
    return failFrom(error, "Couldn't join the meeting. Try again.");
  }
  return { ok: true };
}

/** Leaves the meeting; the exit time is recorded. */
export async function leaveMeeting(meetingId: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId)) return { ok: false, error: "That meeting isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_meeting", { p_meeting_id: meetingId });
  return error ? failFrom(error, "Couldn't record that you left. Try again.") : { ok: true };
}

/** The runner marks a council lot as having left, after typing "Left meeting". */
export async function markLeft(meetingId: string, lot: string, confirm: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId) || !LOT.test(lot)) return { ok: false, error: "That lot isn't in this meeting." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_left_meeting", { p_meeting_id: meetingId, p_lot: lot, p_confirm: String(confirm ?? "").slice(0, 40) });
  if (error?.message.includes('Type "Left meeting"')) return { ok: false, error: 'Type "Left meeting" to confirm.' };
  if (error?.message.includes("isn't marked present")) return { ok: false, error: "That lot isn't marked present." };
  return error ? failFrom(error, "Couldn't mark them as having left. Try again.") : { ok: true };
}

/** The runner marks a council lot present (on the phone, in the room), at this time (0075). */
export async function markJoined(meetingId: string, lot: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId) || !LOT.test(lot)) return { ok: false, error: "That lot isn't on council." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_joined_meeting", { p_meeting_id: meetingId, p_lot: lot });
  if (error?.message.includes("isn't on council")) return { ok: false, error: "That lot isn't on council." };
  return error ? failFrom(error, "Couldn't mark them present. Try again.") : { ok: true };
}
