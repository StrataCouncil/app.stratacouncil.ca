"use client";

import { useActionState, useState, useTransition } from "react";
import {
  approveCreationRequest,
  denyCreationRequest,
  type ReviewResult,
} from "@/app/admin/actions";
import type { CreationRequestDetail } from "@/lib/data/admin";
import { jurisdictions } from "@/lib/strata";
import { splitPostal } from "@/lib/postal";

/**
 * The reviewer's half of corporation creation: the requester's typed
 * plan details, pre-filled and editable, to be checked against the
 * uploaded Strata Plan (linked on the page) and corrected before
 * approving. Approval creates the corporation and makes the requester its
 * admin; denial just closes the request.
 */
export function CreationRequestReview({ request }: { request: CreationRequestDetail }) {
  const [approveState, approveAction, approving] = useActionState<ReviewResult, FormData>(
    approveCreationRequest.bind(null, request.id),
    undefined
  );
  const [denyError, setDenyError] = useState<string | null>(null);
  const [confirmingDeny, setConfirmingDeny] = useState(false);
  const [denying, startDeny] = useTransition();

  function deny() {
    startDeny(async () => {
      const result = await denyCreationRequest(request.id);
      if (result && !result.ok) setDenyError(result.error);
    });
  }

  const busy = approving || denying;

  return (
    <form action={approveAction} className="card setup-form" data-testid="creation-review-form">
      <h3>Verify against the Strata Plan</h3>
      <p>
        Correct anything that doesn&rsquo;t match the plan. These values
        become the corporation&rsquo;s permanent identity &mdash; only the
        building name can be changed afterward.
      </p>

      <div className="field">
        <label htmlFor="rv-sp">Strata Plan number</label>
        <input id="rv-sp" name="strataPlanNumber" defaultValue={request.strataPlanNumber} required />
      </div>
      <div className="field">
        <label htmlFor="rv-legal">Legal name</label>
        <input id="rv-legal" name="legalName" defaultValue={request.legalName} required />
      </div>
      <div className="field">
        <label htmlFor="rv-building">Building name (optional)</label>
        <input id="rv-building" name="buildingName" defaultValue={request.buildingName} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="rv-address">Civic address</label>
        <div className="address-lookup__row">
          <input id="rv-address" name="address" defaultValue={splitPostal(request.address).street} required />
          <input
            name="postalCode"
            defaultValue={splitPostal(request.address).postal}
            placeholder="Postal code"
            aria-label="Postal code"
            maxLength={7}
            required
            data-testid="review-postal-code"
          />
        </div>
        <span className={request.addressVerified ? "field__hint" : "roster-table__warn"}>
          {request.addressVerified
            ? "Picked from the address lookup."
            : "Typed by the requester, not picked from the address lookup. Check it."}
        </span>
      </div>
      <div className="setup-form__row">
        <div className="field">
          <label htmlFor="rv-units">Number of strata lots</label>
          <input
            id="rv-units"
            name="unitCount"
            type="number"
            min={1}
            defaultValue={request.unitCount ?? ""}
            required
          />
          <span
            className={
              request.unitCountSource === "plan" && request.lotsCheck === "consistent" ? "field__hint" : "roster-table__warn"
            }
            data-testid="review-lots-source"
          >
            {request.unitCountSource === "manual"
              ? "Typed by the requester (the plan couldn't be read). Check it against the plan."
              : request.lotsCheck === "consistent"
                ? "Read from the plan, and matches the highest lot number in it."
                : request.lotsCheck === "differs"
                  ? "Read from the plan, but differs from the highest lot number in its text. Check it."
                  : "Read from the plan. Check it."}
            {request.unitEntitlementTotal ? ` Total unit entitlement: ${request.unitEntitlementTotal}.` : ""}
            {request.filedYear ? ` Filed ${request.filedYear}.` : ""}
          </span>
        </div>
        <div className="field">
          <label htmlFor="rv-jurisdiction">Jurisdiction</label>
          <select id="rv-jurisdiction" name="jurisdiction" defaultValue={request.jurisdiction || "BC"}>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {approveState && !approveState.ok && (
        <p className="roster-invites__error" data-testid="review-error">
          {approveState.error}
        </p>
      )}
      {denyError && <p className="roster-invites__error">{denyError}</p>}

      <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
        <button
          type="submit"
          className="button button-primary"
          disabled={busy}
          data-testid="review-approve"
        >
          {approving ? "Creating…" : "Approve and create corporation"}
        </button>
        {confirmingDeny ? (
          <span className="roster-invites__confirm">
            Deny this request?
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setConfirmingDeny(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger button-small"
              onClick={deny}
              disabled={busy}
              data-testid="review-deny-confirm"
            >
              Deny
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setConfirmingDeny(true)}
            disabled={busy}
            data-testid="review-deny"
          >
            Deny
          </button>
        )}
      </div>
    </form>
  );
}
