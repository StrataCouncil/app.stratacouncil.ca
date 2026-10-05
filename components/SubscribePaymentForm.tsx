"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { finishSubscriptionPayment, startSubscriptionPayment } from "@/app/strata/[corpId]/billing/actions";
import type { BillingInterval } from "@/lib/stripe/prices";

const stripes = new Map<string, ReturnType<typeof loadStripe>>();
function stripeFor(publishableKey: string) {
  let s = stripes.get(publishableKey);
  if (!s) {
    s = loadStripe(publishableKey);
    stripes.set(publishableKey, s);
  }
  return s;
}

// Stripe's form in the app's own colours and type.
const appearance: StripeElementsOptions["appearance"] = {
  theme: "stripe",
  variables: {
    colorPrimary: "#b4602f",
    colorText: "#1b2a41",
    colorDanger: "#a6342a",
    borderRadius: "6px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
};

/**
 * Billing step 4: Stripe's payment form inside the dialog (the Payment
 * Element). The subscription is set up first, unpaid, with a Business
 * debit agreement; confirming here pays its first charge by bank debit or
 * card, and that method pays every renewal.
 */
export function SubscribePaymentForm({
  corpId,
  interval,
  publishableKey,
  total,
}: {
  corpId: string;
  interval: BillingInterval;
  publishableKey: string;
  total: string;
}) {
  const [started, setStarted] = useState<{ clientSecret: string; subscriptionId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripe = useMemo(() => stripeFor(publishableKey), [publishableKey]);

  useEffect(() => {
    let live = true;
    startSubscriptionPayment(corpId, interval)
      .then((res) => {
        if (!live) return;
        if ("error" in res) setError(res.error);
        else setStarted(res);
      })
      .catch(() => live && setError("Couldn't reach the server. Refresh the page and try again."));
    return () => {
      live = false;
    };
  }, [corpId, interval]);

  if (error) {
    return (
      <p className="form-alert form-alert--error" role="alert" data-testid="stripe-form-error">
        {error}
      </p>
    );
  }
  if (!started) {
    return (
      <p className="card__meta" role="status">
        Opening the secure payment form&hellip;
      </p>
    );
  }
  return (
    <Elements stripe={stripe} options={{ clientSecret: started.clientSecret, appearance }}>
      <PayForm corpId={corpId} subscriptionId={started.subscriptionId} total={total} />
    </Elements>
  );
}

function PayForm({ corpId, subscriptionId, total }: { corpId: string; subscriptionId: string; total: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: payError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Only for a bank or card check that has to leave the page.
        return_url: `${window.location.origin}/strata/${corpId}/billing/checkout-complete?subscription_id=${subscriptionId}`,
      },
      redirect: "if_required",
    });
    if (payError) {
      setError(payError.message ?? "The payment didn't go through. Check the details, or use a different method.");
      setBusy(false);
      return;
    }
    try {
      await finishSubscriptionPayment(corpId, subscriptionId);
    } catch {
      // The webhook and Billing's own check with Stripe record it anyway.
    }
    router.push(`/strata/${corpId}/billing?subscribed=1`);
  }

  return (
    <form onSubmit={subscribe} className="subscribe-pay" data-testid="subscribe-payment-form">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
      {error && (
        <p className="form-alert form-alert--error" role="alert" data-testid="subscribe-payment-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="button button-primary subscribe-pay__button"
        disabled={!stripe || !ready || busy}
        data-testid="billing-pay"
      >
        {busy ? "Subscribing…" : `Subscribe · ${total}/month`}
      </button>
    </form>
  );
}
