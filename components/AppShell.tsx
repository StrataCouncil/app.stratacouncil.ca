import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { Logo } from "@/components/Logo";
import { currentCorporation, currentProfile } from "@/lib/placeholder-data";

/**
 * Top-level app shell (doc03 "Screen layout — two levels, not one flat
 * menu"): Home (the signed-in landing screen) and Council Training are
 * both unswitched, belonging to the user, not any corporation. No corp
 * switcher lives up here any more — Home and Council Training aren't
 * scoped to a strata at all, so a switcher in this global header was
 * chrome for a decision that only matters once you're actually inside
 * Stratasphere&trade;. That control now lives there instead
 * (`StrataSwitcher`, rendered from the `/strata/[corpId]` layout).
 *
 * "Admin" only ever renders for `currentProfile.isSuperAdmin` — this is
 * StrataCouncil's own platform-staff console (`/admin`), not a
 * corporation-scoped tab, so it has no reason to be visible, or even
 * discoverable, to a connected council member. See `/admin`'s own
 * `notFound()` guard for the same check enforced server-side, not just
 * hidden client-side chrome.
 */
export function AppShell({
  active,
  children,
}: {
  active?: "home" | "training" | "strata" | "admin";
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="app-header">
        <div className="wrap app-header__inner">
          <Link href="/" className="app-header__brand">
            <Logo className="app-header__mark" />
            <span>StrataCouncil.ca</span>
          </Link>
          <nav className="app-nav" aria-label="Primary">
            <Link href="/" data-active={active === "home"}>
              Home
            </Link>
            <Link href="/training" data-active={active === "training"}>
              Council Training
            </Link>
            <Link
              href={`/strata/${currentCorporation.id}`}
              data-active={active === "strata"}
            >
              Stratasphere&trade;
            </Link>
            {currentProfile.isSuperAdmin && (
              <Link href="/admin" data-active={active === "admin"}>
                Admin
              </Link>
            )}
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
