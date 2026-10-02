"use client";

import { useState, useTransition } from "react";
import { requestSubscription } from "@/app/strata/[corpId]/subscription-request-actions";

/** For members who aren't the admin: asks the admin(s) by email to subscribe. */
export function RequestSubscriptionButton({ corpId }: { corpId: string }) {
  const [state, setState] = useState<{ sent?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();
  if (state.sent) {
    return (
      <span className="card__meta" role="status" data-testid="subscription-requested">
        Request sent to your strata&rsquo;s admin.
      </span>
    );
  }
  return (
    <span className="request-subscription">
      <button
        type="button"
        className="button button-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await requestSubscription(corpId);
            setState(res.ok ? { sent: true } : { error: res.error });
          })
        }
        data-testid="request-subscription"
      >
        {pending ? "Sending…" : "Request a subscription"}
      </button>
      {state.error && <span className="form-error">{state.error}</span>}
    </span>
  );
}
