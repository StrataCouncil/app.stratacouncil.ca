"use client";

import Link from "next/link";
import { useStrata } from "@/components/StrataContext";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/** The "Subscribe" button on locked features. Only those who can use
 * Billing (the admin, and anyone they've given billing access to) get a link to it;
 * everyone else can ask the admin. While a subscription is pending,
 * everyone gets the pending note instead. */
export function SubscribeCta({ testId }: { testId?: string }) {
  const { corpId, canBill, pending } = useStrata();
  if (pending) return <SubscriptionPendingNote />;
  if (!canBill) return <RequestSubscriptionButton corpId={corpId} />;
  return (
    <Link href={`/strata/${corpId}/billing?step=plan`} className="button button-primary" data-testid={testId}>
      Subscribe to Stratasphere&trade;
    </Link>
  );
}
