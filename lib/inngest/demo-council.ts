import { inngest, DEMO_COUNCIL_EVENTS } from "@/lib/inngest/client";
import { fictionalCouncil, fictionalManager } from "@/lib/demo-council";
import { AGAINST_COMMENTS, randomChoice, randomSeconds } from "@/lib/demo-kit/council-votes";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The demo's fictional council (lib/demo-council.ts): background jobs that
 * vote, arrive, and vote again, a little apart, as people would. Each step
 * checks the current state first, so a vote the visitor has already closed,
 * or a meeting they've adjourned, is left alone.
 */

/** A Discussion opened: each fictional member votes over the next minute or two. */
export const demoDiscussionVotes = inngest.createFunction(
  { id: "demo-council-discussion-votes", triggers: [{ event: DEMO_COUNCIL_EVENTS.discussionOpened }] },
  async ({ event, step }) => {
    const discussionId = String(event.data?.discussionId ?? "");
    const plan = await step.run("plan", async () => {
      const admin = createAdminClient();
      const { data: d } = await admin.from("discussions").select("corporation_id, vote_required, status").eq("id", discussionId).maybeSingle();
      if (!d || d.status !== "open" || !d.vote_required) return [];
      const council = await fictionalCouncil(admin, d.corporation_id as string);
      const { data: voters } = await admin.from("discussion_voters").select("user_id, vote").eq("discussion_id", discussionId);
      const waiting = new Set((voters ?? []).filter((v) => v.vote === null).map((v) => v.user_id as string));
      // In a random order, each a little after the last.
      return council
        .filter((m) => waiting.has(m.userId))
        .sort(() => Math.random() - 0.5)
        .map((m) => ({ ...m, wait: randomSeconds(12, 45), choice: randomChoice() }));
    });

    let commented = false;
    for (const [i, m] of plan.entries()) {
      await step.sleep(`wait-${i}`, `${m.wait}s`);
      await step.run(`vote-${i}`, async () => {
        const admin = createAdminClient();
        const { data: d } = await admin.from("discussions").select("status").eq("id", discussionId).maybeSingle();
        if (d?.status !== "open") return;
        await admin
          .from("discussion_voters")
          .update({ vote: m.choice, voted_at: new Date().toISOString() })
          .eq("discussion_id", discussionId)
          .eq("user_id", m.userId)
          .is("vote", null);
        // The first to vote against sometimes says why.
        if (m.choice === "against" && !commented && Math.random() < 0.6) {
          await admin.from("discussion_comments").insert({
            discussion_id: discussionId,
            user_id: m.userId,
            author_name: m.name,
            body: AGAINST_COMMENTS[Math.floor(Math.random() * AGAINST_COMMENTS.length)],
          });
        }
      });
      if (m.choice === "against") commented = true;
    }
    return { votes: plan.length };
  }
);

/** A meeting launched: the fictional members, and the manager, arrive over the next few seconds. */
export const demoMeetingArrivals = inngest.createFunction(
  { id: "demo-council-meeting-arrivals", triggers: [{ event: DEMO_COUNCIL_EVENTS.meetingLaunched }] },
  async ({ event, step }) => {
    const meetingId = String(event.data?.meetingId ?? "");
    const plan = await step.run("plan", async () => {
      const admin = createAdminClient();
      const { data: m } = await admin.from("meetings").select("corporation_id").eq("id", meetingId).maybeSingle();
      if (!m) return [];
      const council = await fictionalCouncil(admin, m.corporation_id as string);
      const manager = await fictionalManager(admin, m.corporation_id as string);
      const people: Array<{ userId: string; lot: string | null }> = [...council, ...(manager ? [{ userId: manager, lot: null }] : [])];
      return people.sort(() => Math.random() - 0.5).map((c) => ({ userId: c.userId, lot: c.lot, wait: randomSeconds(2, 7) }));
    });
    for (const [i, c] of plan.entries()) {
      await step.sleep(`wait-${i}`, `${c.wait}s`);
      await step.run(`arrive-${i}`, async () => {
        const { error } = await createAdminClient().rpc("demo_council_join", { p_meeting_id: meetingId, p_user_id: c.userId, p_lot: c.lot });
        if (error) console.error("[demoMeetingArrivals]", error.message);
      });
    }
    return { arrived: plan.length };
  }
);

/** A vote opened in Meeting Mode: each fictional member present votes, a few seconds apart. */
export const demoMeetingBallots = inngest.createFunction(
  { id: "demo-council-meeting-ballots", triggers: [{ event: DEMO_COUNCIL_EVENTS.voteOpened }] },
  async ({ event, step }) => {
    const voteId = String(event.data?.voteId ?? "");
    const plan = await step.run("plan", async () => {
      const admin = createAdminClient();
      const { data: v } = await admin.from("meeting_votes").select("meeting_id, eligible_lots, status").eq("id", voteId).maybeSingle();
      if (!v || v.status !== "open") return [];
      const { data: m } = await admin.from("meetings").select("corporation_id").eq("id", v.meeting_id as string).maybeSingle();
      if (!m) return [];
      const eligible = new Set((v.eligible_lots as string[]) ?? []);
      const council = await fictionalCouncil(admin, m.corporation_id as string);
      return council
        .filter((c) => eligible.has(c.lot))
        .sort(() => Math.random() - 0.5)
        .map((c) => ({ ...c, wait: randomSeconds(2, 6), choice: randomChoice() }));
    });
    for (const [i, c] of plan.entries()) {
      await step.sleep(`wait-${i}`, `${c.wait}s`);
      await step.run(`ballot-${i}`, async () => {
        const { error } = await createAdminClient().rpc("demo_council_ballot", { p_vote_id: voteId, p_user_id: c.userId, p_lot: c.lot, p_choice: c.choice });
        if (error) console.error("[demoMeetingBallots]", error.message);
      });
    }
    return { ballots: plan.length };
  }
);
