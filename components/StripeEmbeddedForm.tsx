"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";

type Started = { clientSecret: string; sessionId: string } | { error: string };

const stripes = new Map<string, ReturnType<typeof loadStripe>>();
function stripeFor(publishableKey: string) {
  let s = stripes.get(publishableKey);
  if (!s) {
    s = loadStripe(publishableKey);
    stripes.set(publishableKey, s);
  }
  return s;
}

/**
 * Stripe's payment form, inside our own page (embedded Checkout): bank
 * sign-in, typed-in bank details and cards, with Stripe handling the
 * secure parts. `start` asks our server for the form; `onComplete` runs
 * once it's done, with the Stripe session it belonged to.
 */
export function StripeEmbeddedForm({
  publishableKey,
  start,
  onComplete,
}: {
  publishableKey: string;
  start: () => Promise<Started>;
  onComplete: (sessionId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  // Stripe's form can't be given new options once it's open: keep the
  // callbacks in refs so the options object never changes.
  const startRef = useRef(start);
  const completeRef = useRef(onComplete);
  startRef.current = start;
  completeRef.current = onComplete;
  const stripe = useMemo(() => stripeFor(publishableKey), [publishableKey]);

  const fetchClientSecret = useCallback(async () => {
    let res: Started;
    try {
      res = await startRef.current();
    } catch {
      res = { error: "Couldn't reach the server. Refresh the page and try again." };
    }
    if ("error" in res) {
      setError(res.error);
      throw new Error(res.error);
    }
    session.current = res.sessionId;
    return res.clientSecret;
  }, []);

  const options = useMemo(
    () => ({
      fetchClientSecret,
      onComplete: () => {
        if (session.current) completeRef.current(session.current);
      },
    }),
    [fetchClientSecret]
  );

  if (error) {
    return (
      <p className="form-alert form-alert--error" role="alert" data-testid="stripe-form-error">
        {error}
      </p>
    );
  }
  return (
    <div className="stripe-embedded" data-testid="stripe-embedded-form">
      <EmbeddedCheckoutProvider stripe={stripe} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
