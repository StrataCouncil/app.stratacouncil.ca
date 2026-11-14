import type { SupabaseClient } from "@supabase/supabase-js";
import { IS_DEMO } from "@/lib/demo";
import { demoRestricted } from "@/lib/demo-sandbox";
import { after } from "next/server";
import { AGAINST_COMMENTS, randomChoice } from "@/lib/demo-kit/council-votes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The demo's fictional council takes part, straight away: when a visitor
 * opens a Discussion, the fictional members vote on it within seconds; when
 * they launch a meeting, the members (and the manager) arrive; when they
 * open a vote, the members present vote, a moment apart. Votes are random
 * (mostly For), as a real council's would be. It runs just after the
 * visitor's action has answered (next/server after()), so it never slows
 * the action down, and every step re-checks the current state, so a vote
 * the visitor has already closed is left alone.
 *
 * Only on the demo site, and never in a Super Admin's sandbox, where real
 * people play the council. Server only.
 */

export type DemoCouncilEvent = "discussionOpened" | "meetingLaunched" | "voteOpened";

/** Sets the fictional council going; never fails or slows the visitor's action. */
export async function nudgeDemoCouncil(kind: DemoCouncilEvent, data: Record<string, string>): Promise<void> {
  if (!IS_DEMO || !(await demoRestricted())) return;
  after(async () => {
    try {
      if (kind === "discussionOpened") await discussionVotes(data.discussionId);
      else if (kind === "meetingLaunched") await meetingArrivals(data.meetingId);
      else await meetingBallots(data.voteId);
    } catch (err) {
      console.error("[demo council]", kind, err instanceof Error ? err.message : err);
    }
  });
}

const pause = (minMs: number, maxMs: number) => new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
const shuffled = <T,>(list: T[]) => [...list].sort(() => Math.random() - 0.5);

/** A Discussion opened: each fictional member votes, a second or two apart. */
async function discussionVotes(discussionId: string) {
  const admin = createAdminClient();
  const { data: d } = await admin.from("discussions").select("corporation_id, vote_required, status").eq("id", discussionId).maybeSingle();
  if (!d || d.status !== "open" || !d.vote_required) return;
  const council = await fictionalCouncil(admin, d.corporation_id as string);
  const { data: voters } = await admin.from("discussion_voters").select("user_id, vote").eq("discussion_id", discussionId);
  const waiting = new Set((voters ?? []).filter((v) => v.vote === null).map((v) => v.user_id as string));
  let commented = false;
  for (const m of shuffled(council.filter((c) => waiting.has(c.userId)))) {
    await pause(900, 2200);
    const { data: now } = await admin.from("discussions").select("status").eq("id", discussionId).maybeSingle();
    if (now?.status !== "open") return;
    const choice = randomChoice();
    await admin
      .from("discussion_voters")
      .update({ vote: choice, voted_at: new Date().toISOString() })
      .eq("discussion_id", discussionId)
      .eq("user_id", m.userId)
      .is("vote", null);
    // The first to vote against sometimes says why.
    if (choice === "against" && !commented) {
      commented = true;
      if (Math.random() < 0.6) {
        await admin.from("discussion_comments").insert({
          discussion_id: discussionId,
          user_id: m.userId,
          author_name: m.name,
          body: AGAINST_COMMENTS[Math.floor(Math.random() * AGAINST_COMMENTS.length)],
        });
      }
    }
  }
}

/** A meeting launched: the fictional members, and the manager, arrive a moment apart. */
async function meetingArrivals(meetingId: string) {
  const admin = createAdminClient();
  const { data: m } = await admin.from("meetings").select("corporation_id").eq("id", meetingId).maybeSingle();
  if (!m) return;
  const council = await fictionalCouncil(admin, m.corporation_id as string);
  const manager = await fictionalManager(admin, m.corporation_id as string);
  const people: Array<{ userId: string; lot: string | null }> = [...council, ...(manager ? [{ userId: manager, lot: null }] : [])];
  for (const p of shuffled(people)) {
    await pause(300, 900);
    const { error } = await admin.rpc("demo_council_join", { p_meeting_id: meetingId, p_user_id: p.userId, p_lot: p.lot });
    if (error) console.error("[demo council] join", error.message);
  }
}

/** A vote opened in Meeting Mode: each fictional member present votes, a moment apart. */
async function meetingBallots(voteId: string) {
  const admin = createAdminClient();
  const { data: v } = await admin.from("meeting_votes").select("meeting_id, eligible_lots, status").eq("id", voteId).maybeSingle();
  if (!v || v.status !== "open") return;
  const { data: m } = await admin.from("meetings").select("corporation_id").eq("id", v.meeting_id as string).maybeSingle();
  if (!m) return;
  const eligible = new Set((v.eligible_lots as string[]) ?? []);
  const council = await fictionalCouncil(admin, m.corporation_id as string);
  for (const c of shuffled(council.filter((x) => eligible.has(x.lot)))) {
    await pause(400, 1200);
    const { error } = await admin.rpc("demo_council_ballot", { p_vote_id: voteId, p_user_id: c.userId, p_lot: c.lot, p_choice: randomChoice() });
    if (error) console.error("[demo council] ballot", error.message);
  }
}

export interface FictionalMember {
  userId: string;
  lot: string;
  name: string;
}

const COUNCIL_ROLES = ["president", "vice_president", "treasurer", "secretary", "member_at_large"];

/** The strata's fictional council members (demo_cast accounts with a council role and a lot). */
export async function fictionalCouncil(admin: SupabaseClient, corpId: string): Promise<FictionalMember[]> {
  const [{ data: members }, { data: roles }, { data: cast }] = await Promise.all([
    admin.from("corporation_memberships").select("user_id, lot_number").eq("corporation_id", corpId).eq("status", "active").not("lot_number", "is", null),
    admin.from("corporation_role_assignments").select("user_id, role").eq("corporation_id", corpId).in("role", COUNCIL_ROLES),
    admin.from("demo_cast").select("user_id"),
  ]);
  const onCouncil = new Set((roles ?? []).map((r) => r.user_id as string));
  const fictional = new Set((cast ?? []).map((c) => c.user_id as string));
  const list = (members ?? []).filter((m) => onCouncil.has(m.user_id as string) && fictional.has(m.user_id as string));
  if (!list.length) return [];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", list.map((m) => m.user_id as string));
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? ""]));
  return list.map((m) => ({ userId: m.user_id as string, lot: m.lot_number as string, name: names.get(m.user_id as string) ?? "" }));
}

/** The strata's fictional manager, if they're on it (they join meetings, but don't vote). */
export async function fictionalManager(admin: SupabaseClient, corpId: string): Promise<string | null> {
  const [{ data: roles }, { data: cast }] = await Promise.all([
    admin.from("corporation_role_assignments").select("user_id").eq("corporation_id", corpId).eq("role", "manager"),
    admin.from("demo_cast").select("user_id"),
  ]);
  const fictional = new Set((cast ?? []).map((c) => c.user_id as string));
  return (roles ?? []).map((r) => r.user_id as string).find((id) => fictional.has(id)) ?? null;
}
