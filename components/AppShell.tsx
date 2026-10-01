import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { Logo } from "@/components/Logo";
import { getCurrentProfile } from "@/lib/data/profile";
import { getConnectedCorporations } from "@/lib/data/corporations";

/**
 * Top-level app shell (doc03 "Screen layout — two levels, not one flat
 * menu"): Home (the signed-in landing screen) and Council Training are
 * both unswitched, belonging to the user, not any corporation.
 *
 * Now reads the real signed-in user instead of the `currentProfile` /
 * `currentCorporation` mocks — this fixes the Stratasphere nav link
 * pointing at a hardcoded corp ID regardless of who's actually signed in,
 * and the Admin link showing/hiding based on a fake `isSuperAdmin` flag.
 * The Stratasphere link goes to the user's first real connected
 * corporation if they have one, or `/strata` (the connect/zero state)
 * if they don't.
 */
export async function AppShell({
  active,
  children,
}: {
  active?: "home" | "training" | "strata" | "admin";
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const corporations = await getConnectedCorporations();
  const primaryCorpHref =
    corporations.length > 0 ? `/strata/${corporations[0].id}` : "/strata";

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
            <Link href={primaryCorpHref} data-active={active === "strata"}>
              Stratasphere&trade;
            </Link>
            {profile?.isSuperAdmin && (
              <Link href="/admin" data-active={active === "admin"}>
                Super Admin
              </Link>
            )}
          </nav>
          <AccountMenu profile={profile} />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
