"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Stratasphere™ is desktop-only below ~900px, except the Knowledge
 * Library: a playbook is exactly what someone needs on their phone when
 * a water main bursts. Its pages render on every screen size; everything
 * else shows `.screen-gate-notice` instead (CSS in globals.css).
 */
export function ScreenGate({ corpId, children }: { corpId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const mobileOk = pathname.startsWith(`/strata/${corpId}/guides`);

  return (
    <>
      {!mobileOk && (
        <div className="screen-gate-notice">
          <span className="pill pill--locked">Desktop required</span>
          <h2>Stratasphere&trade; is best experienced on a larger screen</h2>
          <p>
            Roster, documents, meeting mode and the rest of your strata&rsquo;s governance tools need more room than a
            phone screen gives. Please switch to a desktop or laptop. The Knowledge Library and Council Training work
            on any device.
          </p>
          <Link href={`/strata/${corpId}/guides`} className="button button-primary">
            Open the Knowledge Library
          </Link>
          <Link href="/training" className="button button-secondary">
            Go to Council Training
          </Link>
        </div>
      )}
      <div className={mobileOk ? "screen-gate-content screen-gate-content--mobile-ok" : "screen-gate-content"}>
        {children}
      </div>
    </>
  );
}
