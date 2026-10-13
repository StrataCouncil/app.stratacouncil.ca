"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { setComplimentary } from "@/app/admin/actions";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

/**
 * Super Admin: give a strata the Stratasphere without Stripe (0050), or
 * take it away. Switching it off ends access straight away; the strata can
 * then subscribe and pay like any other.
 */
export function ComplimentarySwitch({
  corpId,
  since,
  by,
  hasStripeSubscription,
}: {
  corpId: string;
  since: string | null;
  by: string | null;
  hasStripeSubscription: boolean;
}) {
  const on = Boolean(since);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await setComplimentary(corpId, !on);
      if (!result.ok) setError(result.error);
      else setConfirming(false);
    });
  }

  return (
    <section className={`card stripe-mode${on ? " stripe-mode--complimentary" : ""}`} data-testid="complimentary">
      <div className="stripe-mode__head">
        <div>
          <h3>Complimentary access</h3>
          <p className="card__meta">
            {on
              ? `On since ${day(since!)}${by ? `, switched on by ${by}` : ""}. The strata has the Stratasphere with no Stripe subscription and no charges; its Billing page says Complimentary.`
              : "Off. Switch it on to give this strata the Stratasphere without a subscription or any charges."}
          </p>
        </div>
        <span className={`pill${on ? "" : " pill--locked"}`}>{on ? "Complimentary" : "Off"}</span>
      </div>
      <button
        type="button"
        className={`button ${on ? "button-danger" : "button-secondary"} button-small`}
        style={{ alignSelf: "flex-start" }}
        onClick={() => setConfirming(true)}
        data-testid="complimentary-open"
      >
        {on ? "Switch off complimentary access" : "Make complimentary"}
      </button>

      {confirming && (
        <Modal title={on ? "Switch off complimentary access?" : "Make this strata complimentary?"} onClose={() => setConfirming(false)}>
          <p>
            {on
              ? "Meeting Mode and the Stratasphere assistant stop working for this strata straight away. Its documents, meetings and minutes stay. To keep the Stratasphere, the strata's admin subscribes and pays on its Billing page."
              : "The strata gets everything a subscription unlocks, with no Stripe subscription and no charges, until you switch this off."}
          </p>
          {!on && hasStripeSubscription && (
            <p className="card__meta">A running Stripe subscription must be cancelled in Stripe first.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className={`button ${on ? "button-danger" : "button-primary"}`}
              onClick={apply}
              disabled={pending}
              data-testid="complimentary-confirm"
            >
              {pending ? "Saving…" : on ? "Switch off" : "Make complimentary"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
