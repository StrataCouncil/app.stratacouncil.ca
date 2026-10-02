"use client";

import Link from "next/link";
import { useStrata } from "@/components/StrataContext";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";

/** The "Subscribe" button on locked features. Billing is admin-only, so
 * everyone else gets a plain note instead of a link to it. */
export function SubscribeCta({ testId }: { testId?: string }) {
  const { corpId, isAdmin } = useStrata();
  if (!isAdmin) return <RequestSubscriptionButton corpId={corpId} />;
  return (
    <Link href={`/strata/${corpId}/billing`} className="button button-primary" data-testid={testId}>
      Subscribe to Stratasphere&trade;
    </Link>
  );
}
