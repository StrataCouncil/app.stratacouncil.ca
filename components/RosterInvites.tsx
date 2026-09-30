"use client";

import { useState } from "react";
import type { CorporationInvite } from "@/lib/placeholder-data";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite/revoke, by email — how a council actually turns over: the
 * outgoing secretary leaves, the admin invites their replacement. This
 * is the admin-initiated path (doc01 §1's `corporation_invites`),
 * distinct from a self-serve join request, which needs admin approval
 * on the way *in* rather than the admin having sent it.
 *
 * Client-side state only, same honesty as `RosterTable`'s role editor —
 * there's no second account in this demo to actually accept an invite,
 * so a sent invite just sits here as "Pending" until revoked. Real
 * acceptance would move the person into the roster below with no
 * separate admin action needed.
 */
export function RosterInvites({ initialInvites }: { initialInvites: CorporationInvite[] }) {
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    if (invites.some((i) => i.email.toLowerCase() === trimmed.toLowerCase())) {
      setError("Already invited.");
      return;
    }
    setInvites((prev) => [
      ...prev,
      {
        id: `inv-${Date.now()}`,
        email: trimmed,
        invitedByName: "You",
        invitedAt: "Just now",
      },
    ]);
    setEmail("");
    setError(null);
  }

  function revokeInvite(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    setRevokingId(null);
  }

  return (
    <div className="card roster-invites" data-testid="roster-invites">
      <h3>Invite a member</h3>
      <p className="card__meta" style={{ marginTop: "-0.4rem" }}>
        They&rsquo;ll be prompted to create a StrataCouncil.ca account (or
        sign in, if they already have one) and are added to this strata
        the moment they accept &mdash; no approval step needed on your end.
      </p>

      <form className="roster-invites__form" onSubmit={sendInvite}>
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
        <button type="submit" className="button button-primary button-small" data-testid="invite-send">
          Send invite
        </button>
      </form>
      {error && (
        <p className="roster-invites__error" data-testid="invite-error">
          {error}
        </p>
      )}

      {invites.length > 0 && (
        <ul className="roster-invites__list" data-testid="pending-invites">
          {invites.map((invite) => (
            <li key={invite.id}>
              <div>
                <span className="roster-invites__email">{invite.email}</span>
                <span className="card__meta">
                  Invited by {invite.invitedByName} &middot; {invite.invitedAt}
                </span>
              </div>
              {revokingId === invite.id ? (
                <span className="roster-invites__confirm">
                  Revoke?
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setRevokingId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => revokeInvite(invite.id)}
                    data-testid={`invite-revoke-confirm-${invite.id}`}
                  >
                    Confirm
                  </button>
                </span>
              ) : (
                <button
                  className="roster-invites__revoke"
                  onClick={() => setRevokingId(invite.id)}
                  data-testid={`invite-revoke-${invite.id}`}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
