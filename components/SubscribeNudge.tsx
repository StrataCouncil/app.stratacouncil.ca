"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { STRATASPHERE_PITCH, STRATASPHERE_TITLE } from "@/components/StratasphereValue";

const HIDE_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The admin's prompt to subscribe, on a strata that isn't subscribed.
 * The X hides it for 7 days on this device, per strata; subscribing is
 * always available on the billing page, where this prompt isn't shown.
 */
export function SubscribeNudge({ corpId }: { corpId: string }) {
  const pathname = usePathname();
  const key = `sc-subscribe-nudge-hidden:${corpId}`;
  // Hidden until checked, so a dismissed prompt doesn't flash on load.
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const until = Number(localStorage.getItem(key) ?? 0);
      setHidden(until > Date.now());
    } catch {
      setHidden(false);
    }
  }, [key]);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(key, String(Date.now() + HIDE_FOR_MS));
    } catch {
      // Hidden for this visit only.
    }
  }

  if (hidden || pathname.startsWith(`/strata/${corpId}/billing`)) return null;
  return (
    <div className="nudge-banner nudge-banner--compact" data-testid="subscribe-nudge">
      <div>
        <strong>{STRATASPHERE_TITLE}</strong>
        <p>{STRATASPHERE_PITCH}</p>
      </div>
      <Link href={`/strata/${corpId}/billing?step=plan`} className="button button-primary" data-testid="subscribe-cta">
        Subscribe
      </Link>
      <button type="button" className="icon-button nudge-banner__close" aria-label="Hide for 7 days" title="Hide for 7 days" onClick={dismiss} data-testid="subscribe-nudge-dismiss">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
