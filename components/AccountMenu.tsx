"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "@/lib/auth/actions";
import { currentProfile } from "@/lib/placeholder-data";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Replaces the app header's old bare "Sign out" link — that was the only
 * account affordance anywhere in the shell, with no way to reach a
 * profile at all. Same dropdown-from-a-trigger pattern as
 * `StrataSwitcher` (open state, menu positioned off the trigger), styled
 * for the dark header instead of a light surface it sits on top of.
 *
 * The trigger shows the avatar (or initials fallback — same `avatarUrl`
 * story as `AccountSettings`: session-only, no upload backend yet) plus
 * first name, not the bare "Sign out" text — so the header always shows
 * who's signed in, not just an exit affordance.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const firstName = currentProfile.fullName.split(" ")[0];

  return (
    <div className="account-menu">
      <button
        className="account-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        data-testid="account-menu-trigger"
        aria-expanded={open}
      >
        {currentProfile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentProfile.avatarUrl} alt="" className="account-menu__avatar" />
        ) : (
          <span className="account-menu__avatar account-menu__avatar--initials" aria-hidden="true">
            {initials(currentProfile.fullName)}
          </span>
        )}
        <span className="account-menu__name">{firstName}</span>
        <svg viewBox="0 0 16 16" className="account-menu__chevron" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="account-menu__panel" data-testid="account-menu-panel">
          <div className="account-menu__panel-header">
            <strong>{currentProfile.fullName}</strong>
            <span>{currentProfile.email}</span>
          </div>
          <Link href="/account" className="account-menu__item" data-testid="account-menu-account-link" onClick={() => setOpen(false)}>
            Account
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="account-menu__item account-menu__item--signout"
              data-testid="account-menu-signout"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
