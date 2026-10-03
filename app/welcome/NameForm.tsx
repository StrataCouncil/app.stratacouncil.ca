"use client";

import { useActionState } from "react";
import { Logo } from "@/components/Logo";
import { saveName, type SaveNameState } from "./actions";

const initialState: SaveNameState = { error: null };

export function NameForm({ next, email }: { next: string; email: string }) {
  const [state, formAction, pending] = useActionState(saveName, initialState);

  return (
    <div className="auth-shell">
      <form className="auth-card" action={formAction} data-testid="welcome-name-form">
        <div className="auth-card__brand">
          <Logo className="auth-card__mark" />
            <span className="auth-card__wordmark">StrataCouncil.ca</span>
        </div>
        <h1>What&rsquo;s your name?</h1>
        <p>
          You&rsquo;re signed in as <strong>{email}</strong>. Your name is how
          the rest of your council will see you, and it appears on any
          training certificates you earn.
        </p>
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="full_name">Full name</label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            autoFocus
            data-testid="welcome-name-input"
          />
        </div>
        {state.error && <p className="roster-invites__error">{state.error}</p>}
        <button type="submit" className="button button-primary" disabled={pending} data-testid="welcome-name-submit">
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
