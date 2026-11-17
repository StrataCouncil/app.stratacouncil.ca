import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { listDiscussions } from "@/lib/data/discussions";
import { getStrataAccess } from "@/lib/data/strata";
import { VOTE_LABELS } from "@/lib/discussions/tally";
import { DiscussionTable } from "@/components/discussions/DiscussionTable";
import { DiscussionsTabs } from "@/components/discussions/DiscussionsTabs";

/**
 * Discussions (0070): council votes between meetings. Council only. Each
 * stays here for good, open, closed, awaiting ratification, or ratified.
 * The first is free; more need a subscription.
 */
export default async function DiscussionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpId: string }>;
  searchParams: Promise<{ voted?: string }>;
}) {
  const { corpId } = await params;
  const { voted } = await searchParams;
  const access = await getStrataAccess(corpId);
  // A manager who isn't on council sees the tab for Directives (0097).
  if (!access?.seesDiscussions && access?.seesDirectives) redirect(`/strata/${corpId}/discussions/directives`);
  if (!access?.seesDiscussions) notFound();
  const discussions = await listDiscussions(corpId);

  return (
    <>
      <StrataSphereNav active="discussions" />
      <DiscussionsTabs corpId={corpId} active="discussions" seesDiscussions />
      <div className="doc-header">
        <div>
          <h2>Discussions</h2>
          <p className="card__meta">
            Council votes and conversations between meetings. A motion that passes goes to the next council meeting to be ratified. Only council and
            those who run meetings see these.
          </p>
        </div>
        {/* Started by those who run meetings (0093); council reads, comments, and votes. */}
        {access.canRunMeetings && (
          <Link href={`/strata/${corpId}/discussions/new`} className="button button-primary" data-testid="new-discussion">
            New discussion
          </Link>
        )}
      </div>

      {(() => {
        // Done, from a discussion: say the vote is recorded.
        const d = voted ? discussions.find((x) => x.id === voted) : null;
        return d?.myVote ? (
          <p className="agenda-lock" role="status" data-testid="discussion-voted">
            Your vote on &ldquo;{d.title}&rdquo; ({VOTE_LABELS[d.myVote]}) is recorded.
          </p>
        ) : null;
      })()}

      {discussions.length === 0 ? (
        <p className="card__meta" data-testid="discussions-empty">
          {access.canRunMeetings
            ? "No discussions yet. Start one when something needs council’s decision before the next meeting."
            : "No discussions yet. Whoever runs your meetings can start one when something needs council’s decision before the next meeting."}
        </p>
      ) : (
        <DiscussionTable corpId={corpId} discussions={discussions} />
      )}
    </>
  );
}
