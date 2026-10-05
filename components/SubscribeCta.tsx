"use client";

import Link from "next/link";
import { useStrata } from "@/components/StrataContext";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/** The "Subscribe" button on locked features. Billing is admin-only, so
 * everyone else gets a plain note instead of a link to it. While a
 * subscription is pending, everyone gets the pending note instead. */
export function SubscribeCta({ testId }: { testId?: string }) {
  const { corpId, isAdmin, pending } = useStrata();
  if (pending) return <SubscriptionPendingNote />;
  if (!isAdmin) return <RequestSubscriptionButton corpId={corpId} />;
  return (
    <Link href={`/strata/${corpId}/billing?step=plan`} className="button button-primary" data-testid={testId}>
      Subscribe to Stratasphere&trade;
    </Link>
  );
}
