"use client";

import { useState } from "react";
import type { CorporationJoinRequest } from "@/lib/placeholder-data";

const APPROVE_CONFIRM_PHRASE = "approve request";

/**
 * Requests to join, self-serve (doc01 §1's `corporation_join_requests`)
 * — the other connection path, alongside `RosterInvites`. Someone who
 * already knows this strata's SP# asked to connect; the admin didn't
 * choose them, so approving isn't a single click the way accepting an
 * admin-sent invite is.
 *
 * Deny is a lightweight inline confirm (same Cancel/Confirm pattern
 * `RosterInvites` uses for Revoke) — low stakes, easily undone by the
 * person just asking again. Approve is the opposite: it's the one action
 * in this whole roster surface that grants a stranger standing access,
 * so it gets the heaviest confirmation in the app — an explicit warning
 * plus a typed phrase, not just a second click, so it can't happen by
 * reflex.
 *
 * Admin-only in a real build (see the doc comment on
 * `corporationJoinRequests`); this mock's single persona is always
 * admin, so there's no hidden-for-everyone-else state to demo here.
 *
 * `onApprove` hands the approved request up to `CouncilRoster`, which
 * owns the shared `roster` array — approval needs to actually land the
 * person in the table below, not just vanish from this list.
 */
export function RosterJoinRequests({
  initialRequests,
  onApprove,
}: {
  initialRequests: CorporationJoinRequest[];
  onApprove: (request: CorporationJoinRequest) => void;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveConfirmText, setApproveConfirmText] = useState("");
  const [denyingId, setDenyingId] = useState<string | null>(null);

  if (requests.length === 0) return null;

  function startApproving(id: string) {
    setDenyingId(null);
    setApprovingId(id);
    setApproveConfirmText("");
  }

  function cancelApproving() {
    setApprovingId(null);
    setApproveConfirmText("");
  }

  function approve(request: CorporationJoinRequest) {
    onApprove(request);
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    setApprovingId(null);
    setApproveConfirmText("");
  }

  function deny(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setDenyingId(null);
  }

  return (
    <div className="card roster-join-requests" data-testid="roster-join-requests">
      <h3>Requests to join</h3>
      <p className="card__meta" style={{ marginTop: "-0.4rem" }}>
        Submitted by someone who already knows this strata&rsquo;s plan
        number and asked to connect &mdash; visible only to admins.
      </p>

      <ul className="roster-join-requests__list" data-testid="pending-join-requests">
        {requests.map((request) => (
          <li key={request.id}>
            <div className="roster-join-requests__row">
              <div>
                <span className="roster-invites__email">{request.requesterName}</span>
                <span className="card__meta">
                  {request.requesterEmail} &middot; Requested {request.requestedAt}
                </span>
              </div>

              {denyingId === request.id ? (
                <span className="roster-invites__confirm">
                  Deny this request?
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setDenyingId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => deny(request.id)}
                    data-testid={`join-request-deny-confirm-${request.id}`}
                  >
                    Confirm
                  </button>
                </span>
              ) : (
                <span className="roster-join-requests__actions">
                  <button
                    className="roster-invites__revoke"
                    onClick={() => setDenyingId(request.id)}
                    data-testid={`join-request-deny-${request.id}`}
                  >
                    Deny
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => startApproving(request.id)}
                    data-testid={`join-request-approve-${request.id}`}
                  >
                    Approve
                  </button>
                </span>
              )}
            </div>

            {approvingId === request.id && (
              <div
                className="role-editor confirm-panel roster-join-requests__approve-panel"
                data-testid={`join-request-approve-panel-${request.id}`}
              >
                <div className="roster-join-requests__warning">
                  <strong>Only approve requests from people you know</strong>
                  <p>
                    Approving connects {request.requesterName} to this
                    strata immediately &mdash; they&rsquo;ll appear on the
                    council roster and, once they complete training,
                    their progress becomes visible to everyone else
                    connected here too.
                  </p>
                </div>
                <label className="confirm-panel__label">
                  Type &ldquo;{APPROVE_CONFIRM_PHRASE}&rdquo; to confirm
                </label>
                <input
                  type="text"
                  className="confirm-panel__input"
                  value={approveConfirmText}
                  onChange={(e) => setApproveConfirmText(e.target.value)}
                  placeholder={APPROVE_CONFIRM_PHRASE}
                  data-testid={`join-request-approve-input-${request.id}`}
                  autoComplete="off"
                />
                <div className="role-editor__actions">
                  <button
                    className="button button-secondary button-small"
                    onClick={cancelApproving}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => approve(request)}
                    disabled={
                      approveConfirmText.trim().toLowerCase() !==
                      APPROVE_CONFIRM_PHRASE
                    }
                    data-testid={`join-request-approve-button-${request.id}`}
                  >
                    Approve request
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
