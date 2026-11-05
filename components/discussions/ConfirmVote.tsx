"use client";

import { useState, useTransition } from "react";
import { castVote } from "@/app/strata/[corpId]/discussions/actions";

/** The one button on the email vote's confirm page (0081). */
export function ConfirmVote(props: { corpId: string; discussionId: string; choice: "for" | "against" | "abstain"; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Stays here when done: on a phone, the rest of Discussions needs a larger screen.
  if (done) {
    return (
      <p className="vote-confirm__done" role="status" data-testid="vote-confirm-done">
        Your vote is recorded: <strong>{props.label}</strong>. You can close this page.
      </p>
    );
  }
  return (
    <div className="vote-confirm__actions">
      <button
        type="button"
        className="button button-primary"
        disabled={pending}
        data-testid="vote-confirm-ok"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await castVote(props.corpId, props.discussionId, props.choice).catch(() => ({ ok: false as const, error: "Your vote didn't go through. Try again." }));
            if (!r.ok) return setError(r.error);
            setDone(true);
          })
        }
      >
        {pending ? "Recording…" : `Confirm: ${props.label}`}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
