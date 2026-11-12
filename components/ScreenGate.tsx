"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A strata's pages are desktop-only below ~900px, except Ask (a question
 * answered from the strata's own records, wherever you are) and a
 * Discussion's email vote. The Library (a playbook is exactly what someone
 * needs on their phone when a water main bursts) is in Resources, outside
 * the strata, and works everywhere. Their pages render on every
 * screen size; everything else shows `.screen-gate-notice` instead (CSS in
 * globals.css).
 */
export function ScreenGate({ corpId, children }: { corpId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Ask works on phones; Meeting Mode
  // and the rest of the governance tools stay desktop-only.
  const mobileOk =
    pathname.startsWith(`/strata/${corpId}/assistant`) ||
    // An email's vote button (0081): council votes from their phones.
    /^\/strata\/[^/]+\/discussions\/[^/]+\/vote$/.test(pathname);

  return (
    <>
      {!mobileOk && (
        <div className="screen-gate-notice">
          <span className="pill pill--locked">Desktop required</span>
          <h2>Your strata&rsquo;s pages need a larger screen</h2>
          <p>
            Roster, documents, meeting mode and the rest of your strata&rsquo;s governance tools need more room than a
            phone screen gives. Please switch to a desktop or laptop. Ask Stratasphere&trade;, the Library, and
            Council Training work on any device.
          </p>
          <Link href={`/strata/${corpId}/assistant`} className="button button-primary">
            Ask Stratasphere&trade;
          </Link>
          <Link href="/library" className="button button-secondary">
            Open the Library
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
