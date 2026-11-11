"use client";

import { useState, useTransition } from "react";
import { setJourney } from "@/app/admin/emails/actions";

/** A lifecycle journey's on/off switch in the console. */
export function JourneySwitch({ journey, enabled }: { journey: string; enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function toggle() {
    const next = !enabled;
    if (next && !window.confirm("Turn on the sign-up emails? Only people who confirm their email from now on get them; existing accounts are never emailed.")) return;
    setError(null);
    start(async () => {
      const r = await setJourney(journey, next);
      if (!r.ok) setError(r.error);
    });
  }
  return (
    <span>
      <button type="button" className={`button button-small ${enabled ? "button-secondary" : "button-primary"}`} disabled={pending} onClick={toggle} data-testid={`journey-${journey}-toggle`}>
        {enabled ? "Turn off" : "Turn on"}
      </button>
      {error && <span className="field__hint" style={{ color: "var(--danger, #c0392b)", marginLeft: "0.5rem" }}>{error}</span>}
    </span>
  );
}
