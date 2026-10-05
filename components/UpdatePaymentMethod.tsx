"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { finishPaymentMethodUpdate, startPaymentMethodUpdate } from "@/app/strata/[corpId]/billing/actions";
import { StripeEmbeddedForm } from "@/components/StripeEmbeddedForm";

/**
 * Billing → Update payment method, inside the app: Stripe's form in a
 * dialog saves the new bank account or card, and it pays the subscription
 * from then on. A bank account typed in by hand is used once its
 * micro-deposits are confirmed; the current method keeps paying until then.
 */
export function UpdatePaymentMethod({ corpId, publishableKey }: { corpId: string; publishableKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"form" | "saving" | "updated" | "verify" | "failed">("form");
  const start = useCallback(() => startPaymentMethodUpdate(corpId), [corpId]);
  const complete = useCallback(
    async (sessionId: string) => {
      setState("saving");
      try {
        const res = await finishPaymentMethodUpdate(corpId, sessionId);
        setState(res.state);
      } catch {
        setState("failed");
      }
      router.refresh();
    },
    [corpId, router]
  );
  const close = `/strata/${corpId}/billing`;

  return (
    <div className="billing-step" data-testid="update-payment-method">
      {state === "form" &&
        (publishableKey ? (
          <>
            <p className="card__meta">
              Add the new bank account (pre-authorized debit) or card. It pays the subscription from the next charge on.
            </p>
            <StripeEmbeddedForm publishableKey={publishableKey} start={start} onComplete={complete} />
          </>
        ) : (
          <p className="form-alert form-alert--error" role="alert">
            Payments aren&rsquo;t set up yet: Stripe&rsquo;s publishable key is missing. Contact us.
          </p>
        ))}
      {state === "saving" && (
        <p className="form-alert form-alert--ok" role="status">
          Saving&hellip;
        </p>
      )}
      {state === "updated" && (
        <p className="form-alert form-alert--ok" role="status" data-testid="payment-method-updated">
          Updated. The new payment method pays from the next charge on.
        </p>
      )}
      {state === "verify" && (
        <p className="form-alert form-alert--ok" role="status" data-testid="payment-method-verify">
          Saved. Stripe will send two small deposits to confirm the bank account; Billing shows where to enter them. Until
          then, the current payment method keeps paying.
        </p>
      )}
      {state === "failed" && (
        <p className="form-alert form-alert--error" role="alert">
          The payment method couldn&rsquo;t be saved. Please try again.
        </p>
      )}
      <div className="billing-step__nav">
        <Link href={close} className="button button-secondary">
          {state === "form" ? "Cancel" : "Close"}
        </Link>
      </div>
    </div>
  );
}
