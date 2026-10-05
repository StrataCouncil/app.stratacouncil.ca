import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { Logo } from "@/components/Logo";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * The author workspace: a separate, minimal shell. Authors see the modules
 * they're assigned to build and nothing else of StrataCouncil.ca.
 */
export default async function BuildLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  return (
    <>
      <header className="app-header">
        <div className="wrap app-header__inner">
          <Link href="/build" className="app-header__brand">
            <Logo className="app-header__mark" />
            <span>StrataCouncil.ca</span>
            <span className="pill build-header__label">Builder</span>
          </Link>
          <AccountMenu profile={profile} />
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
