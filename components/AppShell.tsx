import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo } from "@/components/Logo";
import { getCurrentProfile } from "@/lib/data/profile";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { IS_DEMO } from "@/lib/demo";

/**
 * Top-level app shell (doc03 "Screen layout — two levels, not one flat
 * menu"): Council Training (the signed-in landing screen; Home was folded
 * into it on 2026-10-06) belongs to the user, not any corporation.
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
  active?: "training" | "strata" | "admin";
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const corporations = await getConnectedCorporations();
  const primaryCorpHref =
    corporations.length > 0 ? `/strata/${corporations[0].id}` : "/strata";

  return (
    <>
      {IS_DEMO && (
        <div className="demo-banner" role="note" data-testid="demo-banner">
          <div className="wrap">
            <span>
              <strong>Demo.</strong> Your strata and everyone in it are fictional, and nothing is emailed. Try anything: it&rsquo;s
              all cleared at midnight.
            </span>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="wrap app-header__inner">
          <Link href="/training" className="app-header__brand">
            <Logo className="app-header__mark" />
            <span>StrataCouncil.ca</span>
          </Link>
          <nav className="app-nav" aria-label="Primary">
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
      <SiteFooter />
    </>
  );
}
