"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import type { ConnectedCorporation } from "@/lib/data/corporations";

/**
 * Now takes the real list of the signed-in user's connected corporations
 * as a prop from the `/strata/[corpId]` layout (a Server Component),
 * instead of importing `connectedCorporations`/`currentCorporation` from
 * the mock. Options are real `Link`s to `/strata/[id]` now rather than a
 * button that just closed the menu — the mock only ever had one option,
 * so it never actually needed to navigate anywhere.
 */
export function StrataSwitcher({
  corporations,
  currentId,
}: {
  corporations: ConnectedCorporation[];
  currentId: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(wrap, open, () => setOpen(false));
  const current = corporations.find((c) => c.id === currentId);

  return (
    <div className="strata-switcher" ref={wrap}>
      <button
        className="strata-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        data-testid="strata-switcher-trigger"
        aria-expanded={open}
      >
        <span className="strata-switcher__label">Strata</span>
        <span className="strata-switcher__name">
          {current?.buildingName ?? current?.legalName ?? currentId}
        </span>
        <svg viewBox="0 0 16 16" className="strata-switcher__chevron" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="strata-switcher__menu" data-testid="strata-switcher-menu">
          {corporations.map((corporation) => (
            <Link
              key={corporation.id}
              href={`/strata/${corporation.id}`}
              className="strata-switcher__option"
              data-selected={corporation.id === currentId}
              onClick={() => setOpen(false)}
              data-testid={`strata-switcher-option-${corporation.id}`}
            >
              <span>
                <strong>{corporation.buildingName ?? corporation.legalName}</strong>
                <span className="strata-switcher__option-meta">{corporation.address}</span>
              </span>
              {corporation.id === currentId && (
                <span className="strata-switcher__check" aria-hidden="true">
                  &#10003;
                </span>
              )}
            </Link>
          ))}
          <Link
            href="/strata?connect=1"
            className="strata-switcher__connect"
            data-testid="strata-switcher-connect"
          >
            + Connect another strata
          </Link>
        </div>
      )}
    </div>
  );
}
