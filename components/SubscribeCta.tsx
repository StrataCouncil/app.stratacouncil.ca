"use client";

import Link from "next/link";
import { useStrata } from "@/components/StrataContext";

/** The "Subscribe" button on locked features. Billing is admin-only, so
 * everyone else gets a plain note instead of a link to it. */
export function SubscribeCta({ testId }: { testId?: string }) {
  const { corpId, isAdmin } = useStrata();
  if (!isAdmin) return <p className="card__meta">Ask your strata&rsquo;s admin about a subscription.</p>;
  return (
    <Link href={`/strata/${corpId}/billing`} className="button button-primary" data-testid={testId}>
      Subscribe to Stratasphere&trade;
    </Link>
  );
}
