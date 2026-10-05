"use client";

import Link from "next/link";
import { useActionState, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { finishSubscriptionCheckout, saveBillingContacts, startSubscriptionCheckout } from "@/app/strata/[corpId]/billing/actions";
import { StripeEmbeddedForm } from "@/components/StripeEmbeddedForm";
import type { BillingInterval } from "@/lib/stripe/prices";
import { PROVINCES, type BillingAddress } from "@/lib/billing-address";

/**
 * Billing step 2: who gets the invoices, and the billing address. The
 * address is the building's civic address by default; a management
 * company paying for the strata can enter its own office instead. Stripe
 * calculates GST from it.
 */
export function BillingContactForm({
  corpId,
  interval,
  defaultEmails,
  defaultAddress,
  defaultSame,
  civicAddress,
  cancelHref,
  backHref,
}: {
  corpId: string;
  interval: BillingInterval;
  defaultEmails: string;
  defaultAddress: BillingAddress | null;
  defaultSame: boolean;
  civicAddress: string;
  cancelHref: string;
  backHref: string;
}) {
  const [state, action, pending] = useActionState(saveBillingContacts.bind(null, corpId, interval), undefined);
  const [same, setSame] = useState(defaultSame);
  const typed = defaultSame ? null : defaultAddress;

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

      <fieldset className="billing-address">
        <legend>Billing address</legend>
        <label className="billing-address__same">
          <input type="checkbox" name="addressSame" checked={same} onChange={(e) => setSame(e.target.checked)} data-testid="billing-address-same" />
          <span>
            Same as the building&rsquo;s civic address
            <span className="card__meta">{civicAddress}</span>
          </span>
        </label>
        {!same && (
          <div className="billing-address__fields" data-testid="billing-address-fields">
            <div className="field">
              <label htmlFor="ba-line1">Street address</label>
              <input id="ba-line1" name="line1" defaultValue={typed?.line1 ?? ""} autoComplete="address-line1" required />
            </div>
            <div className="field">
              <label htmlFor="ba-line2">Suite or unit (optional)</label>
              <input id="ba-line2" name="line2" defaultValue={typed?.line2 ?? ""} autoComplete="address-line2" />
            </div>
            <div className="billing-address__row">
              <div className="field">
                <label htmlFor="ba-city">City</label>
                <input id="ba-city" name="city" defaultValue={typed?.city ?? ""} autoComplete="address-level2" required />
              </div>
              <div className="field">
                <label htmlFor="ba-province">Province</label>
                <select id="ba-province" name="province" defaultValue={typed?.province ?? "BC"} autoComplete="address-level1">
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ba-postal">Postal code</label>
                <input id="ba-postal" name="postalCode" defaultValue={typed?.postalCode ?? ""} autoComplete="postal-code" required />
              </div>
            </div>
          </div>
        )}
      </fieldset>

      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="billing-step__nav">
        <Link href={cancelHref} className="button button-secondary" data-testid="billing-cancel">
          Cancel
        </Link>
        <span className="billing-step__nav-right">
          <Link href={backHref} className="button button-secondary" data-testid="billing-back">
            Back
          </Link>
          <button className="button button-primary" disabled={pending} data-testid="billing-contacts-continue">
            {pending ? "Saving…" : "Next"}
          </button>
        </span>
      </div>
    </form>
  );
}

/**
 * Billing step 4: Stripe's payment form, inside the dialog. Adding the
 * bank account or card here and confirming creates the subscription.
 */
export function BillingPayStep({
  corpId,
  interval,
  publishableKey,
  cancelHref,
  backHref,
}: {
  corpId: string;
  interval: BillingInterval;
  publishableKey: string | null;
  cancelHref: string;
  backHref: string;
}) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const start = useCallback(() => startSubscriptionCheckout(corpId, interval), [corpId, interval]);
  const complete = useCallback(
    async (sessionId: string) => {
      setFinishing(true);
      try {
        await finishSubscriptionCheckout(corpId, sessionId);
      } catch {
        // The webhook and Billing's own check with Stripe record it anyway.
      }
      router.push(`/strata/${corpId}/billing?subscribed=1`);
    },
    [corpId, router]
  );

  return (
    <div className="billing-step__form">
      {!publishableKey ? (
        <p className="form-alert form-alert--error" role="alert">
          Payments aren&rsquo;t set up yet: Stripe&rsquo;s publishable key is missing. Contact us.
        </p>
      ) : finishing ? (
        <p className="form-alert form-alert--ok" role="status" data-testid="billing-finishing">
          Done. Finishing up&hellip;
        </p>
      ) : (
        <StripeEmbeddedForm publishableKey={publishableKey} start={start} onComplete={complete} />
      )}
      <div className="billing-step__nav">
        <Link href={cancelHref} className="button button-secondary" data-testid="billing-cancel">
          Cancel
        </Link>
        <span className="billing-step__nav-right">
          <Link href={backHref} className="button button-secondary" data-testid="billing-back">
            Back
          </Link>
        </span>
      </div>
    </div>
  );
}
