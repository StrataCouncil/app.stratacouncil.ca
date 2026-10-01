"use client";

import { useState, useTransition } from "react";
import { resolveJoinRequest } from "@/app/strata/[corpId]/roster-actions";
import type { PendingJoinRequest } from "@/lib/data/roster";

const APPROVE_CONFIRM_PHRASE = "approve request";

/**
 * Requests to join, self-serve (`corporation_join_requests`) — the other
 * connection path, alongside `RosterInvites`. Someone who already knows
 * this strata's SP# asked to connect from /strata; the admin didn't choose
 * them, so approving isn't a single click the way accepting an admin-sent
 * invite is.
 *
 * Deny is a lightweight inline confirm — low stakes, easily undone by the
 * person just asking again. Approve grants a stranger standing access, so
 * it gets the heaviest confirmation in the app: an explicit warning plus a
 * typed phrase, so it can't happen by reflex.
 *
 * Both go through `resolve_corporation_join_request()` (0010), which RLS
 * gates on the caller holding the admin role.
 */
export function RosterJoinRequests({
  corporationId,
  requests,
}: {
  corporationId: string;
  requests: PendingJoinRequest[];
}) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveConfirmText, setApproveConfirmText] = useState("");
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function resolve(id: string, approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await resolveJoinRequest(corporationId, id, approve);
      if (!result.ok) setError(result.error);
      setApprovingId(null);
      setApproveConfirmText("");
      setDenyingId(null);
    });
  }

  return (
    <div className="card roster-join-requests" data-testid="roster-join-requests">
      <h3>Requests to join</h3>
      <p className="card__meta" style={{ marginTop: "-0.4rem" }}>
        Submitted by someone who looked up this strata&rsquo;s plan number
        and asked to connect &mdash; visible only to the admin.
      </p>
      {error && <p className="roster-invites__error">{error}</p>}

      <ul className="roster-join-requests__list" data-testid="pending-join-requests">
        {requests.map((request) => (
          <li key={request.id}>
            <div className="roster-join-requests__row">
              <div>
                <span className="roster-invites__email">{request.fullName}</span>
                <span className="card__meta">
                  {request.email} &middot; Requested{" "}
                  {new Date(request.requestedAt).toLocaleDateString("en-CA")}
                </span>
              </div>

              {denyingId === request.id ? (
                <span className="roster-invites__confirm">
                  Deny this request?
                  <button
                    className="button button-secondary button-small"
                    onClick={() => setDenyingId(null)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-danger button-small"
                    onClick={() => resolve(request.id, false)}
                    disabled={pending}
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
                    disabled={pending}
                    data-testid={`join-request-deny-${request.id}`}
                  >
                    Deny
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => startApproving(request.id)}
                    disabled={pending}
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
                    Approving connects {request.fullName} to this strata
                    immediately &mdash; they&rsquo;ll appear on the council
                    roster and can see everything other members can.
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
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={() => resolve(request.id, true)}
                    disabled={
                      pending ||
                      approveConfirmText.trim().toLowerCase() !== APPROVE_CONFIRM_PHRASE
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
