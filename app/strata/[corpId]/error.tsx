"use client";

import { useEffect } from "react";

/**
 * A page inside a strata that couldn't load its records (2026-11-12). Says
 * so plainly, instead of showing an empty list that reads as lost data. The
 * strata's header and menu stay; Try again re-runs the page.
 */
export default function StrataPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[strata page]", error.message, error.digest ?? "");
  }, [error]);

  return (
    <div className="lock-panel" role="alert" data-testid="strata-page-error">
      <h2>This page couldn&rsquo;t load</h2>
      <p>
        Nothing has been lost: your strata&rsquo;s records are safe. Please try again. If it keeps happening, let us know
        at support@stratacouncil.ca.
      </p>
      <button type="button" className="button button-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
