import { COMPANY_LEGAL_NAME, COMPANY_NAME } from "@/lib/company";
import { TrickfilmLogo } from "@/components/TrickfilmLogo";

/** Every signed-in page: who's behind StrataCouncil.ca (and on its receipts). */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <span>
          &copy; {new Date().getFullYear()} {COMPANY_LEGAL_NAME} StrataCouncil.ca is a product of {COMPANY_NAME}.
        </span>
        <span className="site-footer__powered">
          Powered by <TrickfilmLogo height={20} />
        </span>
      </div>
    </footer>
  );
}
