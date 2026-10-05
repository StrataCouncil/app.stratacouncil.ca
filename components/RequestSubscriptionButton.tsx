"use client";

import { useState, useTransition } from "react";
import { requestSubscription } from "@/app/strata/[corpId]/subscription-request-actions";
import { useOptionalStrata } from "@/components/StrataContext";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/**
 * For members who aren't the admin: asks the admin(s) by email to
 * subscribe. While a subscription is pending there's nothing to ask for,
 * so it says that instead.
 */
export function RequestSubscriptionButton({ corpId, subscriptionPending }: { corpId: string; subscriptionPending?: boolean }) {
  const strata = useOptionalStrata();
  const [state, setState] = useState<{ sent?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();
  if (subscriptionPending ?? (strata?.corpId === corpId && strata.pending)) {
    return <SubscriptionPendingNote corpId={corpId} isAdmin={false} />;
  }
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
