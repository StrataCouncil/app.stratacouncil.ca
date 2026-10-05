import Link from "next/link";
import { calculateBilling, DISPLAY_RATES, type BillingInterval } from "@/lib/stripe/prices";
import { BillingContactForm, BillingPayStep } from "@/components/BillingStepForms";
import { COMPANY_LEGAL_NAME, COMPANY_NAME, STATEMENT_DESCRIPTOR } from "@/lib/company";
import { formatBillingAddress, type BillingAddress } from "@/lib/billing-address";

export type BillingStep = "plan" | "contact" | "review" | "pay";

const stepLabels: Record<BillingStep, string> = {
  plan: "Plan",
  contact: "Billing details",
  review: "Review",
  pay: "Payment",
};
const order: BillingStep[] = ["plan", "contact", "review", "pay"];

const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/**
 * Subscribing, one step at a time, inside the billing dialog: plan →
 * billing details (contacts and address) → review → payment, where
 * Stripe's own form, shown right in the dialog, takes the bank account or
 * card and creates the subscription. The step lives in the URL. Every
 * step has Cancel, and Back where there's somewhere to go back to.
 */
export function BillingSteps({
  corpId,
  unitCount,
  interval,
  step: requested,
  billingEmail,
  billingAddress,
  addressSame,
  civicAddress,
  publishableKey,
}: {
  corpId: string;
  unitCount: number;
  interval: BillingInterval;
  step: BillingStep;
  billingEmail: string;
  billingAddress: BillingAddress | null;
  addressSame: boolean;
  civicAddress: string;
  publishableKey: string | null;
}) {
  // Never past a step whose prerequisites aren't met.
  const furthest: BillingStep = !billingEmail || !billingAddress ? "contact" : "pay";
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
              {/* Empty rows matching the Annual card's badge and saving line, so the two cards line up. */}
              <span className="billing-plan__badge billing-plan__badge--empty" aria-hidden="true">
                &nbsp;
              </span>
              <strong>Monthly</strong>
              <span className="billing-plan__price">
                {fmt(monthly.total)}
                <small>/month incl. GST</small>
              </span>
              <span className="card__meta">
                {fmt(DISPLAY_RATES.monthly.basePriceMonthly)} base + {fmt(DISPLAY_RATES.monthly.perUnitMonthly)} per lot.
                Month to month; cancel any month.
              </span>
              <span className="billing-plan__saving" aria-hidden="true" />
              <Link href={href("contact", "monthly")} className="button button-secondary billing-plan__choose" data-testid="choose-monthly">
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
              <Link href={href("contact", "annual")} className="button button-primary billing-plan__choose" data-testid="choose-annual">
                Annual plan
              </Link>
            </div>
          </div>
          <div className="billing-step__nav">{cancel}</div>
        </div>
      )}

      {step === "contact" && (
        <div className="billing-step">
          <h3>Billing details</h3>
          <BillingContactForm
            corpId={corpId}
            interval={interval}
            defaultEmails={billingEmail}
            defaultAddress={billingAddress}
            defaultSame={addressSame}
            civicAddress={civicAddress}
            cancelHref={cancelHref}
            backHref={href("plan")}
          />
        </div>
      )}

      {step === "review" && billingAddress && (
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
          <div className="billing-step__nav">
            {cancel}
            <span className="billing-step__nav-right">
              {back("contact")}
              <Link href={href("pay")} className="button button-primary" data-testid="billing-to-payment">
                Continue to payment
              </Link>
            </span>
          </div>
        </div>
      )}

      {step === "pay" && (
        <div className="billing-step">
          <h3>Payment</h3>
          <p className="card__meta">
            {fmt(chosen.total)} a month incl. GST. Pre-authorized debit from the strata&rsquo;s bank account is
            recommended: signing in to your bank is quickest, while typed-in account numbers are confirmed with two small
            deposits first (a business day or two). Processed securely by Stripe for {COMPANY_LEGAL_NAME} (shown as{" "}
            {COMPANY_NAME}). Nothing is charged until you click Subscribe.
          </p>
          <BillingPayStep
            corpId={corpId}
            interval={interval}
            publishableKey={publishableKey}
            total={fmt(chosen.total)}
            cancelHref={cancelHref}
            backHref={href("review")}
          />
        </div>
      )}
    </div>
  );
}
