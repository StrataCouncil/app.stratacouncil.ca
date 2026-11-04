import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DiscussionsLock } from "@/components/discussions/DiscussionsLock";
import { listDiscussions } from "@/lib/data/discussions";
import { getStrataAccess } from "@/lib/data/strata";
import { STATUS_LABELS, VOTE_LABELS } from "@/lib/discussions/tally";

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
  if (!access?.seesDiscussions) notFound();
  const discussions = await listDiscussions(corpId);
  const locked = !access.subscribed && discussions.length > 0;
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric" });

  return (
    <>
      <StrataSphereNav active="discussions" />
      <div className="doc-header">
        <div>
          <h2>Discussions</h2>
          <p className="card__meta">
            Council votes between meetings. A motion that passes goes to the next council meeting to be ratified. Only council and
            those who run meetings see these.
          </p>
        </div>
        {!locked && (
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
      {locked && <DiscussionsLock corpId={corpId} pending={access.pending} canBill={access.canBill} />}

      {discussions.length === 0 ? (
        <p className="card__meta" data-testid="discussions-empty">
          No discussions yet. Start one when something needs council&rsquo;s decision before the next meeting. Your first one is free.
        </p>
      ) : (
        <div className="module-list" data-testid="discussions-list">
          {discussions.map((d) => (
            <div className="module-row" key={d.id} data-testid={`discussion-${d.id}`}>
              <div>
                <div className="module-row__title">
                  <Link href={`/strata/${corpId}/discussions/${d.id}`}>{d.title}</Link>
                  <span className="meeting-status discussion-status" data-tone={d.status} data-testid={`discussion-status-${d.id}`}>
                    {STATUS_LABELS[d.status]}
                  </span>
                </div>
                <div className="module-row__meta">
                  Opened by {d.authorName || "a council member"} on {date(d.createdAt)}
                  {d.status === "open" ? ` · ${d.voted} of ${d.voters} voted` : d.closedAt ? ` · closed ${date(d.closedAt)}` : ""}
                  {d.ratifiedAt ? ` · ${d.status === "ratified" ? "ratified" : "not ratified"} ${date(d.ratifiedAt)}` : ""}
                </div>
                {d.myVote !== undefined && (
                  <div className="discussion-myvote" data-vote={d.myVote ?? "none"} data-testid={`discussion-myvote-${d.id}`}>
                    {d.myVote ? `Your vote: ${VOTE_LABELS[d.myVote]}` : d.status === "open" ? "You haven't voted yet" : "You didn't vote"}
                  </div>
                )}
              </div>
              <div className="meeting-row__actions">
                <Link href={`/strata/${corpId}/discussions/${d.id}`} className={`button button-small ${d.status === "open" ? "button-primary" : "button-secondary"}`}>
                  {d.status === "open" ? "Open" : "View"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
