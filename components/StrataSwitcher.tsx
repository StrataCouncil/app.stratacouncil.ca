"use client";

import Link from "next/link";
import { useState } from "react";
import { connectedCorporations, currentCorporation } from "@/lib/placeholder-data";

/**
 * The strata switcher used to live in the global header (visible on Home
 * and Council Training too, neither of which is scoped to a corporation
 * at all). It only matters once you're actually inside Stratasphere™, so
 * it lives here now instead — rendered once, from the `/strata/[corpId]`
 * layout, not the app shell. Still a placeholder: one mock corporation,
 * so picking it just closes the menu, but the real behavior (a working
 * dropdown once a user has more than one connection) is mocked up rather
 * than left as a static label.
 */
export function StrataSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="strata-switcher">
      <button
        className="strata-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        data-testid="strata-switcher-trigger"
        aria-expanded={open}
      >
        <span className="strata-switcher__label">Strata</span>
        <span className="strata-switcher__name">{currentCorporation.buildingName}</span>
        <svg viewBox="0 0 16 16" className="strata-switcher__chevron" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="strata-switcher__menu" data-testid="strata-switcher-menu">
          {connectedCorporations.map(({ corporation }) => (
            <button
              key={corporation.id}
              className="strata-switcher__option"
              data-selected={corporation.id === currentCorporation.id}
              onClick={() => setOpen(false)}
              data-testid={`strata-switcher-option-${corporation.id}`}
            >
              <span>
                <strong>{corporation.buildingName}</strong>
                <span className="strata-switcher__option-meta">{corporation.address}</span>
              </span>
              {corporation.id === currentCorporation.id && (
                <span className="strata-switcher__check" aria-hidden="true">
                  &#10003;
                </span>
              )}
            </button>
          ))}
          <Link
            href="/strata"
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
