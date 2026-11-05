import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { AuthorPanel, CommentForm, VotePanel } from "@/components/discussions/DiscussionControls";
import { getDiscussion, type DiscussionFile } from "@/lib/data/discussions";
import { getStrataAccess } from "@/lib/data/strata";
import { majorityNote, RESULT_LABELS, STATUS_LABELS, tallyLine, VOTE_LABELS } from "@/lib/discussions/tally";

/**
 * One council discussion (0070): the motion and its background, the vote,
 * and the comments. Council only; a member who declared a conflict sees
 * the motion and their own vote, not the others' or the comments.
 */
const TZ = "America/Vancouver";
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" });

export default async function DiscussionPage({ params }: { params: Promise<{ corpId: string; discussionId: string }> }) {
  const { corpId, discussionId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access?.seesDiscussions) notFound();
  const d = await getDiscussion(corpId, discussionId);
  if (!d) notFound();

  const open = d.storedStatus === "open";
  const isAuthor = d.createdBy === access.userId;
  const anyVotes = d.voterList.some((v) => v.vote);
  const fileLink = (f: DiscussionFile) => (
    <a href={`/strata/${corpId}/discussions/${d.id}/files/${f.id}`} data-testid={`discussion-file-${f.id}`}>
      {f.fileName}
    </a>
  );

  return (
    <>
      <StrataSphereNav active="discussions" />
      <Link href={`/strata/${corpId}/discussions`} className="kb-article__back">
        &larr; Discussions
      </Link>
      <div className="doc-header">
        <div>
          <h2 data-testid="discussion-heading">
            {d.title}
            <span className="meeting-status discussion-status" data-tone={d.status} data-testid="discussion-status">
              {STATUS_LABELS[d.status]}
            </span>
          </h2>
          <p className="card__meta">
            Opened by {d.authorName || "a council member"} on {when(d.createdAt)}
            {d.closedAt ? ` · closed ${when(d.closedAt)}` : ""}
          </p>
        </div>
      </div>

      <div className="discussion-layout">
        <div>
          <section className="card discussion-motion" data-testid="discussion-motion">
            {d.motion ? (
              <>
                <p className="discussion-label">Motion</p>
                <p className="discussion-motion__text">{d.motion}</p>
              </>
            ) : (
              <p className="discussion-label" data-testid="discussion-no-vote">
                Council discussion &middot; no vote
              </p>
            )}
            {(
              [
                ["Background and rationale", d.background],
                ["Financial implications", d.financial],
                ["Risks and compliance", d.risks],
              ] as const
            ).map(([label, body]) =>
              body.trim() ? (
                <div key={label} className="discussion-section">
                  <p className="discussion-label">{label}</p>
                  <p className="discussion-body">{body}</p>
                </div>
              ) : null
            )}
            {d.files.length > 0 && (
              <div className="discussion-section">
                <p className="discussion-label">Attachments</p>
                <ul className="attachment-list">
                  {d.files.map((f) => (
                    <li key={f.id}>
                      <span className="pill">File</span> {fileLink(f)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {!d.recused && (
            <section className="discussion-comments" data-testid="discussion-comments">
              <h3>Comments</h3>
              {d.comments.length === 0 ? (
                <p className="card__meta">{open ? "No comments yet." : "No comments were posted."}</p>
              ) : (
                <ol className="discussion-comment-list">
                  {d.comments.map((c) => (
                    <li key={c.id} className="card">
                      <p className="discussion-comment__who">
                        <strong>{c.authorName || "Council member"}</strong> <span className="card__meta">{when(c.createdAt)}</span>
                      </p>
                      <p className="discussion-body">{c.body}</p>
                      {c.files.length > 0 && (
                        <ul className="attachment-list">
                          {c.files.map((f) => (
                            <li key={f.id}>
                              <span className="pill">File</span> {fileLink(f)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {open && <CommentForm corpId={corpId} discussionId={d.id} />}
              <p className="card__meta">Comments stay on this discussion. They aren&rsquo;t part of the vote record or the meeting agenda.</p>
            </section>
          )}
        </div>

        <aside className="discussion-side">
          {open && d.mine && <VotePanel corpId={corpId} discussionId={d.id} current={d.mine.vote} noVote={!d.voteRequired} />}
          {open && !d.mine && (
            <p className="card discussion-note">
              {access.isCouncil
                ? "You joined council after this discussion opened, so you can follow it but not vote."
                : "Only council members vote. You can follow the discussion and comment."}
            </p>
          )}

          {!d.voteRequired ? (
            <section className="card discussion-tally" data-testid="discussion-taking-part">
              <h3>Taking part</h3>
              <ul className="discussion-voters">
                {d.voterList.map((v, i) => (
                  <li key={v.userId ?? i} data-vote={v.vote === "recused" ? "recused" : "none"}>
                    <span>{v.name || "Council member"}</span>
                    <span>{v.vote === "recused" ? "Stepped out (conflict)" : ""}</span>
                  </li>
                ))}
              </ul>
              {!open && <p className="card__meta">This discussion had no vote, so nothing goes to a meeting.</p>}
            </section>
          ) : (
          <section className="card discussion-tally" data-testid="discussion-tally">
            <h3>{open ? "Votes so far" : "Result"}</h3>
            {d.recused ? (
              <p className="card__meta">
                You declared a conflict of interest{d.mine?.recusalReason ? `: “${d.mine.recusalReason}”` : ""}. The others&rsquo; votes
                aren&rsquo;t shown to you.
              </p>
            ) : (
              <>
                {!open && d.result && (
                  <p className="discussion-result" data-result={d.result} data-testid="discussion-result">
                    {RESULT_LABELS[d.result]}
                  </p>
                )}
                {d.tally && <p className="card__meta">{tallyLine(d.closedCounts ?? d.tally)}</p>}
                {open && d.tally && majorityNote(d.tally) && <p className="discussion-majority">{majorityNote(d.tally)}</p>}
                <ul className="discussion-voters">
                  {d.voterList.map((v, i) => (
                    <li key={v.userId ?? i} data-vote={v.vote ?? "none"}>
                      <span>{v.name || "Council member"}</span>
                      <span>{v.vote ? VOTE_LABELS[v.vote] : "Hasn’t voted"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!open && (
              <p className="card__meta" data-testid="discussion-next">
                {d.status === "awaiting_ratification" &&
                  (d.onAgendaOf
                    ? `On the agenda of the council meeting of ${day(d.onAgendaOf.date)} for ratification.`
                    : "Awaiting ratification. It will be offered for the agenda of the next council meeting.")}
                {d.status === "closed" && "The motion didn’t pass, so it doesn’t go to a meeting."}
                {d.status === "ratified" && d.ratifiedAt && `Ratified at a council meeting on ${when(d.ratifiedAt)}.`}
                {d.status === "not_ratified" && d.ratifiedAt && `Not ratified at a council meeting on ${when(d.ratifiedAt)}.`}
                {d.recordDocumentId && " The vote record is in Documents, under Meetings & Records."}
              </p>
            )}
          </section>
          )}

          {open && isAuthor && (
            <AuthorPanel
              corpId={corpId}
              discussionId={d.id}
              editable={!anyVotes}
              initial={{ title: d.title, background: d.background, financial: d.financial, risks: d.risks, motion: d.motion, voteRequired: d.voteRequired }}
              majority={d.tally && d.voteRequired ? majorityNote(d.tally) : null}
              noVote={!d.voteRequired}
            />
          )}
        </aside>
      </div>
    </>
  );
}
