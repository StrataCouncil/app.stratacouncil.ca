"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { setStripeSandbox } from "@/app/admin/actions";

/**
 * Super Admin: bill this strata through Stripe test mode (the sandbox) or
 * live Stripe (0029). Meant for a test strata only once there are paying
 * customers.
 */
export function StripeModeSwitch({
  corpId,
  sandbox,
  hasCustomer,
  hasSubscription,
}: {
  corpId: string;
  sandbox: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const target = !sandbox;

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await setStripeSandbox(corpId, target);
      if (!result.ok) setError(result.error);
      else setConfirming(false);
    });
  }

  return (
    <section className={`card stripe-mode${sandbox ? " stripe-mode--sandbox" : ""}`} data-testid="stripe-mode">
      <div className="stripe-mode__head">
        <div>
          <h3>Stripe billing</h3>
          <p className="card__meta">
            {sandbox
              ? "Sandbox: this strata bills through Stripe test mode. No real charges. The strata shows a Sandbox pill beside its plan number."
              : "Live: this strata bills through live Stripe, like every real customer."}
          </p>
        </div>
        <span className={`pill${sandbox ? " stripe-mode__pill" : ""}`}>{sandbox ? "Sandbox" : "Live"}</span>
      </div>
      <button
        type="button"
        className={`button ${sandbox ? "button-secondary" : "button-danger"} button-small`}
        style={{ alignSelf: "flex-start" }}
        onClick={() => setConfirming(true)}
        data-testid="stripe-mode-open"
      >
        {sandbox ? "Switch back to live Stripe" : "Switch to sandbox"}
      </button>

      {confirming && (
        <Modal title={sandbox ? "Switch back to live Stripe?" : "Switch to the Stripe sandbox?"} onClose={() => setConfirming(false)}>
          <p>
            {sandbox
              ? "Billing for this strata goes back to live Stripe, and real charges apply from its next subscription."
              : "Billing for this strata moves to Stripe test mode. Use this only for a test strata, never for a paying customer."}
          </p>
          {(hasCustomer || hasSubscription) && (
            <p className="card__meta">
              Its current Stripe details belong to {sandbox ? "the sandbox" : "live Stripe"}, so they&rsquo;re cleared and
              billing starts fresh. {hasSubscription ? "A running subscription must be cancelled in Stripe first." : ""}
            </p>
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
              className={`button ${target ? "button-danger" : "button-primary"}`}
              onClick={apply}
              disabled={pending}
              data-testid="stripe-mode-confirm"
            >
              {pending ? "Switching…" : target ? "Use the sandbox" : "Use live Stripe"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
