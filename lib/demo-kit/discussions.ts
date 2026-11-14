import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscussionVote } from "@/lib/discussions/tally";
import { tally } from "@/lib/discussions/tally";

/**
 * The demo strata's sample Discussions (lib/demo-kit/build.ts): one closed
 * and waiting for ratification at the visitor's next council meeting, and
 * one open, waiting for the visitor's vote. Fictional, like the rest of the
 * kit; the visitor holds the president's seat (SL012).
 */

export interface DiscussionPerson {
  /** CAST key ("margaret" is the president's seat, the visitor's). */
  key: string;
  userId: string;
  name: string;
  lot: string;
}

interface SampleVote {
  key: string;
  vote: DiscussionVote | null;
  /** Hours before now. */
  hoursAgo?: number;
}

interface SampleDiscussion {
  title: string;
  motion: string;
  background: string;
  financial: string;
  risks: string;
  author: string;
  openedHoursAgo: number;
  closedHoursAgo: number | null;
  votes: SampleVote[];
  comments: Array<{ key: string; body: string; hoursAgo: number }>;
}

export const SAMPLE_DISCUSSIONS: SampleDiscussion[] = [
  {
    title: "Replace the lobby carpet",
    motion:
      "THAT council accept the quote from Fraser Valley Flooring for $6,400 plus GST to replace the carpet in the lobby and the main-floor corridor, funded from the operating fund.",
    background:
      "The lobby carpet is 14 years old. It's worn through at the entrance and stained near the elevator, and two owners have asked about it. The strata manager obtained three quotes: $6,400 (Fraser Valley Flooring), $7,150, and $8,900.",
    financial: "$6,400 plus GST, within this year's repairs and maintenance budget.",
    risks: "The lobby will be closed to furniture deliveries for one day during installation. Owners will be given a week's notice.",
    author: "tomasz",
    openedHoursAgo: 9 * 24,
    closedHoursAgo: 6 * 24,
    votes: [
      { key: "tomasz", vote: "for", hoursAgo: 9 * 24 - 1 },
      { key: "adaeze", vote: "for", hoursAgo: 8 * 24 - 3 },
      { key: "margaret", vote: "for", hoursAgo: 8 * 24 - 5 },
      { key: "liam", vote: "for", hoursAgo: 7 * 24 - 2 },
      { key: "ruth", vote: "against", hoursAgo: 7 * 24 - 6 },
    ],
    comments: [
      { key: "ruth", body: "I'd rather we waited until the roof work is finished, in case the trades track dirt through the lobby.", hoursAgo: 8 * 24 - 2 },
      { key: "adaeze", body: "The roofers use the parkade entrance, so the lobby shouldn't see much of them. The budget has room for this now.", hoursAgo: 8 * 24 - 1 },
    ],
  },
  {
    title: "Security camera for the bike room",
    motion:
      "THAT council approve the installation of one security camera in the bike room by Westshore Security for $2,850 plus GST, funded from the operating fund, subject to council adopting a video surveillance policy before the camera is turned on.",
    background:
      "Two e-bikes have been stolen from the bike room since the summer, and a third owner reported a cut lock. The door lock was rekeyed in September. The police file numbers are with the strata manager.",
    financial: "$2,850 plus GST for the camera and installation, from the operating fund. No monthly fee: footage is stored on site.",
    risks:
      "Privacy: under PIPA, council must have a written policy saying why the camera is there, who may view the footage, and how long it is kept, and must post signs at the bike room door. The camera must not view the door of any strata lot.",
    author: "tomasz",
    openedHoursAgo: 46,
    closedHoursAgo: null,
    votes: [
      { key: "tomasz", vote: "for", hoursAgo: 45 },
      { key: "adaeze", vote: "for", hoursAgo: 30 },
      { key: "ruth", vote: "against", hoursAgo: 20 },
      { key: "liam", vote: null },
      { key: "margaret", vote: null },
    ],
    comments: [
      { key: "ruth", body: "I'm not against a camera, but I'd like to see the policy first, before we spend the money.", hoursAgo: 20 },
      { key: "liam", body: "I'll draft the surveillance policy for the next meeting. There's a template in the Library.", hoursAgo: 6 },
    ],
  },
];

/** Puts the sample Discussions in a demo strata. Returns the closed one's id (filed as a vote record by the caller). */
export async function seedDiscussions(
  admin: SupabaseClient,
  corpId: string,
  people: DiscussionPerson[],
  now: Date
): Promise<string[]> {
  const who = new Map(people.map((p) => [p.key, p]));
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const closed: string[] = [];

  for (const s of SAMPLE_DISCUSSIONS) {
    const author = who.get(s.author)!;
    const t = s.closedHoursAgo !== null ? tally(s.votes.map((v) => v.vote)) : null;
    const { data: row, error } = await admin
      .from("discussions")
      .insert({
        corporation_id: corpId,
        title: s.title,
        motion: s.motion,
        background: s.background,
        financial: s.financial,
        risks: s.risks,
        vote_required: true,
        created_by: author.userId,
        author_name: author.name,
        created_at: ago(s.openedHoursAgo),
        updated_at: ago(s.closedHoursAgo ?? s.openedHoursAgo),
        ...(t
          ? {
              status: "closed",
              closed_at: ago(s.closedHoursAgo!),
              result: t.result,
              votes_for: t.for,
              votes_against: t.against,
              votes_abstain: t.abstain,
              votes_recused: t.recused,
              votes_missing: t.missing,
            }
          : {}),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(`Demo strata (discussion "${s.title}"): ${error?.message}`);

    const voters = s.votes.map((v) => {
      const p = who.get(v.key)!;
      return {
        discussion_id: row.id,
        user_id: p.userId,
        name: p.name,
        lot_number: p.lot,
        vote: v.vote,
        voted_at: v.vote ? ago(v.hoursAgo ?? s.openedHoursAgo) : null,
      };
    });
    const { error: vErr } = await admin.from("discussion_voters").insert(voters);
    if (vErr) throw new Error(`Demo strata (discussion voters): ${vErr.message}`);

    if (s.comments.length) {
      const { error: cErr } = await admin.from("discussion_comments").insert(
        s.comments.map((c) => {
          const p = who.get(c.key)!;
          return { discussion_id: row.id, user_id: p.userId, author_name: p.name, body: c.body, created_at: ago(c.hoursAgo) };
        })
      );
      if (cErr) throw new Error(`Demo strata (discussion comments): ${cErr.message}`);
    }
    if (t) closed.push(row.id);
  }
  return closed;
}
