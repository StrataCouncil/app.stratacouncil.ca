"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";

/**
 * Getting started, for a new strata's admin: the few things that make
 * StrataCouncil.ca (and a first meeting) worth having, in order. Steps tick
 * themselves off from the real data. Opens once as a window on the first
 * visit, then stays as a compact card until everything's done or it's
 * hidden. Remembered per browser; nothing here is stored for the strata.
 */
export interface GettingStartedStep {
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

export function GettingStarted({ corpId, steps }: { corpId: string; steps: GettingStartedStep[] }) {
  const seenKey = `sc-getting-started-seen:${corpId}`;
  const hiddenKey = `sc-getting-started-hidden:${corpId}`;
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(seenKey) === "1";
      setHidden(localStorage.getItem(hiddenKey) === "1");
      if (!seen) localStorage.setItem(seenKey, "1");
    } catch {
      // Storage blocked: show the card, skip the window.
    }
    if (!seen && !allDone) setOpen(true);
    setReady(true);
  }, [seenKey, hiddenKey, allDone]);

  if (!ready || allDone || (hidden && !open)) return null;

  const list = (
    <ol className="getting-started__steps">
      {steps.map((s) => (
        <li key={s.label} data-done={s.done || undefined}>
          <span className="checklist__mark" aria-hidden="true">
            {s.done ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : null}
          </span>
          <span>
            {s.done ? (
              <span className="getting-started__label">{s.label}</span>
            ) : (
              <Link href={s.href} className="getting-started__label" onClick={() => setOpen(false)}>
                {s.label}
              </Link>
            )}
            {!s.done && <span className="checklist__hint">{s.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      {!hidden && (
        <section className="card getting-started" data-testid="getting-started">
          <div className="getting-started__head">
            <div>
              <h3>Getting started</h3>
              <p className="card__meta">
                {doneCount} of {steps.length} done. A meeting goes much further once your records are here.
              </p>
            </div>
            <div className="getting-started__actions">
              <button type="button" className="button button-secondary button-small" onClick={() => setOpen(true)}>
                Show steps
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setHidden(true);
                  try {
                    localStorage.setItem(hiddenKey, "1");
                  } catch {}
                }}
              >
                Hide
              </button>
            </div>
          </div>
        </section>
      )}
      {open && (
        <Modal title="Welcome to StrataCouncil.ca" onClose={() => setOpen(false)} testId="getting-started-modal">
          <p className="card__meta">
            Before your first meeting, set up the essentials. Everything you add makes the agenda, the minutes and
            Stratasphere&trade; more useful.
          </p>
          {list}
          <div className="role-editor__actions">
            <button type="button" className="button button-primary" onClick={() => setOpen(false)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
