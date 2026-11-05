import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStrataAccess } from "@/lib/data/strata";
import { getDiscussion } from "@/lib/data/discussions";
import { VOTE_LABELS, type DiscussionVote } from "@/lib/discussions/tally";
import { ConfirmVote } from "@/components/discussions/ConfirmVote";

export const metadata = { title: "Confirm your vote" };

const CHOICES = ["for", "against", "abstain"] as const;
const CHOICE_LABELS: Record<(typeof CHOICES)[number], string> = { for: "In favour", against: "Against", abstain: "Abstain" };

/**
 * Where an email's vote button lands (0081): the motion and the choice,
 * and Confirm. Behind sign-in like every page (the middleware brings the
 * person back here after signing in), so a vote is always the signed-in
 * person's own, and a link opened by an email scanner never votes. Works
 * on phones (components/ScreenGate.tsx).
 */
export default async function ConfirmVotePage({
  params,
  searchParams,
}: {
  params: Promise<{ corpId: string; discussionId: string }>;
  searchParams: Promise<{ choice?: string }>;
}) {
  const { corpId, discussionId } = await params;
  const { choice } = await searchParams;
  const access = await getStrataAccess(corpId);
  if (!access?.seesDiscussions) notFound();
  const d = await getDiscussion(corpId, discussionId);
  if (!d) notFound();
  const back = `/strata/${corpId}/discussions/${d.id}`;
  if (!CHOICES.includes(choice as (typeof CHOICES)[number])) redirect(back);
  const pick = choice as (typeof CHOICES)[number];

  const blocked =
    d.storedStatus !== "open"
      ? "This vote has closed, so it can't take new votes."
      : !d.voteRequired
        ? "This discussion has no vote."
        : !d.mine
          ? "You weren't on council when this discussion opened, so you can't vote on it."
          : d.recused
            ? "You declared a conflict of interest on this motion, so you don't vote on it."
            : null;
  const current = d.mine?.vote && d.mine.vote !== "recused" ? (d.mine.vote as Exclude<DiscussionVote, "recused">) : null;

  return (
    <div className="vote-confirm" data-testid="vote-confirm">
      <p className="eyebrow">Council discussion</p>
      <h2>{d.title}</h2>
      {d.motion && (
        <div className="vote-confirm__motion">
          <span className="card__meta">Motion</span>
          <p>{d.motion}</p>
        </div>
      )}
      {blocked ? (
        <>
          <p className="form-alert" role="status" data-testid="vote-confirm-blocked">
            {blocked}
          </p>
          <Link href={back} className="button button-secondary">
            Open the discussion
          </Link>
        </>
      ) : (
        <>
          <p className="vote-confirm__choice">
            Your vote: <strong data-vote={pick}>{CHOICE_LABELS[pick]}</strong>
          </p>
          {current === pick ? (
            <p className="card__meta">You&rsquo;ve already voted {CHOICE_LABELS[pick]}. Nothing changes if you confirm.</p>
          ) : current ? (
            <p className="card__meta">
              This changes your vote from {VOTE_LABELS[current]} to {CHOICE_LABELS[pick]}. You can change it again until the vote closes.
            </p>
          ) : (
            <p className="card__meta">You can change your vote until the vote closes.</p>
          )}
          <ConfirmVote corpId={corpId} discussionId={d.id} choice={pick} label={CHOICE_LABELS[pick]} />
          <p className="card__meta">
            <Link href={back}>Open the discussion</Link> to read the background and comments, choose differently, or declare a conflict of
            interest.
          </p>
        </>
      )}
    </div>
  );
}
