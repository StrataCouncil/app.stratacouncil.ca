"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addComment, castVote, closeDiscussion, type DiscussionInput } from "@/app/strata/[corpId]/discussions/actions";
import { DiscussionForm } from "@/components/discussions/DiscussionForm";
import { uploadDiscussionFiles } from "@/components/discussions/upload";
import type { DiscussionVote } from "@/lib/discussions/tally";
import { ChoiceIcon } from "@/components/meetings/LiveVote";
import Link from "next/link";

/** Your vote: For, Against, Abstain, or a declared conflict of interest (s. 32), which needs a reason. */
export function VotePanel({ corpId, discussionId, current }: { corpId: string; discussionId: string; current: DiscussionVote | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState<DiscussionVote | null>(current);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (vote: DiscussionVote) =>
    start(async () => {
      setError(null);
      const r = await castVote(corpId, discussionId, vote, vote === "recused" ? reason : undefined);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <section className="card discussion-vote" data-testid="discussion-vote">
      <h3>Your vote</h3>
      <div className="discussion-vote__choices" role="group" aria-label="Your vote">
        {(["for", "against", "abstain"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="discussion-vote__choice"
            data-choice={v}
            data-selected={current === v || undefined}
            aria-pressed={current === v}
            disabled={pending}
            onClick={() => {
              setChoice(v);
              send(v);
            }}
            data-testid={`vote-${v}`}
          >
            <ChoiceIcon choice={v} />
            {v === "for" ? "For" : v === "against" ? "Against" : "Abstain"}
          </button>
        ))}
        <button
          type="button"
          className={`button ${choice === "recused" ? "button-primary" : "button-secondary"}`}
          aria-pressed={current === "recused"}
          disabled={pending}
          onClick={() => setChoice("recused")}
          data-testid="vote-recused"
        >
          I have a conflict of interest
        </button>
      </div>
      {choice === "recused" && current !== "recused" && (
        <div className="discussion-vote__recuse">
          <label className="field field--wide">
            <span>What is the conflict?</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="My company quoted on this work." data-testid="recusal-reason" />
            <span className="field__hint">
              The Strata Property Act (s. 32) asks you to disclose it and not vote. You won&rsquo;t see the others&rsquo; votes or the
              comments on this discussion after that. The reason goes in the vote record.
            </span>
          </label>
          <button type="button" className="button button-primary" disabled={pending || !reason.trim()} onClick={() => send("recused")} data-testid="recusal-submit">
            Declare and step out
          </button>
        </div>
      )}
      {current && current !== "recused" && (
        <>
          <p className="card__meta">
            Your vote ({current === "for" ? "For" : current === "against" ? "Against" : "Abstain"}) is recorded. You can change it until the discussion is closed.
          </p>
          <Link href={`/strata/${corpId}/discussions?voted=${discussionId}`} className="button button-primary discussion-vote__done" data-testid="discussion-done">
            Done
          </Link>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The author's tools: change the motion (until the first vote) and close the vote. */
export function AuthorPanel({
  corpId,
  discussionId,
  editable,
  initial,
  majority,
}: {
  corpId: string;
  discussionId: string;
  editable: boolean;
  initial: DiscussionInput;
  majority: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <section className="card">
        <h3 style={{ marginBottom: "0.75rem" }}>Change the discussion</h3>
        <DiscussionForm corpId={corpId} discussionId={discussionId} initial={initial} onDone={() => setEditing(false)} />
      </section>
    );
  }
  return (
    <section className="card discussion-author" data-testid="discussion-author">
      <h3>You started this discussion</h3>
      <p className="card__meta">
        {majority ?? "No majority yet."} Close the vote when council has decided. Council is emailed, and the vote record is filed in
        Meetings &amp; Records.
      </p>
      <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
        {editable && (
          <button type="button" className="button button-secondary" onClick={() => setEditing(true)} data-testid="discussion-edit">
            Change the motion
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await closeDiscussion(corpId, discussionId);
                  if (!r.ok) return setError(r.error);
                  setConfirming(false);
                  router.refresh();
                })
              }
              data-testid="discussion-close-confirm"
            >
              {pending ? "Closing…" : "Yes, close the vote"}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep it open
            </button>
          </>
        ) : (
          <button type="button" className="button button-primary" onClick={() => setConfirming(true)} data-testid="discussion-close">
            Close the vote
          </button>
        )}
      </div>
      {confirming && <p className="card__meta">Nobody can vote or comment once it&rsquo;s closed.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Add a comment, with files. Comments stay on the discussion; they aren't part of the record or the agenda. */
export function CommentForm({ corpId, discussionId }: { corpId: string; discussionId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="discussion-comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addComment(corpId, discussionId, body);
          if (!r.ok) return setError(r.error);
          const failed = await uploadDiscussionFiles(corpId, discussionId, r.commentId, files);
          if (failed) setError(`Your comment is posted, but an attachment didn't make it: ${failed}`);
          setBody("");
          setFiles([]);
          setInputKey((k) => k + 1);
          router.refresh();
        });
      }}
      data-testid="discussion-comment-form"
    >
      <label className="field field--wide">
        <span>Add a comment</span>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required data-testid="discussion-comment" />
      </label>
      <div className="discussion-comment-form__row">
        <input key={inputKey} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} aria-label="Attach files to your comment" />
        <button type="submit" className="button button-primary" disabled={pending || !body.trim()} data-testid="discussion-comment-submit">
          {pending ? "Posting…" : "Post comment"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
