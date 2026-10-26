import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { Disclaimer } from "@/components/investors/Disclaimer";
import { DISCLAIMER_TITLE, INVESTORS_EMAIL } from "@/lib/investors/briefing";

export const metadata: Metadata = {
  title: `${DISCLAIMER_TITLE} · StrataCouncil.ca`,
  robots: { index: false, follow: false },
};

/**
 * The Legal Disclaimer on its own page, for the investor form on
 * stratacouncil.ca to link to. The sign-up page shows the same text in a
 * dialog (components/investors/InvestorSignup.tsx).
 */
export default function InvestorDisclaimerPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card investor-disclaimer-page">
        <div className="auth-card__brand">
          <Logo className="auth-card__mark" />
          <span>StrataCouncil.ca</span>
        </div>
        <h1>{DISCLAIMER_TITLE}</h1>
        <Disclaimer />
        <p className="investor-signup__fine">
          Questions: <a href={`mailto:${INVESTORS_EMAIL}`}>{INVESTORS_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
