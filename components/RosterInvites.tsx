"use client";

import { useState, useTransition } from "react";
import { resendInvite, revokeInvite, sendInvite } from "@/app/strata/[corpId]/roster-actions";
import type { PendingInvite } from "@/lib/data/roster";
import { EMAIL_RE } from "@/lib/strata";

/**
 * Invite/revoke by email — how a council actually turns over: the
 * outgoing secretary leaves, the admin invites their replacement. The
 * admin-initiated path (`corporation_invites`), distinct from a self-serve
 * join request.
 *
 * The email carries a `generateLink()` sign-in link (roster-actions.ts):
 * one click signs the invitee in — creating their account if they don't
 * have one — and connects them. No approval step on the admin's end, no
 * separate signup form on theirs; a brand-new invitee gives their name in
 * one short step after the click (/welcome). Until then they show on the roster as
 * "Invited". Links expire, so pending invites can be re-sent.
 */
export function RosterInvites({
  corporationId,
  invites,
}: {
  corporationId: string;
  invites: PendingInvite[];
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendInvite(corporationId, trimmed);
      if (result.ok) {
        setEmail("");
        setNotice(result.notice ?? null);
      } else {
        setError(result.error);
      }
    });
  }

  function resend(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await resendInvite(corporationId, id);
      if (result.ok) setNotice(result.notice ?? null);
      else setError(result.error);
    });
  }

  function revoke(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await revokeInvite(corporationId, id);
      if (!result.ok) setError(result.error);
      setRevokingId(null);
    });
  }

  return (
    <div className="card roster-invites" id="invite" data-testid="roster-invites">
      <h3>Invite a member</h3>
      <p className="card__meta" style={{ marginTop: "-0.4rem" }}>
        They&rsquo;ll get an email with a link that signs them in &mdash;
        creating their StrataCouncil.ca account if they don&rsquo;t have one
        &mdash; and adds them to this strata in one click. No approval step
        needed on your end.
      </p>

      <form className="roster-invites__form" onSubmit={send}>
        <input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          data-testid="invite-email-input"
        />
        <button
          type="submit"
          className="button button-primary button-small"
          disabled={pending}
          data-testid="invite-send"
        >
          {pending ? "Working…" : "Send invite"}
        </button>
      </form>
      {error && (
        <p className="roster-invites__error" data-testid="invite-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="card__meta" data-testid="invite-notice">
          {notice}
        </p>
      )}

      {invites.length > 0 && (
        <ul className="roster-invites__list" data-testid="pending-invites">
          {invites.map((invite) => (
            <li key={invite.id}>
              <div>
                <span className="roster-invites__email">{invite.email}</span>
                <span className="card__meta">
                  Invited{invite.invitedByName && <> by {invite.invitedByName}</>} &middot;{" "}
                  {new Date(invite.createdAt).toLocaleDateString("en-CA")} &middot;{" "}
                  {new Date(invite.expiresAt).getTime() < Date.now() ? (
                    <strong>Expired, resend to renew</strong>
                  ) : (
                    <>Expires {new Date(invite.expiresAt).toLocaleDateString("en-CA")}</>
                  )}
                </span>
              </div>
              {revokingId === invite.id ? (
                <span className="roster-invites__confirm">
                  Revoke?
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setRevokingId(null)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-danger button-small"
                    onClick={() => revoke(invite.id)}
                    disabled={pending}
                    data-testid={`invite-revoke-confirm-${invite.id}`}
                  >
                    Confirm
                  </button>
                </span>
              ) : (
                <span className="roster-join-requests__actions">
                  <button
                    className="roster-invites__revoke"
                    onClick={() => resend(invite.id)}
                    disabled={pending}
                    data-testid={`invite-resend-${invite.id}`}
                  >
                    Resend
                  </button>
                  <button
                    className="roster-invites__revoke"
                    onClick={() => setRevokingId(invite.id)}
                    disabled={pending}
                    data-testid={`invite-revoke-${invite.id}`}
                  >
                    Revoke
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
