import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { DemoGuard } from "@/components/DemoGuard";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo } from "@/components/Logo";
import { getCurrentProfile } from "@/lib/data/profile";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { IS_DEMO, SANDBOX_PERSONAS, SIGNUP_URL } from "@/lib/demo";
import { sandboxSession } from "@/lib/demo-sandbox";
import { DemoRestrictedProvider } from "@/components/DemoContext";
import { TopNav } from "@/components/TopNav";

/**
 * Top-level app shell. The top bar (components/TopNav.tsx) has three
 * sections: Resources (Council Training and the Library, the person's own),
 * Your Strata, and Stratasphere. Which one is lit comes from the URL, so
 * pages don't pass it in (`active` is accepted and ignored).
 */
export async function AppShell({ children }: { active?: string; children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  const corporations = await getConnectedCorporations();
  const sandbox = await sandboxSession();

  return (
    <>
      {IS_DEMO && <DemoGuard />}
      {sandbox && (
        <div className="demo-banner demo-banner--sandbox" role="note" data-testid="sandbox-banner">
          <div className="wrap">
            <span>
              <strong>Sandbox.</strong> Signed in as {sandbox.name}
              {sandbox.persona !== "admin" ? ` (${SANDBOX_PERSONAS.find((p) => p.key === sandbox.persona)?.label ?? sandbox.persona})` : " (admin)"}.
              Everything here is fictional, and every email goes to you.
            </span>
          </div>
        </div>
      )}
      {IS_DEMO && !sandbox && (
        <div className="demo-banner" role="note" data-testid="demo-banner">
          <div className="wrap">
            <span>
              <strong>Demo.</strong> Your strata and everyone in it are fictional, and nothing is emailed. Try anything: it&rsquo;s
              all cleared at midnight.
            </span>
            <a href={SIGNUP_URL} className="demo-banner__cta" data-testid="demo-signup">
              Create your free account
            </a>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="wrap app-header__inner">
          <Link href="/training" className="app-header__brand">
            <Logo className="app-header__mark" />
            <span>StrataCouncil.ca</span>
          </Link>
          <TopNav firstCorpId={corporations[0]?.id ?? null} isSuperAdmin={Boolean(profile?.isSuperAdmin)} />
          <AccountMenu profile={profile} />
        </div>
      </header>
      <main>
        <DemoRestrictedProvider restricted={IS_DEMO && !sandbox}>{children}</DemoRestrictedProvider>
      </main>
      <SiteFooter />
    </>
  );
}
