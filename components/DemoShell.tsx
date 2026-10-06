import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * The shell for a Council Training demo link (0040): no navigation to the
 * rest of the site, no account menu, and a banner saying it's a preview.
 */
export function DemoShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="wrap app-header__inner">
          <span className="app-header__brand">
            <Logo className="app-header__mark" />
            <span>StrataCouncil.ca</span>
          </span>
          <span className="pill pill--federal">Council Training preview</span>
        </div>
      </header>
      <div className="demo-banner" role="note">
        <div className="wrap">
          <span>
            A preview of Council Training{label ? ` for ${label}` : ""}. Nothing you do here is saved; comments you send are.
          </span>
        </div>
      </div>
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
