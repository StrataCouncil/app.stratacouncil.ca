"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StratasphereValue, STRATASPHERE_HEADLINE } from "@/components/StratasphereValue";

/**
 * The admin's prompt to subscribe, on a strata that isn't subscribed.
 * Not shown on the billing page itself, where subscribing happens.
 */
export function SubscribeNudge({ corpId }: { corpId: string }) {
  const pathname = usePathname();
  if (pathname.startsWith(`/strata/${corpId}/billing`)) return null;
  return (
    <div className="nudge-banner nudge-banner--value" data-testid="subscribe-nudge">
      <div>
        <strong>{STRATASPHERE_HEADLINE}</strong>
        <StratasphereValue />
        <p className="card__meta">Every strata&rsquo;s first meeting is free.</p>
      </div>
      <Link href={`/strata/${corpId}/billing?step=plan`} className="button button-primary" data-testid="subscribe-cta">
        Subscribe to Stratasphere&trade;
      </Link>
    </div>
  );
}
