import Link from "next/link";
import { calculateBilling, DISPLAY_RATES, type BillingInterval } from "@/lib/stripe/prices";
import { startPaymentSetup } from "@/app/strata/[corpId]/billing/actions";
import { BillingContactForm, BillingPayForm } from "@/components/BillingStepForms";
import { COMPANY_LEGAL_NAME, COMPANY_NAME, STATEMENT_DESCRIPTOR } from "@/lib/company";

export type BillingStep = "plan" | "payment" | "contact" | "review";

const stepLabels: Record<BillingStep, string> = {
  plan: "Choose a plan",
  payment: "Payment method",
  contact: "Billing contacts",
  review: "Review and pay",
};
const order: BillingStep[] = ["plan", "payment", "contact", "review"];

const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/**
 * Subscribing, one step at a time: plan → payment method → billing
 * contacts → pay. The step lives in the URL, so Stripe's secure
 * payment-method page can return straight to the next one. Annual is
 * the recommended plan: it's listed first, pre-selected, and shows what
 * it saves.
 */
export function BillingSteps({
  corpId,
  unitCount,
  interval,
  step: requested,
  paymentMethod,
  billingEmail,
  verifying,
}: {
  corpId: string;
  unitCount: number;
  interval: BillingInterval;
  step: BillingStep;
  paymentMethod: { label: string; detail: string } | null;
  billingEmail: string;
  verifying: boolean;
}) {
  // Never past a step whose prerequisites aren't met.
  const furthest: BillingStep = !paymentMethod ? "payment" : !billingEmail ? "contact" : "review";
  const step = order.indexOf(requested) > order.indexOf(furthest) ? furthest : requested;
  const at = order.indexOf(step);
  const href = (s: BillingStep, plan: BillingInterval = interval) => `/strata/${corpId}/billing?plan=${plan}&step=${s}`;

  const monthly = calculateBilling(unitCount, "monthly");
  const annual = calculateBilling(unitCount, "annual");
  const yearlySaving = (monthly.total - annual.total) * 12;
  const savingPct = Math.round((1 - annual.subtotal / monthly.subtotal) * 100);
  const chosen = interval === "annual" ? annual : monthly;

  return (
    <div className="card billing-steps" data-testid="billing-steps">
      <ol className="billing-steps__bar">
        {order.map((s, i) => (
          <li key={s} data-state={i < at ? "done" : i === at ? "current" : "todo"}>
            {i < at ? <Link href={href(s)}>{stepLabels[s]}</Link> : <span>{stepLabels[s]}</span>}
          </li>
        ))}
      </ol>

      {step === "plan" && (
        <div className="billing-step">
          <h3>Choose a plan</h3>
          <p className="card__meta">
            Both plans bill monthly by pre-authorized debit or card. {unitCount} strata lots. Cancel anytime; an annual
            plan runs to the end of its 12 months.
          </p>
          <div className="billing-plans">
            <Link
              href={href("payment", "annual")}
              className="billing-plan billing-plan--recommended"
              data-selected={interval === "annual"}
              data-testid="plan-annual"
            >
              <span className="billing-plan__badge">Recommended &middot; save {savingPct}%</span>
              <strong>Annual</strong>
              <span className="billing-plan__price">
                {fmt(annual.total)}
                <small>/month incl. GST</small>
              </span>
              <span className="card__meta">
                {fmt(DISPLAY_RATES.annual.basePriceMonthly)} base + {fmt(DISPLAY_RATES.annual.perUnitMonthly)} per lot,
                12-month commitment.
              </span>
              <span className="billing-plan__saving">Saves {fmt(yearlySaving)} a year over monthly</span>
              <span className="button button-primary">Choose annual</span>
            </Link>
            <Link
              href={href("payment", "monthly")}
              className="billing-plan"
              data-selected={interval === "monthly"}
              data-testid="plan-monthly"
            >
              <strong>Monthly</strong>
              <span className="billing-plan__price">
                {fmt(monthly.total)}
                <small>/month incl. GST</small>
              </span>
              <span className="card__meta">
                {fmt(DISPLAY_RATES.monthly.basePriceMonthly)} base + {fmt(DISPLAY_RATES.monthly.perUnitMonthly)} per lot,
                cancel any month.
              </span>
              <span className="button button-secondary">Choose monthly</span>
            </Link>
          </div>
        </div>
      )}

      {step === "payment" && (
        <div className="billing-step">
          <h3>Payment method</h3>
          {paymentMethod ? (
            <>
              <p>
                <strong>{paymentMethod.label}</strong>
                <br />
                <span className="card__meta">{paymentMethod.detail}</span>
              </p>
              <div className="billing-step__actions">
                <Link href={href("contact")} className="button button-primary" data-testid="payment-continue">
                  Continue
                </Link>
                <form action={startPaymentSetup.bind(null, corpId, interval)}>
                  <button className="button button-secondary">Use a different payment method</button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="card__meta">
                Pre-authorized debit from the strata&rsquo;s Canadian bank account is recommended; a credit card works
                too. You&rsquo;ll enter the details on Stripe&rsquo;s secure page and come straight back here. Nothing
                is charged until you confirm on the last step.
              </p>
              <p className="card__meta">
                Payments are processed by Stripe for {COMPANY_LEGAL_NAME}, the company behind StrataCouncil.ca, so
                you&rsquo;ll see {COMPANY_NAME} on the secure payment page.
              </p>
              <form action={startPaymentSetup.bind(null, corpId, interval)}>
                <button className="button button-primary" data-testid="add-payment-method">
                  Add payment method
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {step === "contact" && (
        <div className="billing-step">
          <h3>Billing contacts</h3>
          {verifying && (
            <p className="sync-note" role="status">
              Your bank account is being verified by Stripe. You can finish setting up now; the first debit goes
              through once it&rsquo;s confirmed.
            </p>
          )}
          <BillingContactForm corpId={corpId} interval={interval} defaultEmails={billingEmail} />
        </div>
      )}

      {step === "review" && paymentMethod && (
        <div className="billing-step">
          <h3>Review and pay</h3>
          <dl className="billing-review">
            <div>
              <dt>Plan</dt>
              <dd>
                {interval === "annual" ? "Annual (12-month commitment, billed monthly)" : "Monthly"}{" "}
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
                <div className="card__meta">Appears on your statement as {STATEMENT_DESCRIPTOR.toUpperCase()}.</div>
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
          </dl>
          <p className="card__meta">
            {interval === "annual"
              ? "You're committing to 12 months, billed monthly. Cancelling stops renewal at the end of the 12 months."
              : "Billed monthly until you cancel."}
          </p>
          <BillingPayForm corpId={corpId} interval={interval} label={`Pay ${fmt(chosen.total)} and subscribe`} />
        </div>
      )}
    </div>
  );
}
