"use server";

import { createClient } from "@/lib/supabase/server";
import { motionCounts, parseLiveState, parsePresenting, type Choice, type LiveState, type Presenting } from "@/lib/meetings/live";
import { logDemoActivity } from "@/lib/demo-usage";
import { IS_DEMO } from "@/lib/demo";
import { demoRestricted } from "@/lib/demo-sandbox";
import { zoomConfig } from "@/lib/zoom/api";
import { meetingSdkSignature, zoomDisplayName } from "@/lib/zoom/signature";
import { ensureZoomMeeting, openZoomMeeting, zakFor } from "@/lib/meetings/video";

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
  const ours = /^(Only|This meeting|Choose who|Join the meeting|The person running|This vote|Another vote|Call the meeting|That |Write the motion|Choose|No council|No quorum|Live voting|Conflicts|Declare a conflict|Describe the conflict|Unknown|What's shown)/.test(msg);
  if (!ours) console.error("[live voting]", error?.code, msg);
  return { ok: false, error: ours ? msg : fallback };
}

/** What the live screens need, polled every few seconds. Null if the person may not follow. */
export async function getLiveState(meetingId: string): Promise<LiveState | null> {
  if (!UUID.test(meetingId)) return null;
  const supabase = await createClient();
  const [{ data, error }, { data: row }, { data: handover }] = await Promise.all([
    supabase.rpc("live_meeting_state", { p_meeting_id: meetingId }),
    supabase.from("meetings").select("presenting, runner_seen_at, launched_at").eq("id", meetingId).maybeSingle(),
    supabase.from("meeting_handovers").select("to_user, from_name, to_name, kind, at").eq("meeting_id", meetingId).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) {
    console.error("[getLiveState]", error.code, error.message);
    return null;
  }
  const state = parseLiveState(data);
  return (
    state && {
      ...state,
      presenting: parsePresenting(row?.presenting),
      // Never checked in: counted from the launch, as the database does.
      runnerSeenAt: ((row?.runner_seen_at ?? row?.launched_at) as string | null) ?? null,
      lastHandover: handover
        ? {
            toUser: handover.to_user as string,
            fromName: (handover.from_name as string) || "Someone",
            toName: (handover.to_name as string) || "Someone",
            kind: handover.kind === "took_over" ? "took_over" : "handed_over",
            at: handover.at as string,
          }
        : null,
    }
  );
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

/** Every vote not cast by the member themselves becomes For (0076); refused once anyone votes Against themselves. */
export async function recordAllInFavour(voteId: string): Promise<Ok | Fail> {
  if (!UUID.test(voteId)) return { ok: false, error: "That vote isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_all_in_favour", { p_vote_id: voteId });
  return error ? failFrom(error, "Couldn't record that. Try again.") : { ok: true };
}

/** Shows one of the agenda's attachments on everyone's screen, or stops (itemId and attId null). */
export async function showToEveryone(meetingId: string, itemId: string | null, attId: string | null): Promise<Ok<{ presenting: Presenting | null }> | Fail> {
  if (!UUID.test(meetingId) || (itemId !== null && (!itemId || itemId.length > 100)) || (attId !== null && (!attId || attId.length > 100))) {
    return { ok: false, error: "That attachment isn't available." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_meeting_presenting", { p_meeting_id: meetingId, p_item_id: itemId, p_att_id: attId });
  return error ? failFrom(error, "Couldn't show that. Try again.") : { ok: true, presenting: parsePresenting(data) };
}

/** The Runner's screen checks in every 20 seconds (0079). */
export async function runnerCheckIn(meetingId: string): Promise<void> {
  if (!UUID.test(meetingId)) return;
  const supabase = await createClient();
  await supabase.rpc("runner_check_in", { p_meeting_id: meetingId });
}

/** Hands the meeting to someone in it who can run meetings (0079). */
export async function handOverMeeting(meetingId: string, toUser: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId) || !UUID.test(toUser)) return { ok: false, error: "Choose who takes over." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("hand_over_meeting", { p_meeting_id: meetingId, p_to: toUser });
  if (error?.message.includes("can't run meetings")) return { ok: false, error: "That person can't run meetings." };
  return error ? failFrom(error, "Couldn't hand the meeting over. Try again.") : { ok: true };
}

/** Takes over a meeting whose Runner has lost connection for 2 minutes (0079). */
export async function takeOverMeeting(meetingId: string): Promise<Ok | Fail> {
  if (!UUID.test(meetingId)) return { ok: false, error: "That meeting isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("take_over_meeting", { p_meeting_id: meetingId });
  return error ? failFrom(error, "Couldn't take over the meeting. Try again.") : { ok: true };
}

/** What the video panel needs (0080): join details for Zoom, or why there's no video. */
export type VideoJoin =
  | { kind: "none" }
  | { kind: "demo" }
  | { kind: "message"; tone: "info" | "error"; message: string; canRestart?: boolean }
  | { kind: "waiting" }
  | {
      kind: "join";
      sdkKey: string;
      signature: string;
      meetingNumber: string;
      passcode: string;
      userName: string;
      customerKey: string;
      zak: string | null;
      host: boolean;
    };

/**
 * Join details for the meeting's Zoom video, for someone who may follow it.
 * The Runner's screen creates the Zoom meeting (on a free host licence) the
 * first time it asks, and joins as host; everyone else joins once it exists.
 * `restart` (Runner only) replaces a Zoom meeting that has ended, such as one
 * cut off by the free plan's 40 minutes.
 */
export async function getVideoJoin(meetingId: string, opts: { restart?: boolean } = {}): Promise<VideoJoin> {
  if (!UUID.test(meetingId)) return { kind: "none" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };
  const { data: m } = await supabase
    .from("meetings")
    .select("corporation_id, type, format, timezone, launched_by, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!m || m.format === "in_person" || !m.launched_by || m.status === "ADJOURNED") return { kind: "none" };
  // Demo visitors get tiles; a Super Admin's sandbox gets real Zoom, for testing off the live site.
  if (await demoRestricted()) return { kind: "demo" };
  // Only someone who may follow the meeting (council, manager, runners) gets past here.
  const live = await getLiveState(meetingId);
  if (!live) return { kind: "none" };

  const cfg = zoomConfig();
  if (!cfg) return { kind: "message", tone: "info", message: "Video isn't set up for StrataCouncil yet. The meeting works without it." };

  const isRunner = m.launched_by === user.id;
  const row = isRunner
    ? await ensureZoomMeeting(cfg, {
        meetingId,
        topic: IS_DEMO ? `Sandbox test meeting, ${m.corporation_id}` : `Council meeting, ${m.corporation_id}`,
        timezone: (m.timezone as string) || "America/Vancouver",
        restart: Boolean(opts.restart),
      })
    : await openZoomMeeting(meetingId).then((r) => (r ? ({ ok: true, row: r } as const) : null));
  if (!row) return { kind: "waiting" };
  if (!row.ok) return { kind: "message", tone: "error", message: row.error, canRestart: !row.busy };

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const zak = isRunner ? await zakFor(cfg, row.row.host_email) : null;
  if (isRunner && !zak) return { kind: "message", tone: "error", message: "Couldn't start the video as host. Try again; the meeting itself carries on.", canRestart: true };
  return {
    kind: "join",
    sdkKey: cfg.sdkKey,
    signature: meetingSdkSignature({ sdkKey: cfg.sdkKey, sdkSecret: cfg.sdkSecret, meetingNumber: row.row.zoom_meeting_id, role: isRunner ? 1 : 0 }),
    meetingNumber: row.row.zoom_meeting_id,
    passcode: row.row.passcode,
    userName: zoomDisplayName((profile?.full_name as string) ?? "", live.myLot),
    customerKey: user.id,
    zak,
    host: isRunner,
  };
}
