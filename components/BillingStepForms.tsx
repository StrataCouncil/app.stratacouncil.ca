"use client";

import { useActionState } from "react";
import { paySubscription, saveBillingContacts } from "@/app/strata/[corpId]/billing/actions";
import type { BillingInterval } from "@/lib/stripe/prices";

/** Billing step 3: one or more contact emails. */
export function BillingContactForm({
  corpId,
  interval,
  defaultEmails,
}: {
  corpId: string;
  interval: BillingInterval;
  defaultEmails: string;
}) {
  const [state, action, pending] = useActionState(saveBillingContacts.bind(null, corpId, interval), undefined);
  return (
    <form action={action} className="billing-step__form">
      <div className="field">
        <label htmlFor="billing-emails">Billing contact emails</label>
        <input
          id="billing-emails"
          name="billingEmail"
          type="text"
          inputMode="email"
          defaultValue={defaultEmails}
          placeholder="treasurer@example.com, manager@example.com"
          required
          data-testid="billing-email-input"
        />
        <span className="field__hint">
          Separate several addresses with commas. Each gets the invoices and receipts, usually the Treasurer and your
          strata management company.
        </span>
      </div>
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button button-primary" disabled={pending} data-testid="billing-contacts-continue">
        {pending ? "Saving…" : "Continue to review"}
      </button>
    </form>
  );
}

/** Billing step 4: pay and start the subscription. */
export function BillingPayForm({ corpId, interval, label }: { corpId: string; interval: BillingInterval; label: string }) {
  const [state, action, pending] = useActionState(paySubscription.bind(null, corpId, interval), undefined);
  return (
    <form action={action} className="billing-step__form">
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button button-primary billing-pay" disabled={pending} data-testid="billing-pay">
        {pending ? "Processing…" : label}
      </button>
    </form>
  );
}
