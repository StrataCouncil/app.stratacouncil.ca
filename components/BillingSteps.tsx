import Link from "next/link";
import { calculateBilling, DISPLAY_RATES, type BillingInterval } from "@/lib/stripe/prices";
import { startPaymentSetup } from "@/app/strata/[corpId]/billing/actions";
import { BillingContactForm, BillingPayForm } from "@/components/BillingStepForms";
import { COMPANY_LEGAL_NAME, COMPANY_NAME, STATEMENT_DESCRIPTOR } from "@/lib/company";
import { formatBillingAddress, type BillingAddress } from "@/lib/billing-address";

export type BillingStep = "plan" | "payment" | "contact" | "review";

const stepLabels: Record<BillingStep, string> = {
  plan: "Plan",
  payment: "Payment method",
  contact: "Billing details",
  review: "Review",
};
const order: BillingStep[] = ["plan", "payment", "contact", "review"];

const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/**
 * Subscribing, one step at a time, inside the billing dialog: plan →
 * payment method → billing details (contacts and address) → review. The
 * step lives in the URL, so Stripe's secure payment-method page can return
 * straight to the next one. Every step has Cancel, and Back where there's
 * somewhere to go back to.
 */
export function BillingSteps({
  corpId,
  unitCount,
  interval,
  step: requested,
  paymentMethod,
  billingEmail,
  billingAddress,
  addressSame,
  civicAddress,
  verifying,
  setupError = null,
}: {
  corpId: string;
  unitCount: number;
  interval: BillingInterval;
  step: BillingStep;
  paymentMethod: { label: string; detail: string } | null;
  billingEmail: string;
  billingAddress: BillingAddress | null;
  addressSame: boolean;
  civicAddress: string;
  verifying: boolean;
  setupError?: string | null;
}) {
  // Never past a step whose prerequisites aren't met.
  const furthest: BillingStep = !paymentMethod ? "payment" : !billingEmail || !billingAddress ? "contact" : "review";
  const step = order.indexOf(requested) > order.indexOf(furthest) ? furthest : requested;
  const at = order.indexOf(step);
  const href = (s: BillingStep, plan: BillingInterval = interval) => `/strata/${corpId}/billing?plan=${plan}&step=${s}`;
  const cancelHref = `/strata/${corpId}/billing`;

  const monthly = calculateBilling(unitCount, "monthly");
  const annual = calculateBilling(unitCount, "annual");
  const yearlySaving = (monthly.total - annual.total) * 12;
  const savingPct = Math.round((1 - annual.subtotal / monthly.subtotal) * 100);
  const chosen = interval === "annual" ? annual : monthly;

  const cancel = (
    <Link href={cancelHref} className="button button-secondary" data-testid="billing-cancel">
      Cancel
    </Link>
  );
  const back = (to: BillingStep) => (
    <Link href={href(to)} className="button button-secondary" data-testid="billing-back">
      Back
    </Link>
  );

  return (
    <div className="billing-steps" data-testid="billing-steps">
      <ol className="billing-steps__bar">
        {order.map((s, i) => (
          <li key={s} data-state={i < at ? "done" : i === at ? "current" : "todo"}>
            {i < at ? (
              <Link href={href(s)}>{stepLabels[s]}</Link>
            ) : (
              <span>{stepLabels[s]}</span>
            )}
          </li>
        ))}
      </ol>

      {step === "plan" && (
        <div className="billing-step">
          <p className="card__meta">
            {unitCount} strata lots. Both plans are billed monthly by pre-authorized debit or card.
          </p>
          <div className="billing-plans">
            <div className="billing-plan" data-selected={interval === "monthly"} data-testid="plan-monthly">
              <strong>Monthly</strong>
              <span className="billing-plan__price">
                {fmt(monthly.total)}
                <small>/month incl. GST</small>
              </span>
              <span className="card__meta">
                {fmt(DISPLAY_RATES.monthly.basePriceMonthly)} base + {fmt(DISPLAY_RATES.monthly.perUnitMonthly)} per lot.
                Month to month; cancel any month.
              </span>
              <Link href={href("payment", "monthly")} className="button button-secondary billing-plan__choose" data-testid="choose-monthly">
                Monthly plan
              </Link>
            </div>
            <div className="billing-plan billing-plan--recommended" data-selected={interval === "annual"} data-testid="plan-annual">
              <span className="billing-plan__badge">Recommended &middot; save {savingPct}%</span>
              <strong>Annual</strong>
              <span className="billing-plan__price">
                {fmt(annual.total)}
                <small>/month incl. GST</small>
              </span>
              <span className="card__meta">
                {fmt(DISPLAY_RATES.annual.basePriceMonthly)} base + {fmt(DISPLAY_RATES.annual.perUnitMonthly)} per lot. A
                full year, billed monthly.
              </span>
              <span className="billing-plan__saving">Saves {fmt(yearlySaving)} a year over monthly</span>
              <Link href={href("payment", "annual")} className="button button-primary billing-plan__choose" data-testid="choose-annual">
                Annual plan
              </Link>
            </div>
          </div>
          <div className="billing-step__nav">{cancel}</div>
        </div>
      )}

      {step === "payment" && (
        <div className="billing-step">
          <h3>Payment method</h3>
          {setupError && (
            <p className="form-error" role="alert" data-testid="billing-setup-error">
              {setupError}
            </p>
          )}
          {paymentMethod ? (
            <>
              <p>
                <strong>{paymentMethod.label}</strong>
                <br />
                <span className="card__meta">{paymentMethod.detail}</span>
              </p>
              <form action={startPaymentSetup.bind(null, corpId, interval)}>
                <button className="link-button">Use a different payment method</button>
              </form>
            </>
          ) : (
            <>
              <p className="card__meta">
                Pre-authorized debit from the strata&rsquo;s Canadian bank account is recommended; a credit card works
                too. You&rsquo;ll enter the details on Stripe&rsquo;s secure page and come straight back here. Nothing
                is charged until you subscribe on the last step.
              </p>
              <p className="card__meta">
                Payments are processed by Stripe for {COMPANY_LEGAL_NAME}, the company behind StrataCouncil.ca, so
                you&rsquo;ll see {COMPANY_NAME} on the secure payment page.
              </p>
            </>
          )}
          <div className="billing-step__nav">
            {cancel}
            <span className="billing-step__nav-right">
              {back("plan")}
              {paymentMethod ? (
                <Link href={href("contact")} className="button button-primary" data-testid="payment-continue">
                  Next
                </Link>
              ) : (
                <form action={startPaymentSetup.bind(null, corpId, interval)}>
                  <button className="button button-primary" data-testid="add-payment-method">
                    Add payment method
                  </button>
                </form>
              )}
            </span>
          </div>
        </div>
      )}

      {step === "contact" && (
        <div className="billing-step">
          <h3>Billing details</h3>
          {verifying && (
            <p className="sync-note" role="status">
              Your bank account is being verified by Stripe. You can finish setting up now; the first debit goes
              through once it&rsquo;s confirmed.
            </p>
          )}
          <BillingContactForm
            corpId={corpId}
            interval={interval}
            defaultEmails={billingEmail}
            defaultAddress={billingAddress}
            defaultSame={addressSame}
            civicAddress={civicAddress}
            cancelHref={cancelHref}
            backHref={href("payment")}
          />
        </div>
      )}

      {step === "review" && paymentMethod && billingAddress && (
        <div className="billing-step">
          <h3>Review</h3>
          <dl className="billing-review">
            <div>
              <dt>Plan</dt>
              <dd>
                {interval === "annual" ? "Annual: a full year, billed monthly" : "Monthly: month to month"}{" "}
                <Link href={href("plan")}>Change</Link>
              </dd>
            </div>
            <div>
              <dt>Strata lots</dt>
              <dd>{unitCount}</dd>
            </div>
            <div>
              <dt>Monthly charge</dt>
              <dd>
                {fmt(chosen.subtotal)} + {fmt(chosen.gst)} GST = <strong>{fmt(chosen.total)}</strong>
                <span className="billing-review__note">
                  Appears on your statement as {STATEMENT_DESCRIPTOR.toUpperCase()}.
                </span>
              </dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>
                {paymentMethod.label} <Link href={href("payment")}>Change</Link>
              </dd>
            </div>
            <div>
              <dt>Billing contacts</dt>
              <dd>
                {billingEmail} <Link href={href("contact")}>Change</Link>
              </dd>
            </div>
            <div>
              <dt>Billing address</dt>
              <dd>
                {formatBillingAddress(billingAddress)} <Link href={href("contact")}>Change</Link>
              </dd>
            </div>
          </dl>
          <p className="card__meta">
            {interval === "annual"
              ? "You are subscribing to a full year of Stratasphere™, billed monthly. You may cancel at any time during your subscription period, but your payment method will be billed monthly until the expiration date. If you do cancel prior to the expiration date, you will have access to Stratasphere™ until it expires."
              : "You are subscribing month to month, billed monthly. You may cancel at any time; you will have access to Stratasphere™ until the end of the month you have paid for."}
          </p>
          <BillingPayForm corpId={corpId} interval={interval} cancelHref={cancelHref} backHref={href("contact")} />
        </div>
      )}
    </div>
  );
}
