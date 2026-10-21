"use client";

import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import { Modal } from "@/components/Modal";
import { Disclaimer } from "@/components/investors/Disclaimer";
import { requestInvestorLink, type InvestorSignupState } from "@/app/investors/actions";
import { DISCLAIMER_TITLE, INVESTORS_EMAIL, LINK_DAYS, PRIVACY_URL } from "@/lib/investors/briefing";

/** Name, email, the disclaimer and the accredited-investor confirmation; the link arrives by email. */
export function InvestorSignup({ referral, linkExpired }: { referral: string | null; linkExpired: boolean }) {
  const [state, action, pending] = useActionState<InvestorSignupState, FormData>(requestInvestorLink, { status: "idle" });
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  return (
    <div className="auth-shell">
      <div className="auth-card investor-signup">
        <div className="auth-card__brand">
          <Logo className="auth-card__mark" />
          <span>StrataCouncil.ca</span>
        </div>

        {state.status === "sent" ? (
          <div role="status" data-testid="investor-link-sent">
            <h1>Please check your email</h1>
            <p>
              We have sent your personal link to the investor briefing{state.email ? ` to ${state.email}` : ""}. It works for{" "}
              {LINK_DAYS} days.
            </p>
          </div>
        ) : (
          <>
            <h1>Investor briefing</h1>
            <p className="investor-signup__lede">
              For prospective investors. This page is not an offer to sell, or a solicitation of an offer to buy, any
              securities. Enter your details to receive a personal link to the briefing by email.
            </p>
            {linkExpired && (
              <p className="form-alert" role="alert" data-testid="investor-link-expired">
                That link has expired. Enter your details again for a new one; your notes are kept.
              </p>
            )}

            <form action={action} data-testid="investor-signup-form">
              <input type="hidden" name="ref" value={referral ?? ""} />
              <div className="field">
                <label htmlFor="investor-name">Name</label>
                <input id="investor-name" name="name" type="text" autoComplete="name" required maxLength={120} defaultValue={state.name} />
              </div>
              <div className="field">
                <label htmlFor="investor-email">Email</label>
                <input id="investor-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.email} />
              </div>
              <div className="investor-signup__trap" aria-hidden="true">
                <label>
                  Website <input name="website" type="text" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <div className="field field--checkbox">
                <label>
                  <input type="checkbox" name="disclaimer" required data-testid="investor-disclaimer-check" />
                  <span>
                    I have read and accept the{" "}
                    <a href="#disclaimer" onClick={(e) => { e.preventDefault(); setShowDisclaimer(true); }} data-testid="investor-disclaimer-link">
                      {DISCLAIMER_TITLE}
                    </a>
                    .
                  </span>
                </label>
              </div>
              <div className="field field--checkbox">
                <label>
                  <input type="checkbox" name="accredited" required data-testid="investor-accredited-check" />
                  <span>I confirm that I am an accredited investor, as defined in National Instrument 45-106 Prospectus Exemptions.</span>
                </label>
              </div>
              {state.status === "error" && (
                <p className="form-alert" role="alert">
                  {state.message}
                </p>
              )}
              <button type="submit" className="button button-primary investor-signup__submit" disabled={pending}>
                {pending ? "Sending…" : "Email me the briefing link"}
              </button>
            </form>
            <p className="investor-signup__fine">
              Your information is handled under our{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              . Questions: <a href={`mailto:${INVESTORS_EMAIL}`}>{INVESTORS_EMAIL}</a>
            </p>
          </>
        )}
      </div>

      {showDisclaimer && (
        <Modal title={DISCLAIMER_TITLE} onClose={() => setShowDisclaimer(false)} wide testId="investor-disclaimer">
          <Disclaimer />
          <div className="modal__actions">
            <button type="button" className="button button-primary" onClick={() => setShowDisclaimer(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
