"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "sc-training-welcome-dismissed";

/**
 * How Council Training works, for people new to it (note 3, 2026-10-05).
 * Dismissed per device; it stays out of the way once read.
 */
export function TrainingWelcome() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(DISMISSED_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Hidden for this visit only.
    }
  }

  if (!show) return null;

  return (
    <section className="card home-welcome" data-testid="training-welcome">
      <div className="home-welcome__head">
        <h2>How Council Training works</h2>
        <button type="button" className="link-button" onClick={dismiss} data-testid="training-welcome-dismiss">
          Got it
        </button>
      </div>
      <ol className="home-welcome__steps">
        <li>
          <strong>Start with the core.</strong> Strata Basics, then Council Ready: about two hours in all, covering what
          makes an effective council member.
        </li>
        <li>
          <strong>Add your office&rsquo;s track.</strong> Treasurers and secretaries each have a short track of their
          own, which opens once you&rsquo;re Council Ready.
        </li>
        <li>
          <strong>Go at your own pace.</strong> Modules take about 10 to 15 minutes each. Your progress saves as you
          finish each section, so you can stop and pick up later. There&rsquo;s no pass or fail.
        </li>
        <li>
          <strong>Your progress stays with you.</strong> It&rsquo;s yours, not your strata&rsquo;s. Completed tracks
          show as filled circles on your training page and your council&rsquo;s roster.
        </li>
      </ol>
      <Link href="/training" className="button button-primary button-small" style={{ alignSelf: "flex-start" }}>
        Start Council Training
      </Link>
    </section>
  );
}
