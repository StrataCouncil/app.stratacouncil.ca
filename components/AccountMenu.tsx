"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "@/lib/auth/actions";
import type { CurrentProfile } from "@/lib/data/profile";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Now takes the real signed-in profile as a prop from `AppShell` (a
 * Server Component) instead of importing the `currentProfile` mock
 * directly — a Client Component can't call the server-side Supabase
 * client itself, so the data has to come in from its server parent.
 * There's no real avatar-upload backend (no `avatar_url` column on
 * `profiles`), so this always shows initials now rather than a stale
 * mock image URL.
 */
export function AccountMenu({ profile }: { profile: CurrentProfile | null }) {
  const [open, setOpen] = useState(false);
  if (!profile) return null;

  const displayName = profile.fullName.trim() || profile.email;
  const firstName = displayName.split(" ")[0];

  return (
    <div className="account-menu">
      <button
        className="account-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        data-testid="account-menu-trigger"
        aria-expanded={open}
      >
        <span className="account-menu__avatar account-menu__avatar--initials" aria-hidden="true">
          {initials(displayName)}
        </span>
        <span className="account-menu__name">{firstName}</span>
        <svg viewBox="0 0 16 16" className="account-menu__chevron" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="account-menu__panel" data-testid="account-menu-panel">
          <div className="account-menu__panel-header">
            <strong>{displayName}</strong>
            <span>{profile.email}</span>
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
